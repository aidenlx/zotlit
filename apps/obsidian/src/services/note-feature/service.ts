// The Note Feature: Literature Note writes, creation planning and Profile switches, as one service.
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  PubSub,
  Ref,
  Stream,
  SynchronizedRef,
} from "effect";
import type { TFile } from "obsidian";

import type { Item } from "@zotlit/db";

import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Vault } from "@/lib/obsidian-vault";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { collectExcerptSummary } from "@/services/excerpt-image/prepare";
import type { ExcerptSummary } from "@/services/excerpt-image/prepare";
import {
  itemKeyFromFrontmatter,
  NoteIndex,
} from "@/services/note-index/service";

import {
  getImportedNotesForItem,
  planCreations,
  prepareProfileNote,
  prepareProfileSwitch,
  resolveCompanionNote,
  resolveCreationProfile,
} from "./creation-planning";
import type {
  CreationPlanningServices,
  PlannedCreation,
  PreparedProfileNote,
} from "./creation-planning";
import { refusedCreate } from "./diagnostics";
import type {
  CompanionNoteTarget,
  CreateNoteInternalOptions,
  CreateNoteOptions,
  CreateNoteResult,
  CreationProfileSelection,
  CreationProfileSources,
  NoteFeatureEvent,
  NoteFeatureEventOf,
  NoteFeaturePayloads,
  PreparedProfileSwitch,
  ProfileNotePreviewOptions,
  UpdateResult,
  WriteNoteUpdateOptions,
} from "./types";
import {
  composeEvents,
  createNote,
  overwriteNote,
  replacedKeys,
  switchNoteProfile,
  updateNote,
  writeNoteUpdate,
} from "./write-pipeline";
import type {
  CreateNoteError,
  NoteWriteContext,
  NoteWriteServices,
  OverwriteNoteError,
  SwitchNoteProfileError,
  UpdateNoteError,
  UpdateNoteOptions,
  WriteNoteUpdateError,
} from "./write-pipeline";

/** Notes created that the Note Index has not seen yet, kept per Indexed Key. */
const MAX_UNINDEXED_CREATES = 256;

/** The services the Note Feature reads through their tags. */
export type NoteFeatureServices = NoteWriteServices | CreationPlanningServices;

type Failure<
  F extends (...args: never[]) => Effect.Effect<unknown, unknown, unknown>,
> = Effect.Error<ReturnType<F>>;

/** {@link PreparedProfileNote} whose create runs on the Note Feature's services. */
export type ProfileNoteDraft = Omit<PreparedProfileNote, "create"> & {
  readonly create: Effect.Effect<
    CreateNoteResult,
    Effect.Error<PreparedProfileNote["create"]>
  >;
};

/**
 * The Note Feature: it creates, updates, overwrites and re-stamps Literature
 * Notes, plans their creation, and reports what a write noticed on `changes`.
 * Creates run one at a time per Indexed Key, and a note created before the
 * Note Index saw it refuses a second create.
 */
export class NoteFeature extends Context.Service<
  NoteFeature,
  {
    /**
     * What the writes report, as they happen: the excerpt outcomes of a note
     * with no batch above it, and a legacy frontmatter expression that failed.
     * Ends when the plugin unloads.
     */
    readonly changes: Stream.Stream<NoteFeatureEvent>;
    /** Report a batch's excerpt outcomes on {@link changes}. */
    reportExcerptImages(summary: ExcerptSummary): Effect.Effect<void>;
    /** @see createNote */
    createNote(
      item: Item,
      options?: CreateNoteOptions,
    ): Effect.Effect<CreateNoteResult, CreateNoteError>;
    /** @see updateNote */
    updateNote(
      file: TFile,
      options: UpdateNoteOptions,
    ): Effect.Effect<UpdateResult, UpdateNoteError>;
    /** Re-stamp after consent; the next update renders with the target Profile. */
    switchNoteProfile(
      file: TFile,
      options: {
        profile: ProfileSelector;
        importedNotes?: readonly TFile[];
        move?: boolean;
      },
    ): Effect.Effect<UpdateResult, SwitchNoteProfileError>;
    /** @see replacedKeys */
    replacedKeys(file: TFile): Effect.Effect<ReadonlySet<string>>;
    /** @see overwriteNote */
    overwriteNote(
      file: TFile,
      indexedKey: string,
      options?: Omit<Parameters<typeof overwriteNote>[2], "indexedKey">,
    ): Effect.Effect<UpdateResult, OverwriteNoteError>;
    /**
     * Update a note from an Item the caller read. The caller has settled the
     * Note Index and holds the batch's Snapshot.
     */
    writeNoteUpdate(
      file: TFile,
      options: WriteNoteUpdateOptions,
    ): Effect.Effect<UpdateResult, WriteNoteUpdateError>;
    /** @see resolveCompanionNote */
    resolveCompanionNote(
      indexedKey: string,
      options?: { profile?: ProfileSelector },
    ): Effect.Effect<CompanionNoteTarget, Failure<typeof resolveCompanionNote>>;
    /** The creation Profile when no Item decides: the given or the Default. */
    resolveCreationProfile(
      sources?: CreationProfileSources,
    ): Effect.Effect<
      CreationProfileSelection,
      Failure<typeof resolveCreationProfile>
    >;
    /**
     * How each Indexed Key's note would be created, by key. Each preview's
     * create enters this feature's create gate.
     */
    planCreations(
      indexedKeys: readonly string[],
      sources?: CreationProfileSources,
    ): Effect.Effect<
      ReadonlyMap<string, PlannedCreation>,
      Failure<typeof planCreations>
    >;
    /** @see prepareProfileNote */
    prepareProfileNote(
      options: ProfileNotePreviewOptions,
    ): Effect.Effect<ProfileNoteDraft, Failure<typeof prepareProfileNote>>;
    /** @see prepareProfileSwitch */
    prepareProfileSwitch(
      file: TFile,
    ): Effect.Effect<
      PreparedProfileSwitch,
      Failure<typeof prepareProfileSwitch>
    >;
    /** Imported Notes currently materialized for one Zotero item. */
    getImportedNotesForItem(
      indexedKey: string,
    ): Effect.Effect<TFile[], Failure<typeof getImportedNotesForItem>>;
  }
>()("zotlit/obsidian/NoteFeature") {}

/**
 * The Note Feature over the graph's tags. Closing the layer ends
 * {@link NoteFeature.changes}.
 */
export const layerNoteFeature = Layer.effect(
  NoteFeature,
  Effect.gen(function* () {
    const context = yield* Effect.context<NoteFeatureServices>();
    const provide = <A, E>(effect: Effect.Effect<A, E, NoteFeatureServices>) =>
      Effect.provideContext(effect, context);
    const events = yield* Effect.acquireRelease(
      PubSub.unbounded<NoteFeatureEvent>(),
      (pubsub) => PubSub.shutdown(pubsub),
    );
    const ctx: NoteWriteContext = {
      emit: (event) => void PubSub.publishUnsafe(events, event),
    };
    const createAtGate = yield* makeCreateGate((item, options) =>
      provide(createNote(ctx, item, options)),
    );
    const create = (item: Item, options: CreateNoteInternalOptions) =>
      provide(createAtGate(item, options));
    return NoteFeature.of({
      changes: Stream.fromPubSub(events),
      reportExcerptImages: Effect.fn("NoteFeature.reportExcerptImages")(
        function* (summary) {
          yield* PubSub.publish(events, {
            _tag: "excerpt-images-reported",
            payload: summary,
          });
        },
      ),
      createNote: Effect.fn("NoteFeature.createNote")((item, options = {}) =>
        create(item, options),
      ),
      updateNote: Effect.fn("NoteFeature.updateNote")((file, options) =>
        provide(updateNote(ctx, file, options)),
      ),
      switchNoteProfile: Effect.fn("NoteFeature.switchNoteProfile")(
        (file, options) => provide(switchNoteProfile(file, options)),
      ),
      replacedKeys: Effect.fn("NoteFeature.replacedKeys")((file) =>
        provide(replacedKeys(ctx, file)),
      ),
      overwriteNote: Effect.fn("NoteFeature.overwriteNote")(
        (file, indexedKey, options) =>
          provide(overwriteNote(ctx, file, { ...options, indexedKey })),
      ),
      writeNoteUpdate: Effect.fn("NoteFeature.writeNoteUpdate")(
        (file, options) => provide(writeNoteUpdate(ctx, file, options)),
      ),
      resolveCompanionNote: Effect.fn("NoteFeature.resolveCompanionNote")(
        (indexedKey, options) =>
          provide(resolveCompanionNote(indexedKey, options)),
      ),
      resolveCreationProfile: Effect.fn("NoteFeature.resolveCreationProfile")(
        (sources) => provide(resolveCreationProfile(sources)),
      ),
      planCreations: Effect.fn("NoteFeature.planCreations")(
        (indexedKeys, sources = {}) =>
          provide(planCreations(indexedKeys, { ...sources, create })),
      ),
      prepareProfileNote: Effect.fn("NoteFeature.prepareProfileNote")(
        (options) =>
          provide(
            prepareProfileNote(options, {
              create,
              events: composeEvents(ctx),
            }),
          ).pipe(
            Effect.map((preview): ProfileNoteDraft => ({
              ...preview,
              create: provide(preview.create),
            })),
          ),
      ),
      prepareProfileSwitch: Effect.fn("NoteFeature.prepareProfileSwitch")(
        (file) => provide(prepareProfileSwitch(file)),
      ),
      getImportedNotesForItem: Effect.fn("NoteFeature.getImportedNotesForItem")(
        (indexedKey) => provide(getImportedNotesForItem(indexedKey)),
      ),
    });
  }),
);

/**
 * The payloads of `event` on `changes`, each in its `NoteFeaturePayloads`
 * shape.
 */
export const eventPayloads = <K extends keyof NoteFeaturePayloads>(
  changes: Stream.Stream<NoteFeatureEvent>,
  event: K,
): Stream.Stream<NoteFeaturePayloads[K]> =>
  changes.pipe(
    Stream.filter(
      (change): change is NoteFeatureEventOf<K> & NoteFeatureEvent =>
        change._tag === event,
    ),
    Stream.map((change) => change.payload),
  );

/**
 * Collect one operation's excerpt outcomes. When the scope closes, their
 * total reports on {@link NoteFeature.changes}.
 */
export const collectExcerptReports = Effect.gen(function* () {
  const feature = yield* NoteFeature;
  const collector = yield* Effect.acquireRelease(
    Effect.sync(() => collectExcerptSummary()),
    (reports) =>
      Effect.suspend(() => {
        const total = reports.total();
        return total ? feature.reportExcerptImages(total) : Effect.void;
      }),
  );
  return { add: collector.add };
});

/**
 * The create gate: one create per Indexed Key at a time, and a refusal for a
 * note created before the Note Index saw it. A create that arrives while one
 * runs for the same key waits for it, and is refused when it created a note;
 * when the running create was interrupted, the waiting one enters the gate
 * again. The last {@link MAX_UNINDEXED_CREATES} created notes are remembered.
 */
export const makeCreateGate = Effect.fnUntraced(function* (
  write: (
    item: Item,
    options: CreateNoteInternalOptions & {
      onFileCreated: (file: TFile) => Effect.Effect<void>;
    },
  ) => Effect.Effect<CreateNoteResult, CreateNoteError>,
) {
  const pending = yield* SynchronizedRef.make<ReadonlyMap<string, CreateRun>>(
    new Map(),
  );
  const createdBeforeIndex = yield* Ref.make(new Map<string, TFile>());

  const remember = (indexedKey: string, file: TFile) =>
    Ref.update(createdBeforeIndex, (created) => {
      const next = new Map(created);
      if (next.size >= MAX_UNINDEXED_CREATES && !next.has(indexedKey)) {
        const oldest = next.keys().next().value;
        if (oldest !== undefined) next.delete(oldest);
      }
      next.set(indexedKey, file);
      return next;
    });
  const forget = (indexedKey: string) =>
    Ref.update(createdBeforeIndex, (created) => {
      if (!created.has(indexedKey)) return created;
      const next = new Map(created);
      next.delete(indexedKey);
      return next;
    });

  /** The refusal a note created before the Note Index saw it gives. */
  const recentRefusal = Effect.fnUntraced(function* (indexedKey: string) {
    const recent = (yield* Ref.get(createdBeforeIndex)).get(indexedKey);
    if (!recent) return undefined;
    const indexed = yield* (yield* NoteIndex).getNotesByItemKey(indexedKey);
    if (indexed.length > 0) {
      yield* forget(indexedKey);
      return refusedCreate(indexedKey, indexed);
    }
    if ((yield* (yield* Vault).getAbstractFileByPath(recent.path)) === recent) {
      const cache = yield* (yield* MetadataCache).fileCache(recent);
      if (cache === null || itemKeyFromFrontmatter(cache) === indexedKey) {
        return refusedCreate(indexedKey, [recent]);
      }
    }
    yield* forget(indexedKey);
    return undefined;
  });

  const gate = (
    item: Item,
    options: CreateNoteInternalOptions,
  ): Effect.Effect<
    CreateNoteResult,
    CreateNoteError,
    MetadataCache | NoteIndex | Vault
  > => {
    const { indexedKey } = item;
    const enter = (
      creates: ReadonlyMap<string, CreateRun>,
    ): Effect.Effect<
      readonly [GateStep, ReadonlyMap<string, CreateRun>],
      never,
      MetadataCache | NoteIndex | Vault
    > =>
      Effect.gen(function* () {
        const running = creates.get(indexedKey);
        if (running) return [{ wait: running }, creates] as const;
        const refused = yield* recentRefusal(indexedKey);
        if (refused) return [{ refused }, creates] as const;
        const started =
          yield* Deferred.make<Exit.Exit<CreateNoteResult, CreateNoteError>>();
        return [
          { started },
          new Map(creates).set(indexedKey, started),
        ] as const;
      });
    // The entry cannot be interrupted, so a started run always reaches its
    // release, which completes its Deferred and frees the key.
    return Effect.acquireUseRelease(
      SynchronizedRef.modifyEffect(pending, enter),
      (step) => {
        if ("refused" in step) return Effect.succeed(step.refused);
        if ("wait" in step)
          return Effect.flatMap(Deferred.await(step.wait), (exit) =>
            Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
              ? gate(item, options)
              : Effect.map(exit, (result) =>
                  result.outcome === "created"
                    ? refusedCreate(indexedKey, [result.file])
                    : result,
                ),
          );
        return write(item, {
          ...options,
          onFileCreated: (file) => remember(indexedKey, file),
        });
      },
      (step, exit) =>
        "started" in step
          ? Deferred.succeed(step.started, exit).pipe(
              Effect.andThen(
                SynchronizedRef.update(pending, (creates) => {
                  if (creates.get(indexedKey) !== step.started) return creates;
                  const next = new Map(creates);
                  next.delete(indexedKey);
                  return next;
                }),
              ),
            )
          : Effect.void,
    );
  };
  return gate;
});

/**
 * One create running at the gate, completed with how it ended; a create for
 * the same key waits on it.
 */
type CreateRun = Deferred.Deferred<
  Exit.Exit<CreateNoteResult, CreateNoteError>
>;

/** What a create finds at the gate: a run to wait on, a refusal, or its turn. */
type GateStep =
  | { readonly wait: CreateRun }
  | { readonly refused: CreateNoteResult }
  | { readonly started: CreateRun };
