// The Effect service over the Zotero Local API session.
import { Clock, Context, Effect, Layer, PubSub, Stream } from "@/lib/effect";
import { instantClock } from "@/lib/effect-clock";
import { withLogCategory } from "@/lib/effect-log";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { forkEach } from "@/lib/effect-stream";
import type { ZoteroTransport } from "@/lib/zotero-http";
import { LocalServer } from "@/services/local-server/service";
import { resolvedChanged, ZoteroPref } from "@/services/zotero-pref/service";

import { LocalApiSession } from "./session";
import type {
  LocalApiEvent,
  LocalApiSource,
  LocalApiState,
  WriteAuthorizationState,
} from "./session";
import type {
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
  LocalApiEvent,
  LocalApiSessionDeps,
  LocalApiSource,
  LocalApiState,
  WriteAuthorizationState,
} from "./session";
export { LocalApiSession } from "./session";
export type {
  SecretStore,
  WriteAuthorizationStore,
} from "./write-authorization";

export type AuthorizedSendOptions = Parameters<
  LocalApiSession["authorizedSend"]
>[1];

/** The Zotero Local API client as an Effect service; see {@link LocalApiSession}. */
export class ZoteroLocalApi extends Context.Service<
  ZoteroLocalApi,
  {
    /**
     * The source that stands now — and, where no probe has run yet, the demand
     * that arms the first one. Answers `null` meanwhile, so the Annotation
     * Source is decided by what is known at the moment of asking and a switch
     * is announced through `changes` when the probe lands.
     *
     * @returns the source, or null while another source must answer instead.
     */
    demandSource(): Effect.Effect<LocalApiSource | null>;
    /**
     * What the last Capability Probe learned, for the repository that computes
     * the Editing Capability from it. Asking does not arm a probe.
     */
    readonly state: Effect.Effect<LocalApiState>;
    /**
     * Run the Capability Probe now — an edit gesture, or the settings action.
     * Concurrent calls join the probe already running.
     */
    probe(): Effect.Effect<void>;
    /**
     * What the write path knows, for the Editing Capability the repository
     * computes.
     */
    writeStateFor(
      attachmentKey: string | null,
    ): Effect.Effect<WriteAuthorizationState>;
    /** Whether a Remembered Write Authorization is stored, for the settings row. */
    remembered(): Effect.Effect<boolean>;
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
     * only the gesture ends it. `signal` is that gesture; the request is aborted
     * once every gesture waiting on it has been abandoned.
     *
     * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
     */
    authorize(signal?: AbortSignal): Effect.Effect<LocalApiResult<void>>;
    /**
     * Drop the Remembered Write Authorization, from the settings row. The next
     * gesture asks Zotero again; Zotero's own "Clear Write Authorizations" is the
     * other half of the same revocation and needs no help from here.
     */
    forgetAuthorization(): Effect.Effect<void>;
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
     * @param options.library the library the write targets, as the route spells
     *   it, so a refusal marks that one read-only for the session.
     */
    authorizedSend(
      path: string,
      options: AuthorizedSendOptions,
    ): Effect.Effect<LocalApiResult<ZoteroReply>>;
    /** A live, best-effort read Use. The caller supplies its database identity. */
    writeLastRead(
      attachmentKey: string,
      serverID: string,
      instant: Temporal.Instant,
    ): Effect.Effect<void>;
    /**
     * One Annotation as Zotero holds it now.
     *
     * @param annotationKey the Annotation's Indexed Key.
     * @param attachmentKey the Attachment it must still hang from.
     */
    readAnnotation(
      annotationKey: string,
      attachmentKey: string,
      signal?: AbortSignal,
    ): Effect.Effect<LocalApiResult<LocalApiAnnotation>>;
    /**
     * Every Annotation of one Attachment, in the order its Sort Indexes give.
     *
     * @param attachmentKey the Attachment's Indexed Key.
     * @param signal cancels the walk; an answer already committed is discarded.
     */
    listAnnotations(
      attachmentKey: string,
      signal?: AbortSignal,
    ): Effect.Effect<LocalApiResult<readonly LocalApiAnnotation[]>>;
    /**
     * What this source answers may have moved: a probe that changed the
     * capability, a Zotero database swapped under the port, or the Companion's
     * Freshness Signal. A consumer drops what it holds from this source and
     * reads again; nothing here says which records changed.
     */
    readonly changes: Stream.Stream<void>;
    /**
     * What a surface may do to this source moved: a probe landed, a gesture
     * started or ended, Zotero granted or refused a key, or a library turned out
     * to be read-only. A consumer re-reads the Editing Capability; no record set
     * is affected.
     */
    readonly capabilityChanges: Stream.Stream<void>;
    /**
     * Zotero refused a write, for the surface that rolls the change back and says
     * why. Every refusal is announced; what one means for the change itself is
     * the caller's (aidenlx/zotlit#1145).
     *
     * @param library the library the write targeted, as the route spells it.
     */
    readonly writeRefusals: Stream.Stream<{
      readonly failure: LocalApiFailure;
      readonly library: string;
    }>;
    /**
     * Another Zotero database now answers on the port than the session held,
     * and this probe has adopted it. Raised where the change is detected and
     * settled, so a surface hears it however the change was found: a probe, a
     * read that quarantined the session, or a write whose `412` sent the probe
     * looking.
     *
     * @param serverID the database that answers now.
     * @see apps/obsidian/docs/adr/0033-zotero-object-identity-is-the-indexed-key-server-id-is-source-data.md
     */
    readonly serverChanges: Stream.Stream<string>;
    /**
     * A Capability Probe retired the write refusals this session remembered: a
     * library that stood read-only may be writable again. A surface that stood a
     * control down may stand it up, and a refusal that follows is news rather
     * than the same refusal twice.
     *
     * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
     */
    readonly writeRefusalsRetired: Stream.Stream<void>;
  }
>()("zotlit/zotero-local-api/ZoteroLocalApi") {}

export function layerZoteroLocalApi(options: {
  readonly fetch: ZoteroTransport;
  readonly credentials: WriteAuthorizationStore;
  readonly probeDeadline?: () => AbortSignal;
  readonly now?: () => Temporal.Instant;
}): Layer.Layer<ZoteroLocalApi, never, ZoteroPref | LocalServer> {
  return Layer.effect(
    ZoteroLocalApi,
    Effect.gen(function* () {
      const pref = yield* ZoteroPref;
      const server = yield* LocalServer;
      const now = options.now ?? instantClock(yield* Clock.Clock);
      const run = Effect.runSyncWith(yield* Effect.context<never>());
      const bus = yield* PubSub.unbounded<LocalApiEvent>();
      yield* Effect.addFinalizer(() => PubSub.shutdown(bus));
      const publish = (event: LocalApiEvent): void => {
        void PubSub.publishUnsafe(bus, event);
      };
      const session = yield* acquireAsyncDisposable(() =>
        Promise.resolve(
          new LocalApiSession({
            fetch: options.fetch,
            credentials: options.credentials,
            probeDeadline: options.probeDeadline,
            now,
            httpPort: () => run(pref.current).httpPort,
            publish,
          }),
        ),
      );
      yield* forkEach(server.dbUpdated, () =>
        Effect.sync(() => session.freshnessSignal()),
      );
      yield* forkEach(resolvedChanged(pref), () =>
        Effect.sync(() => session.resolvedPathsMoved()),
      );

      const events = Stream.fromPubSub(bus);
      const byTag = <T extends LocalApiEvent["_tag"]>(tag: T) =>
        events.pipe(
          Stream.filter(
            (event): event is Extract<LocalApiEvent, { _tag: T }> =>
              event._tag === tag,
          ),
        );
      return ZoteroLocalApi.of({
        demandSource: () => Effect.sync(() => session.demandSource()),
        state: Effect.sync(() => session.state),
        probe: () => Effect.promise(() => session.probe()),
        writeStateFor: (attachmentKey) =>
          Effect.sync(() => session.writeStateFor(attachmentKey)),
        remembered: () => Effect.promise(() => session.remembered()),
        authorize: (signal) =>
          Effect.promise((interrupt) =>
            session.authorize(
              signal ? AbortSignal.any([signal, interrupt]) : interrupt,
            ),
          ),
        forgetAuthorization: () =>
          Effect.promise(() => session.forgetAuthorization()),
        authorizedSend: (path, options) =>
          Effect.promise((interrupt) =>
            session.authorizedSend(path, {
              ...options,
              signal: options.signal
                ? AbortSignal.any([options.signal, interrupt])
                : interrupt,
            }),
          ),
        writeLastRead: (attachmentKey, serverID, instant) =>
          Effect.promise(() =>
            session.writeLastRead(attachmentKey, serverID, instant),
          ),
        readAnnotation: (annotationKey, attachmentKey, signal) =>
          Effect.promise((interrupt) =>
            session.readAnnotation(
              annotationKey,
              attachmentKey,
              signal ? AbortSignal.any([signal, interrupt]) : interrupt,
            ),
          ),
        listAnnotations: (attachmentKey, signal) =>
          Effect.promise((interrupt) =>
            session.listAnnotations(
              attachmentKey,
              signal ? AbortSignal.any([signal, interrupt]) : interrupt,
            ),
          ),
        changes: byTag("changed").pipe(Stream.as(undefined)),
        capabilityChanges: byTag("capability-changed").pipe(
          Stream.as(undefined),
        ),
        writeRefusals: byTag("write-refused").pipe(
          Stream.map(({ failure, library }) => ({ failure, library })),
        ),
        serverChanges: byTag("server-changed").pipe(
          Stream.map(({ serverID }) => serverID),
        ),
        writeRefusalsRetired: byTag("write-refusals-retired").pipe(
          Stream.as(undefined),
        ),
      });
    }).pipe(Effect.orDie, withLogCategory("zotero-local-api")),
  );
}
