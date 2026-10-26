// Reads and holds: the Annotation lists of each Attachment from its active source, the database partition, locks, and the Editing Capability.
import type { QueryFunction, QueryKey } from "@tanstack/query-core";
import {
  DateTime,
  Duration,
  Effect,
  Fiber,
  FiberMap,
  FiberSet,
  Option,
  Schema,
} from "effect";

import {
  annotationTypeToName,
  parseAnnotationPosition,
  resolveIndexedKeyLibraryIn,
} from "@zotlit/db";
import type {
  Annotation,
  Attachment,
  Library,
  ZoteroDatabaseIdentity,
} from "@zotlit/db";

import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";
import { settleAtEdge } from "@/lib/signal-edge";
import {
  capabilityReason,
  editingCapabilityOf,
} from "@/services/annotation-repository/capability";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { lockOf } from "@/services/annotation-repository/lock";
import { isTextField } from "@/services/annotation-repository/write";
import { excerptFingerprint } from "@/services/excerpt-image/contract";
import type { Held } from "@/services/query-client/service";
import type {
  LocalApiFailure,
  LocalApiSource,
} from "@/services/zotero-local-api/service";

import { databaseRows } from "./bridge";
import type { DatabaseRowsError } from "./bridge";
import { cancelTextSave, reconcilePublishedDrafts } from "./draft-store";
import {
  ANNOTATIONS,
  DRAFT_FIELDS,
  freshValueOf,
  fromLocalApi,
  indexedID,
  templateTags,
} from "./model";
import type {
  AnnotationConfirmation,
  AnnotationList,
  AnnotationMutation,
  AnnotationRecord,
  DatabaseAnnotationSource,
  HeldAnnotation,
  ProposedFields,
} from "./model";
import { pendingWrites } from "./outcomes";
import type { CoreState } from "./state";

/**
 * How long after the last ask the list of an Attachment no surface holds is
 * still read again on a database change. A list asked for longer ago is let
 * go at that change instead, so a surface that reads without a hold keeps its
 * list while it keeps asking.
 */
export const UNHELD_RETENTION = Duration.minutes(5);

/** The partition the Zotero database answers from, keyed by Indexed Key. */
const ZOTERO_DB = "zotero-db";

/**
 * The partition the Zotero Local API answers from, keyed by the Zotero Server
 * ID and then by Indexed Key, so one server's records never stand for another's.
 */
const ZOTERO_LOCAL_API = "zotero-local-api";

/** The log category of every read, hold and edge here. */
const inRepository = withLogCategory("annotation-repository");

/** One partition's key and the read that fills it. */
interface AnnotationPartition {
  queryKey: QueryKey;
  /** Takes the query's own signal, so an invalidation cancels the read it ran. */
  read: QueryFunction<AnnotationList>;
}

/** Why the Zotero Local API answered no list, as the query's failure. */
export class LocalApiReadFailed extends Schema.TaggedError<
  LocalApiReadFailed,
  { readonly brand: unique symbol }
>()("LocalApiReadFailed", {
  failure: Schema.declare(
    (input: unknown): input is LocalApiFailure =>
      typeof input === "object" && input !== null && "kind" in input,
  ),
}) {
  override get message(): string {
    return `The Zotero Local API answered ${this.failure.kind}`;
  }
}

/** The Libraries the Zotero database holds name none for this Attachment. */
export class AnnotationLibraryUnresolved extends Schema.TaggedError<
  AnnotationLibraryUnresolved,
  { readonly brand: unique symbol }
>()("AnnotationLibraryUnresolved", { attachmentKey: Schema.String }) {
  override get message(): string {
    return `Cannot resolve the Annotation Library for ${this.attachmentKey}`;
  }
}

/** This device's persisted Excerpt Image could not be read. */
class PersistedExcerptUnreadable extends Schema.TaggedError<
  PersistedExcerptUnreadable,
  { readonly brand: unique symbol }
>()("PersistedExcerptUnreadable", { cause: Schema.Defect() }) {}

/**
 * @param attachmentKey the Attachment's Indexed Key.
 * @returns the list that stands, with the Pending Proposal of each write in
 *   flight drawn over it, or null while no read has answered for it.
 */
const read = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
) {
  core.lastAsked.set(attachmentKey, yield* DateTime.now);
  return yield* readUnasked(core, attachmentKey);
});

/**
 * {@link read} for this repository's own reads, which are no ask: a list
 * read again after a database change is let go on time all the same.
 */
const readUnasked = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
): Effect.fn.Return<
  AnnotationList | null,
  DatabaseRowsError | AnnotationLibraryUnresolved
> {
  const source = yield* core.localApi.demandSource;
  const binding = core.databaseBindings.get(attachmentKey);
  if (
    source &&
    binding &&
    binding.verifiedGeneration !== core.databaseGeneration
  ) {
    yield* sourceStillBound(core, attachmentKey, source);
  }
  const { queryKey, read } = yield* activePartition(core, attachmentKey);
  const candidate = yield* core.queries.read(queryKey, read);
  if (
    candidate &&
    !overtakenPartition(core, queryKey) &&
    (yield* canPublish(core, attachmentKey, candidate))
  ) {
    if (candidate.source.kind === "zotero-db") {
      yield* adoptDatabaseSource(core, attachmentKey, candidate.source);
      coverDatabaseDeletions(core, attachmentKey, candidate);
    } else if (
      coversConfirmations(candidate, core.confirmedWrites.get(attachmentKey))
    ) {
      core.confirmedWrites.delete(attachmentKey);
    }
    const superseded = core.publishedLists.get(attachmentKey);
    core.publishedLists.set(attachmentKey, candidate);
    const held = yield* core.queries.peek<AnnotationList>(queryKey);
    core.publishedStatuses.set(attachmentKey, held?.status ?? "fresh");
    yield* reconcilePublishedDrafts(core, held, {
      attachmentKey,
      list: candidate,
    });
    yield* announceReadPixels(core, superseded, candidate);
    return drawn(core, attachmentKey, candidate);
  }
  return published(core, attachmentKey)?.value ?? null;
});

/**
 * Keeps the lists of these Attachments published while a surface shows
 * them: a database change reads them again, and a write finds their
 * records. Disposing the hold lets each list go once no other surface holds
 * it, and the next surface that holds it again gets a fresh read.
 *
 * The hold's dispose is a plain caller's edge: it runs the release on the
 * layer's bridge.
 *
 * @param attachmentKeys the Attachments' Indexed Keys.
 */
function hold(
  core: CoreState,
  attachmentKeys: Iterable<string>,
): Effect.Effect<Disposable> {
  return Effect.sync(() => {
    const held = [...new Set(attachmentKeys)];
    for (const attachmentKey of held) {
      core.holds.set(attachmentKey, (core.holds.get(attachmentKey) ?? 0) + 1);
    }
    let released = false;
    return {
      [Symbol.dispose]: () => {
        if (released) return;
        released = true;
        core.bridge.runSync(release(core, held).pipe(inRepository));
      },
    };
  });
}

/** One hold's end: each list no other surface holds is let go. */
const release = Effect.fnUntraced(function* (
  core: CoreState,
  held: readonly string[],
) {
  for (const attachmentKey of held) {
    const left = (core.holds.get(attachmentKey) ?? 1) - 1;
    if (left > 0) {
      core.holds.set(attachmentKey, left);
      continue;
    }
    core.holds.delete(attachmentKey);
    // A surface that reads with no hold of its own may still show the
    // list; the announcement is its word to read it again.
    if (yield* letGo(core, attachmentKey)) {
      core.publish({ _tag: "annotations-changed", attachmentKey });
    }
  }
});

/**
 * Drops the list of an Attachment no surface holds, with what this
 * repository kept beside it, so its next read is a fresh one. A list that
 * work in progress still stands on — an Annotation Draft, a write, an open
 * Annotation History — stays until that work ends.
 *
 * @returns whether a list was let go that a reader may show or wait for.
 */
const letGo = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
) {
  if (core.holds.has(attachmentKey) || inUse(core, attachmentKey)) return false;
  core.lastAsked.delete(attachmentKey);
  // A read still running publishes nothing once its query goes, so its
  // readers are told too.
  const reading = (yield* attachmentsHeld(core, [ANNOTATIONS])).includes(
    attachmentKey,
  );
  core.queries.client.removeQueries({
    queryKey: [ANNOTATIONS],
    predicate: ({ queryKey }) => queryKey.at(-1) === attachmentKey,
  });
  const published = core.publishedLists.delete(attachmentKey);
  core.publishedStatuses.delete(attachmentKey);
  core.locks.delete(attachmentKey);
  core.databaseBindings.delete(attachmentKey);
  core.lastCapability.delete(attachmentKey);
  for (const completeID of core.completeKeys.keys()) {
    if (completeID.endsWith(indexedID("", attachmentKey))) {
      core.completeKeys.delete(completeID);
    }
  }
  yield* Effect.logDebug("Annotation list no surface holds was dropped").pipe(
    Effect.annotateLogs({ attachmentKey }),
  );
  return published || reading;
});

/**
 * Whether an Attachment's list stands for a surface: one holds it, work in
 * progress stands on it, or a caller asked for it within
 * {@link UNHELD_RETENTION}.
 */
const wanted = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
) {
  if (core.holds.has(attachmentKey) || inUse(core, attachmentKey)) return true;
  const asked = core.lastAsked.get(attachmentKey);
  return (
    asked !== undefined &&
    DateTime.isLessThan(
      yield* DateTime.now,
      DateTime.addDuration(asked, UNHELD_RETENTION),
    )
  );
});

/** Whether work in progress still stands on an Attachment's list. */
function inUse(core: CoreState, attachmentKey: string): boolean {
  if (
    core.histories.has(attachmentKey) ||
    core.writesInFlight.has(attachmentKey) ||
    FiberMap.hasUnsafe(core.refreshes, attachmentKey) ||
    core.steppingAttachments.has(attachmentKey) ||
    core.confirmedWrites.has(attachmentKey)
  )
    return true;
  for (const drafts of Object.values(core.drafts)) {
    for (const draft of drafts.values()) {
      if (draft.attachmentKey === attachmentKey) return true;
    }
  }
  return (core.publishedLists.get(attachmentKey)?.annotations ?? []).some(
    ({ key }) => core.outcomes.has(key) || pendingWrites(core, key).length > 0,
  );
}

/**
 * Revalidates one Attachment through its active source. Concurrent surfaces
 * join the same operation, while the Held Read keeps their published list.
 * The operation runs on the layer's Scope, so a caller that stops waiting
 * leaves it running for the others.
 */
const refresh = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
) {
  // The join is getUnsafe + run: `onlyIfMissing` answers an interrupted
  // fiber, not the running one.
  const running = FiberMap.getUnsafe(core.refreshes, attachmentKey);
  if (Option.isSome(running)) return yield* Fiber.join(running.value);
  const refreshing = yield* FiberMap.run(
    core.refreshes,
    attachmentKey,
    revalidate(core, attachmentKey).pipe(
      recover(
        (cause) =>
          Effect.logWarning(
            "Failed to refresh an Attachment's annotations",
            cause,
          ).pipe(Effect.annotateLogs({ attachmentKey })),
        Effect.sync(() => {
          if (core.publishedLists.has(attachmentKey)) {
            core.publishedStatuses.set(attachmentKey, "failed");
          }
          return peek(core, attachmentKey)?.value ?? null;
        }),
      ),
    ),
  );
  return yield* Fiber.join(refreshing);
});

/** Probes source availability, refreshes the active adapter, then reads it. */
const revalidate = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
) {
  yield* core.localApi.probe;
  if ((yield* compatibleApiSource(core, attachmentKey)) === null) {
    // A failed refresh keeps the previous database serving, so the read
    // below still answers; a database that cannot serve fails that read.
    yield* core.db.refresh.pipe(
      Effect.catch((error) =>
        Effect.logDebug("The Zotero database refresh failed").pipe(
          Effect.annotateLogs({ error }),
        ),
      ),
    );
  }
  const { queryKey } = yield* activePartition(core, attachmentKey);
  core.publish({ _tag: "annotations-changed", attachmentKey });
  yield* core.queries.invalidate(queryKey);
  const value = yield* read(core, attachmentKey);
  const status = (yield* core.queries.peek<AnnotationList>(queryKey))?.status;
  if (value && status === "failed") {
    core.publishedStatuses.set(attachmentKey, status);
  }
  return value;
});

/**
 * What `attachmentKey` holds right now, for a caller that cannot wait — a
 * surface redrawing synchronously. The Held Read travels whole, so the caller
 * can tell a list that stands from one a refresh has already superseded.
 *
 * @returns null while no read has answered for the Attachment.
 */
function peek(
  core: CoreState,
  attachmentKey: string,
): Held<AnnotationList> | null {
  return published(core, attachmentKey);
}

/**
 * What a surface may do to one Attachment's Annotations: the Capability
 * Probe, plus what the write path learned about this Attachment's library and
 * about the authorization gesture in flight.
 *
 * @param attachmentKey the Attachment's Indexed Key.
 */
function capabilityFor(
  core: CoreState,
  attachmentKey: string,
): Effect.Effect<EditingCapability> {
  return editingCapability(core, attachmentKey);
}

/**
 * What the session itself may do, with no Attachment in hand — what the
 * "Zotero editing" settings row shows. A library Zotero refuses writes to is
 * a fact about one Attachment and has no place here.
 */
function capability(core: CoreState): Effect.Effect<EditingCapability> {
  return editingCapability(core, null);
}

/**
 * One Editing Capability, logged at debug where it differs from the last
 * value this consumer was given for the same subject — every read at trace,
 * every change at debug, so a session's capability history is in the log
 * without one line per redraw.
 *
 * @param attachmentKey the Attachment, or null for the session itself.
 */
const editingCapability = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string | null,
): Effect.fn.Return<EditingCapability> {
  const capability =
    attachmentKey !== null &&
    (yield* core.localApi.demandSource) &&
    !(yield* compatibleApiSource(core, attachmentKey))
      ? ({ kind: "read-only", reason: "server-changed" } as const)
      : editingCapabilityOf(
          yield* core.localApi.state,
          yield* core.localApi.writeStateFor(attachmentKey),
          core.now,
        );
  const described = describeCapability(capability);
  if (core.lastCapability.get(attachmentKey) === described) {
    yield* Effect.logTrace("Editing capability read").pipe(
      Effect.annotateLogs({ attachmentKey, capability }),
    );
    return capability;
  }
  core.lastCapability.set(attachmentKey, described);
  yield* Effect.logDebug("Editing capability changed").pipe(
    Effect.annotateLogs({ attachmentKey, capability }),
  );
  return capability;
});

/**
 * Announce every Annotation a read found moved, so an Excerpt Image made from
 * the record that stood before it is replaced rather than shown.
 *
 * An edit saved in Zotero itself — a crop resize, an ink colour — reaches this
 * repository through freshness invalidation and the read after it, where no
 * write of its own says so, and this is where that read's movement is found.
 * The comparison is the canonical pixel fingerprint against the list that
 * stood before the read answered, so a read that answers the same pixels — a
 * source switch, or Zotero echoing a colour the user picked — says nothing,
 * and a second read of a list already published says nothing either.
 *
 * The first read of a session has no such list: what stands before it then is
 * the image this device persists for the Annotation, which is what the read is
 * compared against instead. An Annotation this device never cached has no
 * baseline and says nothing here, exactly as it is replaced nowhere: whether an
 * image is held is the consumer's own stored-outcome gate to answer, and a
 * record nothing stands for stays on demand.
 */
const announceReadPixels = Effect.fnUntraced(function* (
  core: CoreState,
  superseded: AnnotationList | undefined,
  candidate: AnnotationList,
) {
  const stood = superseded
    ? fingerprintMap(superseded)
    : yield* persistedFingerprints(core, candidate);
  for (const record of candidate.annotations) {
    const fingerprint = stood.get(record.key);
    if (fingerprint === undefined || fingerprint === excerptFingerprint(record))
      continue;
    core.publish({
      _tag: "excerpt-pixels-changed",
      record,
      source: candidate.source,
    });
  }
});

/**
 * The pixels this device's persisted Excerpt Image of each of one Attachment's
 * Annotations was made from, as the baseline a session's first read is
 * compared against. An Annotation this device never cached answers nothing, so
 * it stays on demand.
 */
const persistedFingerprints = Effect.fnUntraced(function* (
  core: CoreState,
  candidate: AnnotationList,
): Effect.fn.Return<ReadonlyMap<string, string>> {
  const persisted = core.persistedExcerpt;
  if (!persisted) return new Map();
  const stood = yield* Effect.forEach(
    candidate.annotations,
    (record) =>
      Effect.tryPromise({
        try: () => persisted(record, candidate.source),
        catch: (cause) => new PersistedExcerptUnreadable({ cause }),
      }).pipe(
        recover(
          (cause) =>
            Effect.logDebug(
              "A persisted excerpt could not be read",
              cause,
            ).pipe(Effect.annotateLogs({ annotationKey: record.key })),
          Effect.succeed(null),
        ),
        Effect.map((fingerprint) => [record.key, fingerprint] as const),
      ),
    { concurrency: "unbounded" },
  );
  return new Map(
    stood.filter(
      (entry): entry is readonly [string, string] => entry[1] !== null,
    ),
  );
});

/** The repository owns the records visible to readers and write commands. */
const holding = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
): Effect.fn.Return<HeldAnnotation | null> {
  const source = yield* core.localApi.demandSource;
  for (const [attachmentKey, list] of core.publishedLists) {
    if (
      source
        ? list.source.kind !== "zotero-local-api" ||
          !(yield* sameApiSource(core, attachmentKey, list.source))
        : list.source.kind !== "zotero-db"
    )
      continue;
    const record = list.annotations.find(
      (record) => record.key === annotationKey,
    );
    if (record)
      return {
        attachmentKey,
        record,
        queryKey: source
          ? [ANNOTATIONS, ZOTERO_LOCAL_API, source.serverID, attachmentKey]
          : [ANNOTATIONS, ZOTERO_DB, core.databaseGeneration, attachmentKey],
      };
  }
  return null;
});

/** Verify the binding and complete the first API handoff before a write. */
const prepareCollection = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
  source: LocalApiSource,
) {
  if (!(yield* sourceStillBound(core, attachmentKey, source))) return false;
  if (
    core.publishedLists.get(attachmentKey)?.source.kind !== "zotero-local-api"
  ) {
    yield* read(core, attachmentKey);
  }
  const list = core.publishedLists.get(attachmentKey);
  return (
    list?.source.kind === "zotero-local-api" &&
    (yield* sameApiSource(core, attachmentKey, list.source))
  );
});

/** Locate the Annotation independently of the source's write readiness. */
function attachmentHolding(
  core: CoreState,
  annotationKey: string,
): string | undefined {
  return [...core.publishedLists].find(([, list]) =>
    list.annotations.some((record) => record.key === annotationKey),
  )?.[0];
}

const prepareWrite = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
): Effect.fn.Return<
  HeldAnnotation | null | "server-changed",
  DatabaseRowsError | AnnotationLibraryUnresolved
> {
  const source = yield* core.localApi.demandSource;
  if (!source) return yield* holding(core, annotationKey);
  const attachmentKey = attachmentHolding(core, annotationKey);
  if (attachmentKey) {
    if (!(yield* sourceStillBound(core, attachmentKey, source)))
      return "server-changed";
    if (
      core.publishedLists.get(attachmentKey)?.source.kind !== "zotero-local-api"
    ) {
      yield* read(core, attachmentKey);
    }
  }
  return yield* holding(core, annotationKey);
});

/**
 * One Attachment's list is superseded: it goes, and the Attachment is
 * announced. The only signal a consumer replaces a list on.
 *
 * @param queryKey the partition key the caller already holds; the active
 *   partition's own key where it does not.
 */
const dropAttachment = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
  queryKey?: QueryKey,
) {
  yield* core.queries.invalidate(
    queryKey ?? (yield* activePartition(core, attachmentKey)).queryKey,
  );
  core.publish({ _tag: "annotations-changed", attachmentKey });
});

/**
 * The partition the active Annotation Source answers from — the one place a
 * source is chosen. {@link read} and {@link peek} never name one, and a
 * result already carries the one that answered it.
 *
 * The choice is made once per ask and the whole list comes from it, which is
 * what makes the source atomic per Attachment. A Zotero that stops answering
 * changes what this returns, and the change is announced rather than folded
 * into the list in flight.
 *
 * Query Core calls each read for a Promise: the read runs on the layer's
 * bridge, so the query's signal and the layer's close interrupt it.
 */
const activePartition = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
): Effect.fn.Return<AnnotationPartition> {
  const source = yield* compatibleApiSource(core, attachmentKey);
  if (source) {
    return {
      queryKey: [ANNOTATIONS, ZOTERO_LOCAL_API, source.serverID, attachmentKey],
      read: ({ signal }) =>
        core.bridge
          .runPromiseExit(
            readFromLocalApi(core, source, attachmentKey).pipe(inRepository),
            { signal },
          )
          .then((exit) =>
            settleAtEdge(exit, signal, () => {
              // The layer closed under the read: its outcome is not known,
              // and the session stays standing.
              throw new LocalApiReadFailed({
                failure: { kind: "unknown-outcome" },
              });
            }),
          ),
    };
  }
  return {
    queryKey: [ANNOTATIONS, ZOTERO_DB, core.databaseGeneration, attachmentKey],
    read: () =>
      core.bridge
        .runPromiseExit(
          readFromDatabase(core, attachmentKey).pipe(inRepository),
        )
        .then((exit) => settleAtEdge(exit, undefined)),
  };
});

/**
 * Fails with {@link LocalApiReadFailed} where the Zotero Local API did not
 * answer the list. The client has already stood its session down by then, so
 * the Attachment's next ask lands on the source that can answer.
 */
const readFromLocalApi = Effect.fnUntraced(function* (
  core: CoreState,
  source: LocalApiSource,
  attachmentKey: string,
): Effect.fn.Return<AnnotationList, LocalApiReadFailed> {
  const [result] = yield* Effect.all(
    [
      core.localApi.listAnnotations(attachmentKey),
      readLocks(core, attachmentKey),
    ],
    { concurrency: "unbounded" },
  );
  if ("failure" in result)
    return yield* new LocalApiReadFailed({ failure: result.failure });
  return { source, annotations: result.value.map(fromLocalApi) };
});

/**
 * Read the locks of one Attachment's Annotations from the Zotero database
 * into {@link locks}, beside a Zotero Local API list, whose item JSON
 * carries no lock facts. The list itself stays wholly the Local API's (ADR
 * 0034). A database that cannot be read keeps the locks the last read gave,
 * so only an Attachment never read has no lock.
 *
 * @returns whether any lock of the Attachment moved.
 * @see apps/obsidian/docs/adr/0067-annotation-locks-come-from-the-zotero-database.md
 */
const readLocks = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
) {
  const generation = core.databaseGeneration;
  const annotations = yield* databaseRows(core, attachmentKey).pipe(
    Effect.flatMap(({ found }) => toRecords(attachmentKey, found)),
    Effect.asSome,
    recover(
      (cause) =>
        Effect.logDebug(
          "No lock facts could be read from the Zotero database",
          cause,
        ).pipe(Effect.annotateLogs({ attachmentKey })),
      Effect.succeedNone,
    ),
  );
  if (Option.isNone(annotations)) return false;
  // A read a database change overtook holds the old locks; the change reads
  // them again.
  if (generation !== core.databaseGeneration) return false;
  return keepLocks(core, attachmentKey, annotations.value);
});

/**
 * Keep the locks one database read gave an Attachment's Annotations.
 *
 * @returns whether any of them moved.
 */
function keepLocks(
  core: CoreState,
  attachmentKey: string,
  annotations: readonly AnnotationRecord[],
): boolean {
  const locks = new Map(
    annotations.flatMap(({ key, lock }) =>
      lock ? [[key, lock] as const] : [],
    ),
  );
  const held = core.locks.get(attachmentKey) ?? new Map();
  core.locks.set(attachmentKey, locks);
  return (
    held.size !== locks.size ||
    [...locks].some(([key, lock]) => held.get(key)?.reason !== lock.reason)
  );
}

/**
 * A refreshed Zotero database may lock an Annotation a Zotero Local API list
 * holds — Zotero imported it from the PDF file since the list was read — or
 * unlock one. The list is not read again from Zotero: only the locks move,
 * and each Attachment whose locks moved is announced, so its surfaces draw
 * the list again with the new locks.
 */
const refreshLocks = Effect.fnUntraced(function* (core: CoreState) {
  for (const attachmentKey of core.locks.keys()) {
    // The list of the Zotero DB source is read again whole, and that read
    // keeps its locks.
    if (core.publishedLists.get(attachmentKey)?.source.kind === "zotero-db")
      continue;
    if (!(yield* readLocks(core, attachmentKey))) continue;
    yield* Effect.logDebug(
      "A database refresh moved the locks of an Attachment",
    ).pipe(Effect.annotateLogs({ attachmentKey }));
    core.publish({ _tag: "annotations-changed", attachmentKey });
  }
});

const readFromDatabase = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
): Effect.fn.Return<
  AnnotationList,
  DatabaseRowsError | AnnotationLibraryUnresolved
> {
  const generation = core.databaseGeneration;
  const { found, libraries, database } = yield* databaseRows(
    core,
    attachmentKey,
  );
  const annotations = yield* toRecords(attachmentKey, found);
  const source = yield* databaseAnnotationSource(
    attachmentKey,
    libraries,
    database,
  );
  if (generation === core.databaseGeneration)
    keepLocks(core, attachmentKey, annotations);
  yield* Effect.logDebug("Annotations read from the Zotero database").pipe(
    Effect.annotateLogs({ attachmentKey, annotations: annotations.length }),
  );
  return { source, annotations };
});

const adoptDatabaseSource = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
  source: DatabaseAnnotationSource,
) {
  const binding = core.databaseBindings.get(attachmentKey);
  const previous = binding?.source;
  const previousServerID = previous?.database.serverID;
  const revalidated =
    binding !== undefined &&
    binding.verifiedGeneration !== core.databaseGeneration;
  core.databaseBindings.set(attachmentKey, {
    source,
    verifiedGeneration: core.databaseGeneration,
  });
  if (
    previousServerID !== undefined &&
    previousServerID !== source.database.serverID
  ) {
    for (const field of DRAFT_FIELDS) {
      const sources = core.draftSources[field];
      for (const draft of core.drafts[field].values()) {
        if (
          draft.attachmentKey === attachmentKey &&
          draft.serverID !== source.database.serverID &&
          sources.get(draft.annotationKey) === draft.serverID
        ) {
          sources.delete(draft.annotationKey);
          if (isTextField(field)) {
            yield* cancelTextSave(core, field, draft);
          }
          core.publish({
            _tag: "annotation-changed",
            annotationKey: draft.annotationKey,
          });
        }
      }
    }
    for (const { key } of core.publishedLists.get(attachmentKey)?.annotations ??
      []) {
      if (core.outcomes.delete(key)) {
        core.publish({ _tag: "annotation-changed", annotationKey: key });
      }
    }
    core.confirmedWrites.delete(attachmentKey);
  }
  if (revalidated || !databaseSourcesEqual(previous, source)) {
    // Announced once the read that adopted the source has published: the
    // fiber yields first, so the caller runs on to its own yield.
    yield* FiberSet.run(
      core.fibers,
      Effect.yieldNow.pipe(
        Effect.andThen(
          Effect.gen(function* () {
            core.publish({ _tag: "capability-changed" });
            if (yield* compatibleApiSource(core, attachmentKey)) {
              core.publish({ _tag: "annotations-changed", attachmentKey });
            }
          }),
        ),
      ),
    );
  }
});

/**
 * What the Zotero Local API answers has moved: another capability, another
 * Zotero database, or the Companion's Freshness Signal saying the library
 * changed. Its whole partition goes, and every Attachment either partition
 * holds is announced — a surface reading from the Zotero DB is the one a
 * switch to the Zotero Local API most concerns.
 */
const sourceMoved = Effect.fnUntraced(function* (core: CoreState) {
  yield* core.queries.invalidate([ANNOTATIONS, ZOTERO_LOCAL_API]);
  const held = yield* attachmentsHeld(core, [ANNOTATIONS]);
  const source = yield* core.localApi.demandSource;
  yield* Effect.logDebug("The Zotero Local API source moved").pipe(
    Effect.annotateLogs({ attachments: held.length, source }),
  );
  for (const attachmentKey of held) {
    core.publish({ _tag: "annotations-changed", attachmentKey });
  }
  yield* rereadSuperseded(core, held);
});

/**
 * Every Attachment one prefix holds a list for. Both partitions key by
 * Indexed Key last — the Zotero Local API one behind its server id — so the
 * last element names the Attachment whichever source answered.
 */
const attachmentsHeld = Effect.fnUntraced(function* (
  core: CoreState,
  prefix: QueryKey,
) {
  const keys = (yield* core.queries.keysUnder(prefix))
    .map((queryKey) => queryKey.at(-1))
    .filter((key) => typeof key === "string");
  return [...new Set(keys)];
});

/**
 * A refreshed database replaces every row the partition held, so the whole
 * partition goes rather than the rows a comparison would call changed.
 */
const dropDatabasePartition = Effect.fnUntraced(function* (core: CoreState) {
  core.databaseGeneration += 1;
  const prefix = [ANNOTATIONS, ZOTERO_DB];
  const held = yield* attachmentsHeld(core, prefix);
  yield* core.queries.invalidate(prefix);
  yield* core.queries.invalidate([ANNOTATIONS, ZOTERO_LOCAL_API]);
  yield* Effect.logDebug("Zotero database annotation partition dropped").pipe(
    Effect.annotateLogs({ attachments: held.length }),
  );
  for (const attachmentKey of held) {
    core.publish({ _tag: "annotations-changed", attachmentKey });
  }
  yield* rereadSuperseded(core, held);
});

/**
 * Read every Attachment a source change superseded again, so the movement it
 * carried is found and announced whether or not a surface is mounted to ask:
 * an edit saved in Zotero itself reaches the repository through this change
 * and the read after it, and a device that holds an Excerpt Image of the
 * Annotation must replace it with no Annotation View, reader, or binding on
 * screen. The lists this repository still stands for are read too, because a
 * Held Read the query client collected leaves the standing list behind.
 *
 * Only a list a surface still wants is read again: one a surface holds, one
 * work in progress stands on, or one a caller asked for within
 * {@link UNHELD_RETENTION}. Every other list is let go here, so a view over a
 * whole Library costs nothing once it closes. Its next read compares against
 * the image this device persists, as a session's first read does.
 *
 * Whether this device holds an image for an Annotation is not this
 * repository's to know: the consumer resolves that against its own store, so
 * one this device never cached stays on demand.
 *
 * Each read runs on the layer's Scope, so the layer's close interrupts it.
 */
const rereadSuperseded = Effect.fnUntraced(function* (
  core: CoreState,
  announced: readonly string[],
) {
  for (const attachmentKey of new Set([
    ...announced,
    ...core.publishedLists.keys(),
  ])) {
    if (!(yield* wanted(core, attachmentKey))) {
      yield* letGo(core, attachmentKey);
      continue;
    }
    yield* FiberSet.run(
      core.fibers,
      readUnasked(core, attachmentKey).pipe(
        recover(
          (cause) =>
            Effect.logDebug(
              "A superseded Attachment was not read again",
              cause,
            ).pipe(Effect.annotateLogs({ attachmentKey })),
          Effect.void,
        ),
      ),
    );
  }
});

/** The published list as surfaces draw it: with every Pending Proposal. */
function published(
  core: CoreState,
  attachmentKey: string,
): Held<AnnotationList> | null {
  const confirmed = core.publishedLists.get(attachmentKey);
  const value = confirmed && drawn(core, attachmentKey, confirmed);
  return value
    ? {
        value,
        status: core.publishedStatuses.get(attachmentKey) ?? "fresh",
        settled: Promise.resolve(value),
      }
    : null;
}

/**
 * One confirmed list with the Pending Proposal of every write in flight on
 * its Annotations drawn over it, the later write's field over the earlier's.
 * A proposal is drawn only over the list of the Zotero database it was sent
 * to. The list itself is answered while nothing is proposed.
 */
function drawn(
  core: CoreState,
  attachmentKey: string,
  list: AnnotationList,
): AnnotationList {
  return withProposals(
    core,
    attachmentKey,
    withLocks(core, attachmentKey, list),
  );
}

/** One list with the locks the Zotero database last gave its Annotations. */
function withLocks(
  core: CoreState,
  attachmentKey: string,
  list: AnnotationList,
): AnnotationList {
  const locks = core.locks.get(attachmentKey);
  if (!locks) return list;
  const joined = core.lockedLists.get(list);
  if (joined?.locks === locks) return joined.list;
  let moved = false;
  const annotations = list.annotations.map((record) => {
    const lock = locks.get(record.key) ?? null;
    if (record.lock?.reason === lock?.reason) return record;
    moved = true;
    return { ...record, lock };
  });
  const drawn = moved ? { ...list, annotations } : list;
  core.lockedLists.set(list, { locks, list: drawn });
  return drawn;
}

function withProposals(
  core: CoreState,
  attachmentKey: string,
  list: AnnotationList,
): AnnotationList {
  if (list.source.kind !== "zotero-local-api") return list;
  const { serverID } = list.source;
  const proposed = new Map<string, ProposedFields>();
  for (const mutation of core.queries.client
    .getMutationCache()
    .findAll({ mutationKey: [ANNOTATIONS], status: "pending" })) {
    const proposal = (mutation as AnnotationMutation).state.variables;
    if (
      !proposal ||
      proposal.attachmentKey !== attachmentKey ||
      proposal.serverID !== serverID
    )
      continue;
    const { annotationKey, fields } = proposal;
    proposed.set(annotationKey, {
      ...proposed.get(annotationKey),
      ...fields,
    });
  }
  if (proposed.size === 0) return list;
  return {
    ...list,
    annotations: list.annotations.map((record) => {
      const fields = proposed.get(record.key);
      return fields ? { ...record, ...fields } : record;
    }),
  };
}

const compatibleApiSource = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string | null,
): Effect.fn.Return<LocalApiSource | null> {
  const api = yield* core.localApi.demandSource;
  if (!api) return null;
  const sources =
    attachmentKey === null
      ? core.databaseBindings.values()
      : [core.databaseBindings.get(attachmentKey)].values();
  for (const binding of sources) {
    if (binding?.source.database.serverID === api.serverID) return api;
  }
  return null;
});

const sameApiSource = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
  expected: LocalApiSource,
) {
  return (
    (yield* compatibleApiSource(core, attachmentKey))?.serverID ===
    expected.serverID
  );
});

/** Availability can lapse while an acknowledged write keeps its database identity. */
const sourceStillBound = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
  expected: LocalApiSource,
): Effect.fn.Return<boolean, DatabaseRowsError | AnnotationLibraryUnresolved> {
  for (;;) {
    const state = yield* core.localApi.state;
    if (
      state.kind === "available"
        ? state.source.serverID !== expected.serverID
        : state.kind === "unavailable" &&
          state.failure.kind === "server-changed"
    )
      return false;
    const binding = core.databaseBindings.get(attachmentKey);
    if (
      binding?.verifiedGeneration === core.databaseGeneration &&
      binding.source.database.serverID === expected.serverID
    )
      return true;
    const generation = core.databaseGeneration;
    const snapshot = yield* readFromDatabase(core, attachmentKey);
    if (generation !== core.databaseGeneration) continue;
    const { source } = snapshot;
    if (source.kind !== "zotero-db") return false;
    yield* adoptDatabaseSource(core, attachmentKey, source);
    coverDatabaseDeletions(core, attachmentKey, snapshot);
    if (source.database.serverID !== expected.serverID) return false;
  }
});

/** A newer database snapshot can prove a confirmed record was deleted. */
function coverDatabaseDeletions(
  core: CoreState,
  attachmentKey: string,
  snapshot: AnnotationList,
): void {
  if (snapshot.source.kind !== "zotero-db") return;
  const revision = snapshot.source.libraryRevision;
  const confirmations = core.confirmedWrites.get(attachmentKey);
  if (revision === null || !confirmations) return;
  const keys = new Set(snapshot.annotations.map((record) => record.key));
  core.confirmedWrites.set(
    attachmentKey,
    confirmations.map((confirmation) => {
      if (
        confirmation.kind === "deleted" ||
        confirmation.record.version === null ||
        revision <= confirmation.record.version ||
        keys.has(confirmation.record.key)
      )
        return confirmation;
      return { kind: "deleted", annotationKey: confirmation.record.key };
    }),
  );
}

/** Whether the key names a database partition a database change has left. */
function overtakenPartition(core: CoreState, queryKey: QueryKey): boolean {
  return queryKey[1] === ZOTERO_DB && queryKey[2] !== core.databaseGeneration;
}

const canPublish = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
  candidate: AnnotationList,
) {
  if (candidate.source.kind === "zotero-local-api") {
    return (
      (yield* sameApiSource(core, attachmentKey, candidate.source)) &&
      coversConfirmations(candidate, core.confirmedWrites.get(attachmentKey))
    );
  }
  const { source } = candidate;
  const current = core.publishedLists.get(attachmentKey);
  // Keep the write's API collection until its acknowledgement can be applied.
  // Availability can change while the request is in flight without changing
  // the database that owns its records.
  if (
    core.writesInFlight.has(attachmentKey) &&
    current?.source.kind === "zotero-local-api" &&
    current.source.serverID === source.database.serverID
  )
    return false;
  const floor = core.acknowledgedRevisions.get(databaseLibraryKey(source));
  return (
    floor === undefined ||
    (source.libraryRevision !== null && source.libraryRevision >= floor)
  );
});

function rememberAcknowledgedRevision(
  core: CoreState,
  attachmentKey: string,
  headers: Headers,
): void {
  const source = core.databaseBindings.get(attachmentKey)?.source;
  const header = headers.get("last-modified-version");
  if (!source) return;
  const key = databaseLibraryKey(source);
  const value = Number(header);
  if (
    header === null ||
    header === "" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    String(value) !== header
  ) {
    core.acknowledgedRevisions.set(key, Number.POSITIVE_INFINITY);
    return;
  }
  const held = core.acknowledgedRevisions.get(key) ?? -1;
  if (value > held) core.acknowledgedRevisions.set(key, value);
}

function databaseLibraryKey(source: DatabaseAnnotationSource): string {
  return `${source.database.serverID ?? "uninitialized"}:${source.libraryID}`;
}

function databaseSourcesEqual(
  a: DatabaseAnnotationSource | undefined,
  b: DatabaseAnnotationSource,
): boolean {
  return (
    a?.database.serverID === b.database.serverID &&
    a?.libraryID === b.libraryID &&
    a?.libraryRevision === b.libraryRevision
  );
}

/** One list's canonical pixel fingerprints, by Indexed Key. */
function fingerprintMap(list: AnnotationList): ReadonlyMap<string, string> {
  return new Map(
    list.annotations.map((record) => [record.key, excerptFingerprint(record)]),
  );
}

function coversConfirmation(
  list: AnnotationList | undefined,
  confirmation: AnnotationConfirmation | undefined,
): boolean {
  if (!confirmation) return true;
  if (!list || list.source.kind !== "zotero-local-api") return false;
  if (confirmation.kind === "deleted") {
    return !list.annotations.some(
      ({ key }) => key === confirmation.annotationKey,
    );
  }
  const candidate = list.annotations.find(
    ({ key }) => key === confirmation.record.key,
  );
  if (!candidate || candidate.version === null) return false;
  if (candidate.version > (confirmation.record.version ?? -1)) return true;
  if (candidate.version !== confirmation.record.version) return false;
  if (confirmation.kind === "created" || confirmation.kind === "observed")
    return true;
  return (
    freshValueOf(candidate, confirmation.write) ===
    freshValueOf(confirmation.record, confirmation.write)
  );
}

function coversConfirmations(
  list: AnnotationList | undefined,
  confirmations: readonly AnnotationConfirmation[] | undefined,
): boolean {
  return (
    confirmations?.every((confirmation) =>
      coversConfirmation(list, confirmation),
    ) ?? true
  );
}

/**
 * One capability as the value the change log compares by, which is the shared
 * reason plus a cooldown's own deadline: a log line per new deadline is what
 * says the rate limit was met again, where a notice counts one cooldown once.
 */
function describeCapability(capability: EditingCapability): string {
  return capability.kind === "cooldown"
    ? `cooldown:${capability.retryAfter.toString()}`
    : capabilityReason(capability);
}

const toRecords = Effect.fnUntraced(function* (
  attachmentKey: string,
  found: {
    readonly attachment: Attachment | null;
    readonly annotations: readonly Annotation[];
    readonly accountUserID: number | null;
  },
): Effect.fn.Return<readonly AnnotationRecord[]> {
  const { attachment } = found;
  if (!attachment) {
    yield* Effect.logDebug("No Zotero attachment answers this key").pipe(
      Effect.annotateLogs({ attachmentKey }),
    );
    return [];
  }
  const contentType = attachment.contentType ?? "";
  // Read with each list, so an account's first sync moves the locks too.
  const userID = found.accountUserID;
  return found.annotations.map((annotation) =>
    toRecord(annotation, { attachmentKey, contentType, userID }),
  );
});

function databaseAnnotationSource(
  attachmentKey: string,
  libraries: readonly Library[],
  database: ZoteroDatabaseIdentity,
): Effect.Effect<DatabaseAnnotationSource, AnnotationLibraryUnresolved> {
  const target = resolveIndexedKeyLibraryIn(libraries, attachmentKey);
  if (!target) return new AnnotationLibraryUnresolved({ attachmentKey });
  const library = libraries.find(
    ({ libraryID }) => libraryID === target.libraryID,
  );
  return Effect.succeed({
    kind: "zotero-db",
    database,
    libraryID: target.libraryID,
    libraryRevision: library?.clientVersion ?? null,
  });
}

function toRecord(
  annotation: Annotation,
  {
    attachmentKey,
    contentType,
    userID,
  }: { attachmentKey: string; contentType: string; userID: number | null },
): AnnotationRecord {
  return {
    key: annotation.indexedKey,
    type: annotationTypeToName(annotation.type),
    color: annotation.color,
    comment: annotation.comment,
    text: annotation.text,
    parentKey: attachmentKey,
    pageLabel: annotation.pageLabel,
    sortIndex: annotation.sortIndex,
    tags: annotation.tags,
    tagDetails: annotation.tagDetails,
    position: parseAnnotationPosition(annotation.position, contentType),
    version: annotation.version,
    lock: lockOf(annotation, userID),
    templateMetadata: {
      dateAdded: annotation.dateAdded.toString(),
      dateModified: annotation.dateModified.toString(),
      authorName: annotation.authorName,
      isExternal: annotation.isExternal,
      tags: templateTags(annotation.tagDetails),
    },
  };
}

export {
  inRepository,
  read,
  hold,
  refresh,
  peek,
  capabilityFor,
  capability,
  editingCapability,
  announceReadPixels,
  holding,
  prepareCollection,
  attachmentHolding,
  prepareWrite,
  dropAttachment,
  refreshLocks,
  sourceMoved,
  dropDatabasePartition,
  compatibleApiSource,
  sourceStillBound,
  rememberAcknowledgedRevision,
};
