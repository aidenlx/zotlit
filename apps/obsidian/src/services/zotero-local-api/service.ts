// The Effect service over the Zotero Local API session.
import { Context, Effect, Layer, PubSub, Stream } from "@/lib/effect";
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
 * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
 * @see apps/obsidian/docs/adr/0036-local-api-enablement-is-a-guided-manual-step-in-zotero.md
 */
export class ZoteroLocalApi extends Context.Service<
  ZoteroLocalApi,
  {
    /**
     * The source that stands now — and, where no probe has run yet, the demand
     * that arms the first one. Answers `null` meanwhile, so the Annotation
     * Source is decided by what is known at the moment of asking and a switch
     * is announced through `changes` when the probe lands.
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
     * Ask Zotero for a Write Authorization from the user's editing gesture.
     * Concurrent gestures join the one request in flight.
     */
    authorize(signal?: AbortSignal): Effect.Effect<LocalApiResult<void>>;
    /**
     * Drop the Remembered Write Authorization, from the settings row.
     */
    forgetAuthorization(): Effect.Effect<void>;
    /**
     * One request that spends a Write Authorization.
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
     * Freshness Signal.
     */
    readonly changes: Stream.Stream<void>;
    /**
     * What a surface may do to this source moved.
     */
    readonly capabilityChanges: Stream.Stream<void>;
    /**
     * Zotero refused a write, for the surface that rolls the change back and
     * says why.
     */
    readonly writeRefusals: Stream.Stream<{
      readonly failure: LocalApiFailure;
      readonly library: string;
    }>;
    /**
     * Another Zotero database now answers on the port than the session held,
     * and this probe has adopted it.
     */
    readonly serverChanges: Stream.Stream<string>;
    /**
     * A Capability Probe retired the write refusals this session remembered.
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
            now: options.now,
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
      return ZoteroLocalApi.of({
        demandSource: () => Effect.sync(() => session.demandSource()),
        state: Effect.sync(() => session.state),
        probe: () => Effect.promise(() => session.probe()),
        writeStateFor: (attachmentKey) =>
          Effect.sync(() => session.writeStateFor(attachmentKey)),
        remembered: () => Effect.promise(() => session.remembered()),
        authorize: (signal) => Effect.promise(() => session.authorize(signal)),
        forgetAuthorization: () =>
          Effect.promise(() => session.forgetAuthorization()),
        authorizedSend: (path, sendOptions) =>
          Effect.promise(() => session.authorizedSend(path, sendOptions)),
        writeLastRead: (attachmentKey, serverID, instant) =>
          Effect.promise(() =>
            session.writeLastRead(attachmentKey, serverID, instant),
          ),
        readAnnotation: (annotationKey, attachmentKey, signal) =>
          Effect.promise(() =>
            session.readAnnotation(annotationKey, attachmentKey, signal),
          ),
        listAnnotations: (attachmentKey, signal) =>
          Effect.promise(() => session.listAnnotations(attachmentKey, signal)),
        changes: events.pipe(
          Stream.filter(
            (event): event is Extract<LocalApiEvent, { _tag: "changed" }> =>
              event._tag === "changed",
          ),
          Stream.as(undefined),
        ),
        capabilityChanges: events.pipe(
          Stream.filter(
            (
              event,
            ): event is Extract<
              LocalApiEvent,
              { _tag: "capability-changed" }
            > => event._tag === "capability-changed",
          ),
          Stream.as(undefined),
        ),
        writeRefusals: events.pipe(
          Stream.filter(
            (
              event,
            ): event is Extract<LocalApiEvent, { _tag: "write-refused" }> =>
              event._tag === "write-refused",
          ),
          Stream.map(({ failure, library }) => ({ failure, library })),
        ),
        serverChanges: events.pipe(
          Stream.filter(
            (
              event,
            ): event is Extract<LocalApiEvent, { _tag: "server-changed" }> =>
              event._tag === "server-changed",
          ),
          Stream.map(({ serverID }) => serverID),
        ),
        writeRefusalsRetired: events.pipe(
          Stream.filter(
            (
              event,
            ): event is Extract<
              LocalApiEvent,
              { _tag: "write-refusals-retired" }
            > => event._tag === "write-refusals-retired",
          ),
          Stream.as(undefined),
        ),
      });
    }).pipe(Effect.orDie, withLogCategory("zotero-local-api")),
  );
}
