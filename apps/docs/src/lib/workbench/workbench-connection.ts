// The Workbench Connection: the launch-fragment code exchange, hydration, the
// dependency and citation-style re-reads, Save with revision reconciliation,
// and disconnect. Reads that belong to one connection run in that
// connection's Scope, so Disconnect stops them; closing the page closes the
// layer and stops everything.

import {
  Context,
  Effect,
  Exit,
  Fiber,
  FiberHandle,
  Layer,
  PubSub,
  Ref,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";

import {
  CONNECT_FRAGMENT_CODE,
  LocalBridgeClient,
} from "@zotlit/workbench/bridge";
import type {
  InstalledCitationStyle,
  LocalBridgeConnection,
  LocalBridgeError,
  LocalBridgeState,
  SaveSelectedProfileRequest,
  SaveSelectedProfileResponse,
  SelectedProfileResponse,
} from "@zotlit/workbench/bridge";
import type { RenderResources } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

import type { SampleItem } from "./fields";
import { readDraft } from "./transfer";
import type { WorkbenchDraft } from "./transfer";

export interface ProfileHydration {
  readonly selected: SelectedProfileResponse;
  /** The vault the document was read from, which keys the draft it belongs to. */
  readonly installationId: string;
  readonly kept: WorkbenchDraft | null;
  readonly snapshot: SampleItem | null;
  /** The revision the retained in-memory draft still descends from. */
  readonly retainedExpected?: SaveSelectedProfileRequest["expected"];
}

export interface SaveTarget {
  readonly reference: string;
  readonly expected: SaveSelectedProfileRequest["expected"];
}

export interface SavedProfile {
  readonly reference: string;
  readonly revision: string;
  readonly source: string;
  /** The vault the Profile was saved to. */
  readonly vault: string;
}

/** What the page shows of the connection. */
export interface ConnectionState
  extends LocalBridgeState, PageConnectionState {}

/** What the page holds of the connection beside the client's own state. */
interface PageConnectionState {
  readonly saveTarget: SaveTarget | null;
  readonly resources: RenderResources | undefined;
  readonly citationStyles: readonly InstalledCitationStyle[] | null;
  /** True while the held bundle answers a draft other than the one on screen. */
  readonly resourcesStale: boolean;
  readonly connectionBusy: boolean;
  readonly itemBusy: boolean;
  readonly saveBusy: boolean;
  readonly message: string | null;
  /**
   * The Profile the last hydration opened, a new object each time. It lands
   * in the same state as the resources read for it, so the page opens the
   * document and takes its bundle in one render.
   */
  readonly hydration: ProfileHydration | null;
}

/** The draft on screen, as the dependency re-read needs it. */
export interface DraftDependencies {
  readonly source: string;
  /** The partial names the draft calls, joined into one comparable key. */
  readonly names: string;
}

export class WorkbenchConnection extends Context.Service<
  WorkbenchConnection,
  {
    readonly current: Effect.Effect<ConnectionState>;
    /** The state now, then each state that replaces it. */
    readonly changes: Stream.Stream<ConnectionState>;
    /**
     * Connects from the launch fragment, or resumes a grant the tab kept.
     * Only the first run does anything, so a replayed mount starts nothing.
     */
    readonly start: Effect.Effect<void>;
    /**
     * Presents the kept grant again after a lost connection. A transport
     * failure kept the grant and the port it was made on, so the bridge
     * running now re-checks compatibility against this page instead of asking
     * for a fresh approval.
     */
    readonly reconnect: Effect.Effect<void>;
    /** Reads the selected Profile again over the connection held now. */
    readonly reload: Effect.Effect<void>;
    /** Ends the connection, even when the vault did not answer. */
    readonly disconnect: Effect.Effect<void>;
    /** The selected Item, or null when the read failed. */
    readonly loadSelectedItem: Effect.Effect<SampleItem | null>;
    /** The saved revision, or null when the vault refused or the save failed. */
    save(source: string): Effect.Effect<SavedProfile | null>;
    /** The revision the text now on screen was read at, which Save answers for. */
    saveAgainst(
      expected: SaveSelectedProfileRequest["expected"],
    ): Effect.Effect<void>;
    /**
     * Reads the bundle again when the draft calls another set of partials. A
     * newer draft interrupts the older read.
     */
    followDependencies(draft: DraftDependencies): Effect.Effect<void>;
    /**
     * Reads the citation style the preview renders under when it changes. A
     * newer style interrupts the older read.
     */
    followCitationStyle(
      styleId: string | null | undefined,
    ): Effect.Effect<void>;
  }
>()("zotlit/docs/workbench/WorkbenchConnection") {}

const DISCONNECTED_RESOURCES = {
  resources: undefined,
  citationStyles: null,
  resourcesStale: false,
} as const;

/** The reads of one connection, which Disconnect interrupts together. */
interface ConnectionReads {
  readonly scope: Scope.Closeable;
  readonly dependencies: FiberHandle.FiberHandle;
  readonly citationStyle: FiberHandle.FiberHandle;
}

/**
 * What the held bundle was read for: the exact draft, the partial names that
 * draft turned out to call, and the style its resources render under. They are
 * how a bundle is known to answer the document on screen rather than the one
 * the vault holds.
 */
interface HeldBundle {
  readonly source: string | null;
  readonly dependencies: string | null;
  readonly styleId: string | null | undefined;
}

const NO_BUNDLE: HeldBundle = {
  source: null,
  dependencies: null,
  styleId: undefined,
};

const openReads = (parent: Scope.Scope) =>
  Effect.gen(function* () {
    const scope = yield* Scope.fork(parent);
    const handles = Effect.all({
      dependencies: FiberHandle.make(),
      citationStyle: FiberHandle.make(),
    });
    return { scope, ...(yield* Scope.provide(handles, scope)) };
  });

export const layerWorkbenchConnection = Layer.effect(
  WorkbenchConnection,
  Effect.gen(function* () {
    const bridge = yield* LocalBridgeClient;
    const layerScope = yield* Scope.Scope;
    const state = yield* SubscriptionRef.make<PageConnectionState>({
      saveTarget: null,
      ...DISCONNECTED_RESOURCES,
      connectionBusy: false,
      itemBusy: false,
      saveBusy: false,
      message: null,
      hydration: null,
    });
    // Ends every `changes` subscription when the page closes.
    yield* Effect.addFinalizer(() => PubSub.shutdown(state.pubsub));
    const reads = yield* Ref.make<ConnectionReads>(
      yield* openReads(layerScope),
    );
    const current = Effect.zipWith(
      bridge.current,
      SubscriptionRef.get(state),
      shown,
    );
    const update = (
      patch: (held: PageConnectionState) => Partial<PageConnectionState>,
    ) => SubscriptionRef.update(state, (held) => ({ ...held, ...patch(held) }));
    /** The connection the client holds now. */
    const clientConnection = Effect.map(
      bridge.current,
      (now) => now.connection,
    );

    const started = yield* Ref.make(false);
    const launchItemLoaded = yield* Ref.make(false);
    const bundle = yield* Ref.make(NO_BUNDLE);
    const forgetBundle = Ref.set(bundle, NO_BUNDLE);

    const connectionFailed = (failure: LocalBridgeError) =>
      Effect.gen(function* () {
        const next = yield* clientConnection;
        if (next.state !== "connected") yield* forgetBundle;
        yield* update(() => ({
          ...(next.state === "connected" ? {} : DISCONNECTED_RESOURCES),
          message: connectionFailureMessage(failure, next),
        }));
      });

    /** Runs `effect` among this connection's reads; Disconnect interrupts it. */
    const inConnection = <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        const { scope } = yield* Ref.get(reads);
        const fiber = yield* Effect.forkIn(effect, scope, {
          startImmediately: true,
        });
        return yield* Fiber.join(fiber).pipe(
          Effect.onInterrupt(() => Fiber.interrupt(fiber)),
        );
      });

    /**
     * The styles the vault has installed, so the citation-style binding is
     * picked from a list rather than typed. A vault that granted no listing,
     * or a bridge that refused it, leaves the binding as a typed CSL ID
     * instead of costing the whole hydration; a lost connection still fails
     * the hydration it belongs to.
     */
    const readCitationStyles = Effect.gen(function* () {
      const grant = yield* clientConnection;
      if (
        grant.state !== "connected" ||
        !grant.capabilities.includes("citation-styles:list")
      ) {
        return null;
      }
      return yield* bridge.listCitationStyles.pipe(
        Effect.catchTag("LocalBridgeStatusError", () => Effect.succeed(null)),
      );
    });

    const hydrate = Effect.gen(function* () {
      const grant = yield* clientConnection;
      if (grant.state !== "connected") return;
      const selected = yield* bridge.readSelectedProfile;
      // The style this vault has in effect, which a Profile that binds none
      // inherits and the Name and folder pane shows as its value. The page
      // follows the Profile's own binding with `followCitationStyle`, so
      // hydration parses nothing of its own.
      const styleId = grant.profileDefaults.citationStyle;
      const [dependencies, citationStyle, styles] = yield* Effect.all(
        [
          bridge.readTemplateDependencies({ source: selected.source }),
          bridge.readSelectedCitationStyle({ styleId }),
          readCitationStyles,
        ],
        { concurrency: "unbounded" },
      );
      const reference = selected.document.reference;
      const installationId = grant.installation.id;
      const currentExpected = expectedRevision(selected.document);
      const kept = readDraft({ reference, installationId });
      const { saveTarget } = yield* SubscriptionRef.get(state);
      const retainedExpected =
        saveTarget?.reference === reference
          ? saveTarget.expected
          : kept?.expected;

      // The first hydration loads the launch paper before exposing Restore, so
      // a late response cannot replace the snapshot the reader just restored.
      let snapshot: SampleItem | null = null;
      let itemFailure: LocalBridgeError | undefined;
      if (!(yield* Ref.get(launchItemLoaded)) && grant.selectedItem) {
        const loaded = yield* Effect.result(bridge.loadSelectedItem);
        if (loaded._tag === "Success") {
          snapshot = loaded.success;
          yield* Ref.set(launchItemLoaded, true);
        } else itemFailure = loaded.failure;
      }
      // The bundle answers these exact bytes; `followDependencies` reads it
      // again as soon as the draft on screen calls another set of partials.
      yield* Ref.set(bundle, {
        source: selected.source,
        dependencies: null,
        styleId,
      });
      yield* update(() => ({
        resources: { dependencies, citationStyle },
        citationStyles: styles,
        resourcesStale: false,
        saveTarget: { reference, expected: currentExpected },
        hydration: {
          selected,
          installationId,
          kept,
          retainedExpected,
          snapshot,
        },
      }));
      if (itemFailure) return yield* itemFailure;
      if (
        kept?.expected &&
        !sameExpectedRevision(kept.expected, currentExpected)
      ) {
        yield* update(() => ({ message: m.workbench_save_conflict() }));
      }
    });

    const connect = (
      open: Effect.Effect<LocalBridgeConnection, LocalBridgeError>,
    ) =>
      Effect.gen(function* () {
        yield* update(() => ({ connectionBusy: true, message: null }));
        const next = yield* open;
        if (next.state === "connected") yield* hydrate;
      }).pipe(
        Effect.catch(connectionFailed),
        Effect.ensuring(update(() => ({ connectionBusy: false }))),
        inConnection,
      );

    const resume = bridge.resume.pipe(
      Effect.filterOrElse(
        (next): next is LocalBridgeConnection => next !== null,
        () => clientConnection,
      ),
    );

    const start = Effect.gen(function* () {
      if (yield* Ref.getAndSet(started, true)) return;
      const fragment = window.location.hash;
      if (new URLSearchParams(fragment.slice(1)).has(CONNECT_FRAGMENT_CODE)) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
        return yield* connect(bridge.connectFromFragment(fragment));
      }
      // The restored grant records the versions and capabilities in force when
      // it was issued, so a reload presents the kept credential to the bridge
      // running now and is measured against what it answers.
      const kept = yield* clientConnection;
      if (kept.state === "connected") yield* connect(resume);
    }).pipe(Effect.withSpan("WorkbenchConnection.start"));

    const disconnect = Effect.gen(function* () {
      // The reads this connection started end with it; a read started from
      // here on runs among the next connection's.
      const ended = yield* Ref.getAndSet(reads, yield* openReads(layerScope));
      yield* Scope.close(ended.scope, Exit.void);
      yield* update(() => ({ connectionBusy: true }));
      // The client drops the grant whatever the vault answered, so the page
      // has ended the connection either way; the vault ends a session it
      // never heard about when the reader revokes it in Obsidian.
      yield* Effect.ignore(bridge.disconnect);
      yield* forgetBundle;
      yield* update(() => ({ ...DISCONNECTED_RESOURCES, message: null }));
    }).pipe(
      Effect.ensuring(update(() => ({ connectionBusy: false }))),
      Effect.withSpan("WorkbenchConnection.disconnect"),
    );

    const loadSelectedItem = Effect.gen(function* () {
      yield* update(() => ({ itemBusy: true, message: null }));
      return yield* bridge.loadSelectedItem;
    }).pipe(
      Effect.catch((failure) =>
        connectionFailed(failure).pipe(Effect.as(null)),
      ),
      Effect.ensuring(update(() => ({ itemBusy: false }))),
      inConnection,
      Effect.withSpan("WorkbenchConnection.loadSelectedItem"),
    );

    const save = Effect.fn("WorkbenchConnection.save")(
      function* (source: string) {
        const grant = yield* clientConnection;
        const { saveTarget } = yield* SubscriptionRef.get(state);
        if (!saveTarget || grant.state !== "connected") return null;
        yield* update(() => ({ saveBusy: true, message: null }));
        const saved = yield* bridge.saveSelectedProfile({
          ...saveTarget,
          source,
        });
        if (saved.state === "refused") {
          yield* update(() => ({ message: saveRefusalMessage(saved.reason) }));
          return null;
        }
        yield* update(() => ({
          saveTarget: {
            reference: saveTarget.reference,
            expected: { state: "revision", revision: saved.revision },
          },
        }));
        return {
          reference: saveTarget.reference,
          revision: saved.revision,
          source,
          vault: grant.installation.vault,
        };
      },
      (effect) =>
        effect.pipe(
          Effect.catch((failure) =>
            connectionFailed(failure).pipe(Effect.as(null)),
          ),
          Effect.ensuring(update(() => ({ saveBusy: false }))),
        ),
    );

    const saveAgainst = Effect.fn("WorkbenchConnection.saveAgainst")(
      (expected: SaveSelectedProfileRequest["expected"]) =>
        update(({ saveTarget }) => ({
          saveTarget: saveTarget ? { ...saveTarget, expected } : saveTarget,
        })),
    );

    const followDependencies = Effect.fn(
      "WorkbenchConnection.followDependencies",
    )(function* ({ source, names }: DraftDependencies) {
      const { dependencies: handle } = yield* Ref.get(reads);
      const { connection, resources } = yield* current;
      if (connection.state !== "connected" || !resources)
        return yield* FiberHandle.clear(handle);
      const held = yield* Ref.get(bundle);
      if (source === held.source) {
        yield* FiberHandle.clear(handle);
        // The held bundle was read for these very bytes, so what they call is
        // what it answers, and an edit leaving that list alone needs no read.
        yield* Ref.set(bundle, { ...held, dependencies: names });
        yield* update(() => ({ resourcesStale: false }));
        return;
      }
      if (held.dependencies === names) {
        yield* FiberHandle.clear(handle);
        yield* update(() => ({ resourcesStale: false }));
        return;
      }
      // Until the bundle for this draft lands, the held one answers another
      // set of partials, so nothing is rendered against it. The run below
      // interrupts the older read at once.
      yield* update(() => ({ resourcesStale: true }));
      yield* FiberHandle.run(
        handle,
        bridge.readTemplateDependencies({ source }).pipe(
          Effect.tap(() =>
            Ref.update(bundle, (read) => ({
              ...read,
              source,
              dependencies: names,
            })),
          ),
          Effect.flatMap((dependencies) =>
            update((shown) => ({
              resources: shown.resources && {
                ...shown.resources,
                dependencies,
              },
              resourcesStale: false,
            })),
          ),
          Effect.catch(connectionFailed),
        ),
      );
    });

    const followCitationStyle = Effect.fn(
      "WorkbenchConnection.followCitationStyle",
    )(function* (styleId: string | null | undefined) {
      const { citationStyle: handle } = yield* Ref.get(reads);
      const { connection, resources } = yield* current;
      if (
        connection.state !== "connected" ||
        !resources ||
        styleId === undefined ||
        (yield* Ref.get(bundle)).styleId === styleId
      ) {
        return yield* FiberHandle.clear(handle);
      }
      yield* FiberHandle.run(
        handle,
        bridge.readSelectedCitationStyle({ styleId }).pipe(
          Effect.tap(() =>
            Ref.update(bundle, (read) => ({ ...read, styleId })),
          ),
          Effect.flatMap((citationStyle) =>
            update((shown) => ({
              resources: shown.resources && {
                ...shown.resources,
                citationStyle,
              },
            })),
          ),
          Effect.catch(connectionFailed),
        ),
      );
    });

    return WorkbenchConnection.of({
      current,
      changes: Stream.zipLatestWith(
        bridge.changes,
        SubscriptionRef.changes(state),
        shown,
      ),
      start,
      reconnect: connect(resume).pipe(
        Effect.withSpan("WorkbenchConnection.reconnect"),
      ),
      reload: connect(clientConnection).pipe(
        Effect.withSpan("WorkbenchConnection.reload"),
      ),
      disconnect,
      loadSelectedItem,
      save,
      saveAgainst,
      followDependencies,
      followCitationStyle,
    });
  }),
);

function connectionFailureMessage(
  failure: LocalBridgeError,
  connection: LocalBridgeConnection,
): string {
  if (
    failure._tag === "LocalBridgeStatusError" &&
    failure.code === "invalid-one-time-code" &&
    connection.state === "disconnected"
  ) {
    return m.docs_workbench_connection_link_expired();
  }
  if (
    failure._tag === "LocalBridgeUnavailableError" &&
    connection.state === "unavailable"
  ) {
    if (connection.reason === "version-mismatch") {
      return m.workbench_connection_version_mismatch();
    }
    if (connection.reason === "revoked") {
      return m.workbench_connection_revoked();
    }
  }
  if (
    connection.state === "unavailable" &&
    connection.reason === "connection-lost"
  ) {
    return m.workbench_connection_disconnected_notice();
  }
  return m.workbench_connection_failed({ message: failure.message });
}

/** What the page shows: the client's connection beside the page's own state. */
function shown(
  client: LocalBridgeState,
  page: PageConnectionState,
): ConnectionState {
  return { ...client, ...page };
}

function expectedRevision(
  document: SelectedProfileResponse["document"],
): SaveSelectedProfileRequest["expected"] {
  return document.state === "present"
    ? { state: "revision", revision: document.revision }
    : { state: "absent" };
}

function sameExpectedRevision(
  left: SaveSelectedProfileRequest["expected"],
  right: SaveSelectedProfileRequest["expected"],
): boolean {
  return (
    left.state === right.state &&
    (left.state === "absent" ||
      (right.state === "revision" && left.revision === right.revision))
  );
}

function saveRefusalMessage(
  reason: Exclude<SaveSelectedProfileResponse, { state: "saved" }>["reason"],
): string {
  switch (reason) {
    case "revision-conflict":
      return m.workbench_save_conflict();
    case "document-exists":
      return m.workbench_save_document_exists();
    case "invalid-source":
      return m.workbench_save_invalid();
    case "unsupported-profile":
      return m.workbench_save_unsupported();
  }
}
