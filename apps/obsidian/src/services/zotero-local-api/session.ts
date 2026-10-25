// Reads Zotero's data live, from the local API a running Zotero serves on loopback.
import {
  Clock,
  Deferred,
  Duration,
  Effect,
  Fiber,
  PubSub,
  RcRef,
  Ref,
  Semaphore,
} from "effect";
import type { HttpClientError } from "effect/http";
import * as v from "valibot";

import { parseIndexedKey } from "@zotlit/db";

import { instantClock } from "@/lib/effect-clock";
import { withLogCategory } from "@/lib/effect-log";
import { exchangeWithZotero, parseJson, zoteroOrigin } from "@/lib/zotero-http";
import type { ZoteroHttp, ZoteroMethod } from "@/lib/zotero-http";

import {
  API_VERSION,
  AUTHORIZE_PATH,
  classifyReply,
  CLIENT_NAME,
  invalid,
  isServerID,
  libraryPath,
  NO_CACHE_HEADERS,
  readAnnotationItem,
  readAnnotationPage,
  readGrant,
  totalResults,
} from "./wire";
import type {
  AuthorizationGrant,
  LocalApiAnnotation,
  LocalApiFailure,
  LocalApiResult,
  ZoteroReply,
} from "./wire";
import type { WriteAuthorizationStore } from "./write-authorization";

export type {
  AuthorizationGrant,
  LocalApiAnnotation,
  LocalApiFailure,
  LocalApiResult,
} from "./wire";
export type {
  SecretStore,
  WriteAuthorizationStore,
} from "./write-authorization";

/** The category every record of the session is filed under. */
const LOG_CATEGORY = "zotero-local-api";

/** How many Annotations one page of the list route asks for. */
const PAGE_SIZE = 100;

/**
 * How long the Capability Probe waits for Zotero. A Zotero that has not
 * answered by then is not answering: the probe is time-bounded so a hung
 * server cannot hold the Annotation Source undecided.
 */
const PROBE_TIMEOUT = Duration.seconds(5);

/**
 * The Annotation Source the Zotero Local API is, carrying the server id that
 * partitions its read cache. A record set from one server never joins one from
 * another, and the id is the only place a server is named.
 *
 * @see apps/obsidian/docs/adr/0033-zotero-object-identity-is-the-indexed-key-server-id-is-source-data.md
 */
export interface LocalApiSource {
  kind: "zotero-local-api";
  /** Zotero's 12-character per-database id, from the Capability Probe. */
  serverID: string;
}

/**
 * What the Capability Probe knows, which is everything this client alone can
 * say about a session. The Editing Capability is computed from it by the
 * annotation repository, where one Attachment's other facts are.
 *
 * @see apps/obsidian/src/services/annotation-repository/capability.ts
 */
export type LocalApiState =
  /** No probe has answered yet — none has run, or one is running now. */
  | { kind: "probing" }
  | {
      kind: "available";
      source: LocalApiSource;
      /**
       * Whether a Remembered Authorization for {@link source} is in
       * SecretStorage.
       */
      authorized: boolean;
    }
  | { kind: "unavailable"; failure: LocalApiFailure };

/**
 * What the write path knows about one Attachment beside the Capability Probe.
 * The repository folds it into that Attachment's Editing Capability; none of it
 * outlives the session.
 *
 * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
 */
export interface WriteAuthorizationState {
  /** A gesture is at Zotero's dialog now. */
  authorizing: boolean;
  /** Zotero refused a write to this Attachment's library this session. */
  libraryReadOnly: boolean;
  /** When Zotero's dialog rate limit lifts, or null while none is running. */
  cooldownUntil: Temporal.Instant | null;
}

export type LocalApiEvent =
  /**
   * What this source answers may have moved: a probe that changed the
   * capability, a Zotero database swapped under the port, or the Companion's
   * Freshness Signal. A consumer drops what it holds from this source and
   * reads again; nothing here says which records changed.
   */
  | { readonly _tag: "changed" }
  /**
   * What a surface may do to this source moved: a probe landed, a gesture
   * started or ended, Zotero granted or refused a key, or a library turned out
   * to be read-only. A consumer re-reads the Editing Capability; no record set
   * is affected.
   */
  | { readonly _tag: "capability-changed" }
  /**
   * Zotero refused a write, for the surface that rolls the change back and says
   * why. Every refusal is announced; what one means for the change itself is
   * the caller's (aidenlx/zotlit#1145).
   *
   * @param library the library the write targeted, as the route spells it.
   */
  | {
      readonly _tag: "write-refused";
      readonly failure: LocalApiFailure;
      readonly library: string;
    }
  /**
   * Another Zotero database now answers on the port than the session held, and
   * this probe has adopted it. Raised where the change is detected and settled,
   * so a surface hears it however the change was found: a probe, a read that
   * quarantined the session, or a write whose `412` sent the probe looking.
   *
   * @param serverID the database that answers now.
   * @see apps/obsidian/docs/adr/0033-zotero-object-identity-is-the-indexed-key-server-id-is-source-data.md
   */
  | { readonly _tag: "server-changed"; readonly serverID: string }
  /**
   * A Capability Probe retired the write refusals this session remembered: a
   * library that stood read-only may be writable again. A surface that stood a
   * control down may stand it up, and a refusal that follows is news rather
   * than the same refusal twice.
   *
   * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
   */
  | { readonly _tag: "write-refusals-retired" };

/** What one request that spends a Write Authorization carries. */
export interface AuthorizedSendOptions {
  /**
   * The library the write targets, as the route spells it, so a refusal marks
   * that one read-only for the session.
   */
  library: string;
  /** Hold the database identity across asynchronous credential reads. */
  expectedServerID?: string;
  /** Background read Uses update state without edit notices. */
  silent?: boolean;
  method: ZoteroMethod;
  body?: string;
  headers?: Readonly<Record<string, string>>;
}

export interface LocalApiSessionDeps {
  /** The `ZoteroHttp` loopback client. */
  http: ZoteroHttp["Service"];
  /** Zotero's HTTP port. */
  httpPort: Effect.Effect<number | null>;
  /** Where the session announces what it learns. */
  bus: PubSub.PubSub<LocalApiEvent>;
  credentials: WriteAuthorizationStore;
}

/** {@link LocalApiState}, plus the state before anything has asked. */
type ProbeState = LocalApiState | { kind: "unprobed" };

/**
 * The Capability Probe in flight, and what the signals that joined it still
 * owe. They share one Ref so that the last check for a move and the release of
 * the probe are one step.
 */
interface ProbeSlot {
  /** Settles when the probe in flight has, announcement included; null while none runs. */
  readonly done: Deferred.Deferred<void> | null;
  /** A Freshness Signal to announce once the probe settles. */
  readonly moved: boolean;
  /**
   * A move of the resolved paths, so the answer of the probe in flight is
   * about the port it asked before the move.
   */
  readonly stale: boolean;
}

/** The read write-backs of one `serverID/attachmentKey`, one at a time. */
interface ReadQueue {
  readonly permits: Semaphore.Semaphore;
  /** Write-backs waiting or running; the queue is dropped at zero. */
  users: number;
}

/**
 * Zotero's local API, as far as reading goes: a Capability Probe that decides
 * whether this source answers at all, and the Annotations of one Attachment.
 *
 * The probe is the sole authority on "local API disabled" — Zotero's preference
 * file supplies the port and nothing else — and it runs lazily on the first
 * demand, again on the Companion's Freshness Signal, and again when the
 * resolved Zotero paths move.
 *
 * Reads need no key: an unauthorized session still reads every Annotation.
 * Authorization gates writes alone, and this client asks the credential store
 * only to tell a session that could write from one that must ask first.
 *
 * The session lives on the Scope it is made in: a read write-back and the probe
 * run on that Scope and are interrupted, and awaited, when it closes.
 *
 * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
 * @see apps/obsidian/docs/adr/0036-local-api-enablement-is-a-guided-manual-step-in-zotero.md
 */
export const makeLocalApiSession = Effect.fnUntraced(function* ({
  http,
  httpPort,
  bus,
  credentials,
}: LocalApiSessionDeps) {
  const scope = yield* Effect.scope;
  const now = instantClock(yield* Clock.Clock);
  const state = yield* Ref.make<ProbeState>({ kind: "unprobed" });
  /** What the last probe announced, so a probe that learned nothing new stays quiet. */
  const announced = yield* Ref.make<ProbeState>({ kind: "unprobed" });
  const probeSlot = yield* Ref.make<ProbeSlot>({
    done: null,
    moved: false,
    stale: false,
  });
  /** A gesture is at Zotero's dialog now. */
  const authorizing = yield* Ref.make(false);
  /**
   * The libraries Zotero refused a write to this session, as the route names
   * them. Cleared by the next Capability Probe.
   */
  const readOnlyLibraries = yield* Ref.make<ReadonlySet<string>>(new Set());
  /** When Zotero's authorization-dialog rate limit lifts. */
  const cooldownUntil = yield* Ref.make<Temporal.Instant | null>(null);
  /** In-flight read writes only; completed and failed Uses are never replayed. */
  const readQueues = new Map<string, ReadQueue>();

  const publish = (event: LocalApiEvent) =>
    PubSub.publish(bus, event).pipe(Effect.asVoid);

  // The credential store speaks Promise. Its callers never handled a rejection
  // (only `remember` can refuse, and `granted` catches it), so one is a defect.
  const storedKey = (serverID: string) =>
    Effect.tryPromise(() => credentials.read(serverID)).pipe(Effect.orDie);
  const forgetKey = Effect.tryPromise(() => credentials.forget()).pipe(
    Effect.orDie,
  );
  /** Whether a Remembered Authorization is stored for `serverID`. */
  const hasKey = (serverID: string) =>
    Effect.map(storedKey(serverID), (key) => key !== null);

  const heldServerID = Effect.map(Ref.get(state), serverIDOf);

  const setAuthorized = Effect.fnUntraced(function* (authorized: boolean) {
    const changed = yield* Ref.modify(
      state,
      (current): readonly [boolean, ProbeState] =>
        current.kind !== "available" || current.authorized === authorized
          ? [false, current]
          : [true, { ...current, authorized }],
    );
    if (changed) yield* publish({ _tag: "capability-changed" });
  });

  /**
   * One request, with the headers every Zotero Local API call carries.
   *
   * @param options.serverID the Zotero database this call is for, sent as the
   *   precondition Zotero answers `412` to when another one holds the port.
   *   The Capability Probe sends none: it is what learns the id.
   * @param options.headers what this one call adds — the API key, a write
   *   token, a version precondition, a content type.
   */
  const send = Effect.fnUntraced(function* (
    path: string,
    options: {
      serverID: string | null;
      method?: ZoteroMethod;
      body?: string;
      headers?: Readonly<Record<string, string>>;
    },
  ): Effect.fn.Return<LocalApiResult<ZoteroReply>> {
    const port = yield* httpPort;
    if (port === null) {
      yield* Effect.logDebug(
        "Zotero runs on a port its profile cannot disclose",
      );
      return { failure: { kind: "unreachable" } };
    }
    const { serverID, method, body } = options;
    return yield* exchangeWithZotero(http, {
      port,
      path,
      method,
      body,
      headers: {
        ...NO_CACHE_HEADERS,
        ...(serverID !== null && { "Zotero-Server-ID": serverID }),
        ...options.headers,
      },
    }).pipe(
      Effect.map((reply): LocalApiResult<ZoteroReply> => {
        const failure = classifyReply(reply, serverID);
        return failure ? { failure } : { value: reply };
      }),
      Effect.catch((error): Effect.Effect<LocalApiResult<ZoteroReply>> =>
        // The transport itself aborted, as `fetch` reports a connection that
        // dropped under a request: the request left and no answer came.
        isTransportAbort(error)
          ? Effect.succeed({ failure: { kind: "unknown-outcome" } })
          : Effect.logDebug("Zotero's HTTP server did not answer").pipe(
              Effect.annotateLogs({
                url: `${zoteroOrigin(port)}${path}`,
                error,
              }),
              Effect.as({ failure: { kind: "unreachable" } }),
            ),
      ),
    );
  });

  /** The session one `GET /api/` answered, or why there is none. */
  const sessionFrom = Effect.fnUntraced(function* (
    reply: ZoteroReply,
  ): Effect.fn.Return<ProbeState> {
    const version = reply.headers.get("zotero-api-version");
    if (version !== API_VERSION) {
      return { kind: "unavailable", failure: { kind: "incompatible-zotero" } };
    }
    const serverID = reply.headers.get("zotero-server-id");
    // Zotero 9 speaks API version 3 but serves reads only and sends no server
    // id, which Zotero 10 added with writes — so an absent id is a Zotero too
    // old to edit, not an answer ZotLit cannot read.
    // @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/server/server_localAPI.js#L382-L391
    if (serverID === null) {
      return { kind: "unavailable", failure: { kind: "incompatible-zotero" } };
    }
    if (!isServerID(serverID)) {
      return { kind: "unavailable", failure: invalid(`server id ${serverID}`) };
    }
    yield* Effect.logDebug("Zotero answered its local API").pipe(
      Effect.annotateLogs({
        serverID,
        schemaVersion: reply.headers.get("zotero-schema-version"),
      }),
    );
    return {
      kind: "available",
      source: { kind: "zotero-local-api", serverID },
      authorized: yield* hasKey(serverID),
    };
  });

  /**
   * Drops the libraries this session saw Zotero refuse writes to, and says so.
   * Announced rather than silent, because a surface that stood a control down
   * on the refusal has to know the mark behind it has gone.
   */
  const retireWriteRefusals = Effect.gen(function* () {
    const retired = yield* Ref.modify(
      readOnlyLibraries,
      (libraries): readonly [boolean, ReadonlySet<string>] =>
        libraries.size === 0 ? [false, libraries] : [true, new Set()],
    );
    if (retired) yield* publish({ _tag: "write-refusals-retired" });
  });

  const probe = Effect.fnUntraced(function* (reason: string, silent: boolean) {
    const previous = yield* Ref.get(state);
    const heldServerIDBefore = serverIDOf(previous);
    // A re-probe keeps what the last one answered until this one lands, so the
    // Annotation Source does not swap twice for a signal that changed nothing.
    if (previous.kind === "unprobed")
      yield* Ref.set(state, { kind: "probing" });
    // A library Zotero refused a write to is a session fact the probe is
    // allowed to retire: the group's permissions may well have changed.
    yield* retireWriteRefusals;
    yield* Ref.update(probeSlot, (slot) => ({ ...slot, stale: false }));
    // A probe its own deadline ended is an aborted one: `unknown-outcome`,
    // which `probeFailure` reads as a Zotero that does not answer.
    const reply = yield* send("/api/", { serverID: null }).pipe(
      Effect.timeoutOrElse({
        duration: PROBE_TIMEOUT,
        orElse: () =>
          Effect.succeed<LocalApiResult<ZoteroReply>>({
            failure: { kind: "unknown-outcome" },
          }),
      }),
    );
    const next: ProbeState =
      "failure" in reply
        ? { kind: "unavailable", failure: probeFailure(reply.failure) }
        : yield* sessionFrom(reply.value);
    // The resolved paths moved while the request was out: the answer is about
    // the port asked before the move, and the probe that follows replaces it.
    if ((yield* Ref.get(probeSlot)).stale) {
      yield* Effect.logDebug(
        "Zotero Local API probe discarded: the resolved paths moved",
      ).pipe(Effect.annotateLogs({ reason, answered: next }));
      return;
    }
    yield* Ref.set(state, next);
    yield* Effect.logDebug("Zotero Local API probed").pipe(
      Effect.annotateLogs({
        reason,
        was: previous.kind,
        state: next,
        ...("failure" in reply ? { answered: reply.failure } : {}),
      }),
    );
    // A focus inside the reader probes again, and every surface redraws on the
    // announcement — so one that changed nothing would rebuild a control under
    // the pointer and swallow the press.
    if (!sameProbeState(yield* Ref.get(announced), next)) {
      yield* Ref.set(announced, next);
      yield* publish({ _tag: "capability-changed" });
    }
    // The one place a swapped database is both detected and settled. A read
    // that quarantined the session and a write that answered `412` both send a
    // probe looking, so every route to a change ends here.
    const adopted = serverIDOf(next);
    if (
      adopted !== null &&
      heldServerIDBefore !== null &&
      adopted !== heldServerIDBefore
    ) {
      yield* Effect.logDebug("Another Zotero database answers this port").pipe(
        Effect.annotateLogs({ was: heldServerIDBefore, serverID: adopted }),
      );
      if (!silent)
        yield* publish({ _tag: "server-changed", serverID: adopted });
    }
  });

  /**
   * One Capability Probe, and the announcement it earns.
   *
   * A probe that leaves the same server answering has superseded nothing, so it
   * says nothing: a startup probe against a closed Zotero must not make every
   * surface re-read. What does earn the announcement is a source that appeared,
   * went, or turned out to be another database — and a signal that says the
   * data moved whatever the probe finds.
   *
   * A signal that lands while a probe is already running is coalesced into it
   * rather than dropped, so a Freshness Signal always reaches the partition it
   * invalidates however it is timed against the probe. A move of the resolved
   * paths is the exception (#1645): the probe in flight read the port before
   * the move, so its answer is about another Zotero. That answer is discarded
   * unseen, and the probe runs again before it settles for everyone waiting on
   * it. The last check for a move and the release of the probe happen in one
   * step, so no move can join a probe that has already finished.
   *
   * The probe runs on the Scope of the session, not on the fiber that asked,
   * so a caller that leaves does not strand the demands that joined it.
   *
   * @param options.moved whether the trigger itself says this source's records
   *   changed, which is only ever true of the source that is standing.
   * @param options.silent whether a server change goes unannounced.
   * @param options.stale whether the trigger moved the port a running probe
   *   asked.
   * @returns what settles when the probe does.
   */
  const startProbe = Effect.fnUntraced(function* (
    reason: string,
    {
      moved = false,
      silent = false,
      stale = false,
    }: { moved?: boolean; silent?: boolean; stale?: boolean } = {},
  ) {
    const before = yield* heldServerID;
    const done = Deferred.makeUnsafe<void>();
    const running = yield* Ref.modify(
      probeSlot,
      (slot): readonly [Deferred.Deferred<void> | null, ProbeSlot] =>
        slot.done === null
          ? [null, { ...slot, done, moved: slot.moved || moved }]
          : [
              slot.done,
              {
                ...slot,
                moved: slot.moved || moved,
                stale: slot.stale || stale,
              },
            ],
    );
    if (running !== null) return running;

    const settle = Effect.gen(function* () {
      yield* probe(reason, silent);
      for (;;) {
        const released = yield* Ref.modify(
          probeSlot,
          (slot): readonly [{ moved: boolean } | null, ProbeSlot] =>
            slot.stale
              ? [null, slot]
              : [
                  { moved: slot.moved },
                  { done: null, moved: false, stale: false },
                ],
        );
        if (released !== null) {
          const serverID = yield* heldServerID;
          if (serverID !== before || (released.moved && serverID !== null)) {
            yield* publish({ _tag: "changed" });
          }
          return;
        }
        yield* probe("resolved paths moved during a probe", silent);
      }
    }).pipe(
      Effect.ensuring(
        Ref.update(probeSlot, (slot) =>
          slot.done === done
            ? { done: null, moved: false, stale: false }
            : slot,
        ).pipe(Effect.andThen(Deferred.succeed(done, undefined))),
      ),
    );
    yield* Effect.forkIn(settle, scope, { startImmediately: true });
    return done;
  });

  const reprobe = Effect.fnUntraced(function* (
    reason: string,
    options?: { moved?: boolean; silent?: boolean; stale?: boolean },
  ) {
    yield* Deferred.await(yield* startProbe(reason, options));
  });

  /** What a refused authorization leaves behind, beside the failure itself. */
  const refused = Effect.fnUntraced(function* (failure: LocalApiFailure) {
    if (failure.kind === "cooldown") {
      yield* Ref.set(cooldownUntil, now().add(failure.retryAfter));
      yield* publish({ _tag: "capability-changed" });
    }
    yield* Effect.logDebug("Zotero granted no write authorization").pipe(
      Effect.annotateLogs({ failure: failure.kind }),
    );
    return failure;
  });

  /** Zotero's dialog cooldown, while one is running. */
  const cooling = Effect.gen(function* () {
    const until = yield* Ref.get(cooldownUntil);
    if (until === null) return null;
    const current = now();
    if (Temporal.Instant.compare(until, current) <= 0) {
      yield* Ref.set(cooldownUntil, null);
      return null;
    }
    const failure: LocalApiFailure = {
      kind: "cooldown",
      retryAfter: current.until(until),
    };
    return failure;
  });

  /**
   * What Zotero granted, kept only when it outlives the write that spends it.
   *
   * An Always Allow goes to SecretStorage and is never held here. An Allow, and
   * an Always Allow that SecretStorage refuses, are discarded unsent: every write
   * reads its key from SecretStorage, so a key kept nowhere is never used.
   *
   * @see apps/obsidian/docs/adr/0062-editing-requires-a-remembered-authorization-and-allow-leaves-zotlit-read-only.md
   */
  const granted = Effect.fnUntraced(function* (
    serverID: string,
    grant: AuthorizationGrant,
  ): Effect.fn.Return<LocalApiResult<void>> {
    if (!grant.remember) {
      yield* Effect.logDebug(
        "Zotero answered Allow, which ZotLit does not keep",
      ).pipe(Effect.annotateLogs({ serverID }));
      return { failure: { kind: "not-remembered" } };
    }
    const saved = yield* Effect.tryPromise(() =>
      credentials.remember(serverID, grant.key),
    ).pipe(
      Effect.as(true),
      Effect.catch((failure) =>
        Effect.logWarning("The write authorization could not be saved").pipe(
          Effect.annotateLogs({ serverID, error: failure.cause }),
          Effect.as(false),
        ),
      ),
    );
    if (!saved) return { failure: { kind: "not-saved" } };
    yield* setAuthorized(true);
    return { value: undefined };
  });

  /**
   * One authorization gesture, from the probe it starts with to the grant or
   * the refusal it ends on.
   */
  const authorizeBody: Effect.Effect<LocalApiResult<void>> = Effect.gen(
    function* () {
      const probing = yield* startProbe("authorization gesture");
      yield* Ref.set(authorizing, true);
      yield* publish({ _tag: "capability-changed" });
      yield* Deferred.await(probing);
      const current = yield* Ref.get(state);
      if (current.kind !== "available") {
        return { failure: noSessionFailure(current) };
      }
      // An authorization already in hand is the answer; raising Zotero's dialog
      // for it would cost the user a click and spend a rate-limit slot.
      if (current.authorized) return { value: undefined };

      const cooldown = yield* cooling;
      if (cooldown) return { failure: cooldown };

      const { serverID } = current.source;
      yield* Effect.logDebug("Asking Zotero for a write authorization").pipe(
        Effect.annotateLogs({ serverID }),
      );
      const reply = yield* send(AUTHORIZE_PATH, {
        serverID,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appName: CLIENT_NAME }),
      });
      if ("failure" in reply) return { failure: yield* refused(reply.failure) };

      const grant = readGrant(reply.value.text);
      if ("failure" in grant) return grant;
      return yield* granted(serverID, grant.value);
    },
  );

  /**
   * The one authorization request in flight, shared by the gestures waiting on
   * it, so two presses of Allow editing raise one dialog between them. The
   * last gesture to leave interrupts it; a press after it settled starts a new
   * one. Zotero's dialog waits for the user, so the request itself is unbounded.
   *
   * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
   */
  const request = yield* RcRef.make({
    acquire: authorizeBody.pipe(
      Effect.ensuring(
        Ref.set(authorizing, false).pipe(
          Effect.andThen(publish({ _tag: "capability-changed" })),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    ),
  });

  /**
   * What a refused write says about the session: a key Zotero no longer honours
   * is invalidated here and the session returns to "authorization required"; a
   * library that refuses writes is remembered until the next Capability Probe;
   * a `501` says this is not the Zotero the session probed, so it probes again.
   *
   * An edit refusal is announced as `write-refused` whatever it left behind, so
   * one surface owns both the rollback and the notice.
   */
  const writeRefused = Effect.fnUntraced(function* (
    failure: LocalApiFailure,
    library: string,
    silent = false,
  ) {
    if (!silent) yield* publish({ _tag: "write-refused", failure, library });
    // Both say the session's reading of this Zotero is out of date: a `501`
    // that it is the wrong version, a `412` that it is another database. The
    // probe re-reads it, adopts what it finds, and every surface settles on the
    // same answer — which is also where a server change is announced.
    if (
      failure.kind === "incompatible-zotero" ||
      failure.kind === "server-changed"
    ) {
      const probing = yield* startProbe(`a write met ${failure.kind}`, {
        silent,
      });
      if (silent) yield* Deferred.await(probing);
    }
    if (failure.kind === "unauthorized") {
      yield* Effect.logDebug(
        "Zotero no longer honours this write authorization",
      );
      yield* forgetKey;
      yield* setAuthorized(false);
      return;
    }
    if (failure.kind === "library-read-only") {
      yield* Effect.logDebug("Zotero refuses writes to this library").pipe(
        Effect.annotateLogs({ library }),
      );
      yield* Ref.update(readOnlyLibraries, (libraries) =>
        new Set(libraries).add(library),
      );
      yield* publish({ _tag: "capability-changed" });
    }
  });

  /**
   * A read that failed stands the session down, so the next ask lands on the
   * source that can answer it. Every failure a read can meet says this source
   * is not answering reads — they need no key, so even an authorization-shaped
   * refusal is anomalous — and a database swapped under the port is quarantined
   * rather than adopted mid-flight: the next probe decides.
   *
   * The session is stood down and the change announced before the failure is
   * handed back, so the caller that gets it is already reading a client whose
   * source has gone.
   *
   * A cancelled read says nothing about the session and leaves it standing.
   */
  const report = Effect.fnUntraced(function* (result: {
    failure: LocalApiFailure;
  }) {
    const { failure } = result;
    if (failure.kind === "unknown-outcome") return result;
    yield* Effect.logDebug("The Zotero Local API stopped answering").pipe(
      Effect.annotateLogs({ failure }),
    );
    yield* Ref.set(state, { kind: "unavailable", failure });
    yield* publish({ _tag: "changed" });
    return result;
  });

  const writeBackSkipped = (attachmentKey: string, reason: string) =>
    Effect.logTrace("Read write-back skipped").pipe(
      Effect.annotateLogs({ attachmentKey, reason }),
    );

  /** One read write-back at a time per target; different targets run alongside. */
  const queued = <A, E, R>(target: string, work: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const queue = readQueues.get(target) ?? {
          permits: Semaphore.makeUnsafe(1),
          users: 0,
        };
        queue.users += 1;
        readQueues.set(target, queue);
        return queue;
      }),
      (queue) => queue.permits.withPermit(work),
      (queue) =>
        Effect.sync(() => {
          queue.users -= 1;
          if (queue.users === 0) readQueues.delete(target);
        }),
    );

  const writeLastReadNow = Effect.fnUntraced(function* (
    attachmentKey: string,
    serverID: string,
    instant: Temporal.Instant,
  ) {
    const parsed = parseIndexedKey(attachmentKey);
    if (!parsed || parsed.groupID !== null) {
      yield* writeBackSkipped(attachmentKey, "not a personal attachment");
      return;
    }
    const current = yield* Ref.get(state);
    const unwritable = unwritableReason(current, serverID);
    if (unwritable !== null) {
      yield* writeBackSkipped(attachmentKey, unwritable);
      return;
    }
    if ((yield* Ref.get(readOnlyLibraries)).has("users/0")) {
      yield* writeBackSkipped(attachmentKey, "read-only library");
      return;
    }
    if (!(yield* hasKey(serverID))) {
      if ((yield* heldServerID) === serverID) yield* setAuthorized(false);
      yield* writeBackSkipped(attachmentKey, "missing authorization");
      return;
    }
    if ((yield* heldServerID) !== serverID) {
      yield* writeBackSkipped(attachmentKey, "source changed");
      return;
    }
    const path = `/api/users/0/items/${parsed.key}`;
    const reply = yield* send(path, { serverID });
    if ((yield* heldServerID) !== serverID) {
      yield* writeBackSkipped(attachmentKey, "source changed");
      return;
    }
    if ("failure" in reply) {
      yield* Effect.logTrace("Read write-back refused").pipe(
        Effect.annotateLogs({ attachmentKey, reason: reply.failure.kind }),
      );
      if (reply.failure.kind === "server-changed") {
        yield* writeRefused(reply.failure, "users/0", true);
      } else {
        yield* report(reply);
      }
      return;
    }
    const item = v.safeParse(
      v.object({
        key: v.literal(parsed.key),
        version: v.pipe(v.number(), v.integer(), v.minValue(0)),
        library: v.object({ type: v.literal("user") }),
        data: v.object({
          itemType: v.literal("attachment"),
          lastRead: v.optional(v.nullable(v.number())),
        }),
      }),
      parseJson(reply.value.text),
    );
    if (!item.success) {
      yield* writeBackSkipped(attachmentKey, "malformed attachment");
      return;
    }
    const lastRead = Math.floor(instant.epochMilliseconds / 1000);
    if ((item.output.data.lastRead ?? 0) >= lastRead) {
      yield* writeBackSkipped(attachmentKey, "stored read is newer or equal");
      return;
    }
    const written = yield* authorizedSend(path, {
      library: "users/0",
      expectedServerID: serverID,
      silent: true,
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: item.output.version, lastRead }),
    });
    yield* Effect.logTrace("Read write-back outcome").pipe(
      Effect.annotateLogs({
        attachmentKey,
        outcome: "failure" in written ? "refused" : "sent",
        reason: "failure" in written ? written.failure.kind : "accepted",
      }),
    );
  });

  /**
   * One request that spends a Write Authorization — the seam every write goes
   * through, with the method, body and preconditions its caller builds
   * (aidenlx/zotlit#1145).
   *
   * The key is read here and never held: a Remembered Authorization comes fresh
   * from the store at every call, so one the user deleted in Obsidian's Keychain
   * is simply gone.
   *
   * No dialog opens from here. A call with no key in hand is refused as
   * `unauthorized` without reaching Zotero; Allow editing authorizes first.
   *
   * The write runs on its caller's fiber to its answer: an interrupt would leave
   * its outcome unknown.
   *
   * @param options.library the library the write targets, as the route spells
   *   it, so a refusal marks that one read-only for the session.
   */
  const authorizedSend = Effect.fn("ZoteroLocalApi.authorizedSend")(function* (
    path: string,
    options: AuthorizedSendOptions,
  ): Effect.fn.Return<LocalApiResult<ZoteroReply>> {
    const current = yield* Ref.get(state);
    if (current.kind !== "available") {
      return { failure: noSessionFailure(current) };
    }
    const { library, method, body, headers } = options;
    if ((yield* Ref.get(readOnlyLibraries)).has(library)) {
      return { failure: { kind: "library-read-only" } };
    }
    const { serverID } = current.source;
    if (
      options.expectedServerID !== undefined &&
      options.expectedServerID !== serverID
    ) {
      return { failure: { kind: "server-changed" } };
    }
    const key = yield* storedKey(serverID);
    if (
      options.expectedServerID !== undefined &&
      (yield* heldServerID) !== serverID
    ) {
      return { failure: { kind: "server-changed" } };
    }
    if (key === null) {
      yield* setAuthorized(false);
      return { failure: { kind: "unauthorized" } };
    }

    const reply = yield* send(path, {
      serverID,
      method,
      body,
      headers: { ...headers, "Zotero-API-Key": key },
    });
    if (
      "failure" in reply &&
      (options.expectedServerID === undefined ||
        (yield* heldServerID) === serverID)
    ) {
      yield* writeRefused(reply.failure, library, options.silent);
    }
    return reply;
  }, withLogCategory(LOG_CATEGORY));

  return {
    /** The Companion reported that its database updated. */
    freshnessSignal: Effect.asVoid(
      startProbe("freshness signal", { moved: true }),
    ),

    /** The Zotero preference or data-directory override changed. */
    resolvedPathsMoved: Effect.asVoid(
      startProbe("resolved paths changed", { moved: true, stale: true }),
    ),

    /**
     * The source that stands now — and, where no probe has run yet, the demand
     * that arms the first one. Answers `null` meanwhile, so the Annotation Source
     * is decided by what is known at the moment of asking and a switch is
     * announced through `changed` when the probe lands.
     *
     * @returns the source, or null while another source must answer instead.
     */
    demandSource: Effect.gen(function* () {
      const current = yield* Ref.get(state);
      if (current.kind === "unprobed") yield* startProbe("first demand");
      return current.kind === "available" ? current.source : null;
    }).pipe(
      Effect.withSpan("ZoteroLocalApi.demandSource"),
      withLogCategory(LOG_CATEGORY),
    ),

    /**
     * What the last Capability Probe learned, for the repository that computes
     * the Editing Capability from it. Asking does not arm a probe.
     */
    state: Effect.map(Ref.get(state), (current): LocalApiState =>
      current.kind === "unprobed" ? { kind: "probing" } : current,
    ),

    /**
     * Run the Capability Probe now — an edit gesture, or the settings action.
     * Concurrent calls join the probe already running.
     */
    probe: reprobe("asked").pipe(
      Effect.withSpan("ZoteroLocalApi.probe"),
      withLogCategory(LOG_CATEGORY),
    ),

    /**
     * What the write path knows, for the Editing Capability the repository
     * computes.
     *
     * @param attachmentKey the Attachment being asked about, or null to ask about
     *   the session itself — what the settings row shows, where no one library
     *   can be read-only.
     */
    writeStateFor: Effect.fn("ZoteroLocalApi.writeStateFor")(function* (
      attachmentKey: string | null,
    ): Effect.fn.Return<WriteAuthorizationState> {
      const parsed =
        attachmentKey === null ? null : parseIndexedKey(attachmentKey);
      return {
        authorizing: yield* Ref.get(authorizing),
        libraryReadOnly:
          parsed !== null &&
          (yield* Ref.get(readOnlyLibraries)).has(libraryPath(parsed)),
        cooldownUntil: yield* Ref.get(cooldownUntil),
      };
    }),

    /** Whether a Remembered Write Authorization is stored, for the settings row. */
    remembered: Effect.tryPromise(() => credentials.has()).pipe(
      Effect.orDie,
      Effect.withSpan("ZoteroLocalApi.remembered"),
    ),

    /**
     * Ask Zotero for a Write Authorization from Allow editing in the
     * Annotation View or settings. Nothing else may call
     * this — no dialog opens without a user action.
     *
     * A Capability Probe runs first, because the probe is the sole authority on
     * whether the local API is on at all, and a session that already holds an
     * authorization is answered without a dialog. Concurrent gestures join the
     * one request in flight.
     *
     * Only Always Allow enables editing. An Allow answers `not-remembered`, and an
     * Always Allow whose key SecretStorage cannot save answers `not-saved`; both
     * keys are discarded unsent.
     *
     * The request itself is unbounded: Zotero's dialog waits for the user, so
     * only the gesture ends it. A gesture that is interrupted leaves the request;
     * the last one to leave interrupts it.
     *
     * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
     */
    authorize: Effect.scoped(
      RcRef.get(request).pipe(Effect.flatMap(Fiber.join)),
    ).pipe(
      Effect.withSpan("ZoteroLocalApi.authorize"),
      withLogCategory(LOG_CATEGORY),
    ),

    /**
     * Drop the Remembered Write Authorization, from the settings row. The next
     * gesture asks Zotero again; Zotero's own "Clear Write Authorizations" is the
     * other half of the same revocation and needs no help from here.
     */
    forgetAuthorization: Effect.andThen(forgetKey, setAuthorized(false)).pipe(
      Effect.withSpan("ZoteroLocalApi.forgetAuthorization"),
    ),

    authorizedSend,

    /** A live, best-effort read Use. The caller supplies its database identity. */
    writeLastRead: Effect.fn("ZoteroLocalApi.writeLastRead")(function* (
      attachmentKey: string,
      serverID: string,
      instant: Temporal.Instant,
    ) {
      const current = yield* Ref.get(state);
      const unwritable = unwritableReason(current, serverID);
      if (unwritable !== null) {
        yield* writeBackSkipped(attachmentKey, unwritable);
        return;
      }
      // The write-back runs on the Scope of the session, which interrupts it
      // when it closes, and under the deadline of a probe. Its caller waits for
      // it, and leaving does not cancel it.
      const writing = yield* queued(
        `${serverID}/${attachmentKey}`,
        writeLastReadNow(attachmentKey, serverID, instant),
      ).pipe(
        Effect.onInterrupt(() => writeBackSkipped(attachmentKey, "cancelled")),
        Effect.timeoutOrElse({
          duration: PROBE_TIMEOUT,
          orElse: () => Effect.void,
        }),
        Effect.forkIn(scope, { startImmediately: true }),
      );
      yield* Effect.asVoid(Fiber.await(writing));
    }, withLogCategory(LOG_CATEGORY)),

    /**
     * One Annotation as Zotero holds it now, which is what a write reads back
     * after its `204`. That answer's `Last-Modified-Version` is the **library's**
     * version, which a quiet library leaves equal to the object's and a busy one
     * does not, so the object's own version is only ever knowable from here.
     * Reading it back also puts the stored record through the same validation a
     * listed one goes through before anything believes it.
     *
     * A failed re-read leaves the session standing. The write has already
     * landed, so this says nothing about whether Zotero answers — its caller
     * drops the Attachment's list instead, and the next read reconciles.
     *
     * @param annotationKey the Annotation's Indexed Key.
     * @param attachmentKey the Attachment it must still hang from.
     */
    readAnnotation: Effect.fn("ZoteroLocalApi.readAnnotation")(function* (
      annotationKey: string,
      attachmentKey: string,
    ): Effect.fn.Return<LocalApiResult<LocalApiAnnotation>> {
      const current = yield* Ref.get(state);
      if (current.kind !== "available") {
        return { failure: noSessionFailure(current) };
      }
      const parsed = parseIndexedKey(annotationKey);
      if (!parsed) {
        return { failure: invalid(`annotation key ${annotationKey}`) };
      }
      const reply = yield* send(
        `/api/${libraryPath(parsed)}/items/${parsed.key}`,
        { serverID: current.source.serverID },
      );
      if ("failure" in reply) return reply;
      return readAnnotationItem(reply.value.text, attachmentKey);
    }, withLogCategory(LOG_CATEGORY)),

    /**
     * Every Annotation of one Attachment, in the order its Sort Indexes give.
     *
     * The list route is read a page at a time and followed to its end, so an
     * Attachment with more than {@link PAGE_SIZE} Annotations is whole. A key
     * Zotero does not hold answers an empty list, not a failure — the same answer
     * the Zotero DB source gives for it.
     *
     * Interrupting the walk discards an answer already committed.
     *
     * @param attachmentKey the Attachment's Indexed Key.
     */
    listAnnotations: Effect.fn("ZoteroLocalApi.listAnnotations")(function* (
      attachmentKey: string,
    ): Effect.fn.Return<LocalApiResult<readonly LocalApiAnnotation[]>> {
      const current = yield* Ref.get(state);
      if (current.kind !== "available") {
        return { failure: noSessionFailure(current) };
      }
      const parsed = parseIndexedKey(attachmentKey);
      if (!parsed) {
        return { failure: invalid(`attachment key ${attachmentKey}`) };
      }
      const library = libraryPath(parsed);

      const annotations: LocalApiAnnotation[] = [];
      const keys = new Set<string>();
      let expectedTotal: number | null | undefined;
      for (;;) {
        const query = new URLSearchParams({
          itemType: "annotation",
          limit: String(PAGE_SIZE),
          start: String(annotations.length),
          // dateAdded never moves, so a page boundary holds still while the walk
          // runs; Zotero's default sort is dateModified, which an edit reorders.
          sort: "dateAdded",
          direction: "asc",
        });
        const reply = yield* send(
          `/api/${library}/items/${parsed.key}/children?${query.toString()}`,
          { serverID: current.source.serverID },
        );
        if ("failure" in reply) return yield* report(reply);

        const page = readAnnotationPage(reply.value.text, attachmentKey);
        if ("failure" in page) return yield* report(page);
        const total = totalResults(reply.value.headers);
        if (total === null) {
          return yield* report({
            failure: invalid("annotation page named no valid total"),
          });
        }
        if (expectedTotal === undefined) expectedTotal = total;
        if (expectedTotal !== total) {
          return yield* report({
            failure: invalid("annotation total changed during pagination"),
          });
        }
        for (const { key } of page.value) {
          if (keys.has(key)) {
            return yield* report({
              failure: invalid("annotation page repeated an annotation"),
            });
          }
          keys.add(key);
        }
        annotations.push(...page.value);

        if (
          page.value.length < PAGE_SIZE ||
          annotations.length >= expectedTotal
        ) {
          if (annotations.length !== expectedTotal) {
            return yield* report({
              failure: invalid("annotation pages did not match their total"),
            });
          }
          yield* Effect.logDebug(
            "Annotations read from the Zotero Local API",
          ).pipe(
            Effect.annotateLogs({
              attachmentKey,
              annotations: annotations.length,
              serverID: current.source.serverID,
            }),
          );
          return { value: annotations.toSorted(byReadingOrder) };
        }
      }
    }, withLogCategory(LOG_CATEGORY)),
  };
});

/**
 * Whether a failed exchange is an abort that came from the transport rather
 * than from this session's interrupt: the request left, and its outcome is
 * unknown.
 */
function isTransportAbort(error: HttpClientError.HttpClientError): boolean {
  const { reason } = error;
  const cause =
    typeof reason === "object" && reason !== null && "cause" in reason
      ? reason.cause
      : undefined;
  return isAbort(reason) || isAbort(cause);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function serverIDOf(state: ProbeState): string | null {
  return state.kind === "available" ? state.source.serverID : null;
}

/**
 * Why a read write-back cannot run against `serverID`, or null where it can.
 */
function unwritableReason(state: ProbeState, serverID: string): string | null {
  if (state.kind !== "available") return "unavailable";
  if (!state.authorized) return "unauthorized";
  if (state.source.serverID !== serverID) return "source changed";
  return null;
}

/**
 * Why a read cannot run at all, in the same union a request answers with. A
 * read asked for before any probe has answered reads as unreachable: nothing
 * has yet reached Zotero to say otherwise.
 */
function noSessionFailure(
  state: Exclude<ProbeState, { kind: "available" }>,
): LocalApiFailure {
  return state.kind === "unavailable" ? state.failure : { kind: "unreachable" };
}

/**
 * Whether two probe answers leave every surface with the same capability: the
 * same server and authorization, or the same kind of failure.
 */
function sameProbeState(a: ProbeState, b: ProbeState): boolean {
  if (a.kind === "available" && b.kind === "available") {
    return (
      a.source.serverID === b.source.serverID && a.authorized === b.authorized
    );
  }
  if (a.kind === "unavailable" && b.kind === "unavailable") {
    return a.failure.kind === b.failure.kind;
  }
  return a.kind === b.kind;
}

/**
 * What a failed Capability Probe leaves the session. Zotero answers the root
 * route `200` whatever it holds, `403` with its Local API switched off, and
 * names its API version, so only those failures say something about Zotero.
 * Every other failure says Zotero is not answering on its port: a probe its
 * own deadline cancelled has learned what a refused connection teaches, and any
 * other answer comes from another server on Zotero's port — ZotLit's own Local
 * Server among them.
 */
function probeFailure(failure: LocalApiFailure): LocalApiFailure {
  switch (failure.kind) {
    case "unreachable":
    case "local-api-disabled":
    case "incompatible-zotero":
      return failure;
    default:
      return { kind: "unreachable" };
  }
}

/**
 * Zotero's reading order, which its zero-padded Sort Index sorts as text. The
 * list route sorts by date alone — its `sort` values are a closed set that the
 * Sort Index is not in — so the order is restored here.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L341-L348
 */
function byReadingOrder(a: LocalApiAnnotation, b: LocalApiAnnotation): number {
  return a.sortIndex < b.sortIndex ? -1 : a.sortIndex > b.sortIndex ? 1 : 0;
}
