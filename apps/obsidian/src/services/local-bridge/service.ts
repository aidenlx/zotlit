// The Local Bridge service: what the plugin holds of a Workbench Connection —
// the launch a Customize action opens, the grant the bridge describes, and the
// revoke every exit path runs through. The gates themselves live in `app.ts`.
import { getConnInfo } from "@hono/node-server/conninfo";
import {
  Clock,
  Context,
  Effect,
  FiberSet,
  Layer,
  PubSub,
  Ref,
  Stream,
  SubscriptionRef,
} from "effect";
import type { Context as HonoContext } from "hono";

import { CONTRACT_VERSION } from "@zotlit/db";
import {
  BRIDGE_CAPABILITIES,
  BRIDGE_VERSION,
  connectFragment,
} from "@zotlit/workbench/bridge";
import type { ProfileBindingDefaults } from "@zotlit/workbench/bridge";

import { DOCS_SITE_URL } from "@/lib/constants";
import { instantClock } from "@/lib/effect-clock";
import { withLogCategory } from "@/lib/effect-log";
import { forkEach } from "@/lib/effect-stream";
import type { DeviceStorage } from "@/lib/obsidian-device-storage";
import { ObsidianEnv } from "@/lib/obsidian-env";
import { LocalServer } from "@/services/local-server/service";
import { Profile } from "@/services/profile/service";
import { PluginSettings } from "@/services/settings/service";
import type { Settings } from "@/services/settings/service";

import { createLocalBridgeApp } from "./app";
import type { ConnectionGrantDescription } from "./app";
import { loadInstallationId } from "./installation";
import { ALLOWED_DOCS_ORIGINS } from "./origins";
import { profileDisplayName } from "./profile-name";
import { makeLocalBridgeReads } from "./reads";
import type { BridgeReadServices } from "./reads";
import { makeLocalBridgeSave } from "./save";
import { BridgeSessions } from "./sessions";
import type { BridgeConnection, SelectedItemIdentity } from "./sessions";

/** The page the launch URL opens on the docs site. */
const WORKBENCH_PATH = "/workbench";

/** What a Customize action binds a launch to. */
export interface WorkbenchLaunch {
  readonly profileId: string;
  /** The Item to show, or `null` to leave the page on a Sample Item. */
  readonly item: SelectedItemIdentity | null;
}

/**
 * The live Workbench Connection as anything outside the bridge may see it: the
 * website, what it is scoped to, and never the credential.
 */
export interface WorkbenchConnection {
  readonly origin: string;
  readonly profileId: string;
  readonly profileName: string;
  readonly item: SelectedItemIdentity | null;
}

/**
 * The Local Bridge: the Workbench Connection lifecycle behind the Local
 * Server's `/v1/*` routes.
 *
 * A connection starts in Obsidian and nowhere else — {@link launchUrl} mints a
 * Connection code, the page spends it once for a credential, and that
 * credential lives in the layer for as long as the connection does. Closing
 * the layer revokes it.
 */
export class LocalBridge extends Context.Service<
  LocalBridge,
  {
    /** The connection standing now, without its credential; `null` while none does. */
    readonly connection: Effect.Effect<WorkbenchConnection | null>;
    /**
     * The connection now, then each start, end, or takeover by a newer one.
     * Ends when the layer closes.
     */
    readonly changes: Stream.Stream<WorkbenchConnection | null>;
    /** The Profile id of each connected Save that wrote its document in this vault. */
    readonly saved: Stream.Stream<string>;
    /**
     * The URL a Customize action opens: the docs site's Workbench with a fresh
     * Connection code and the port the listener bound. `null` when the web
     * Template Workbench is off or nothing is listening, which is the caller's
     * cue to offer the in-vault path instead.
     */
    launchUrl(launch: WorkbenchLaunch): Effect.Effect<string | null>;
    /** End the connection from Obsidian; the page's next request answers 401. */
    readonly disconnect: Effect.Effect<void>;
  }
>()("zotlit/local-bridge/LocalBridge") {}

/** What the layer reads beside the read services. */
export type LocalBridgeServices =
  | BridgeReadServices
  | PluginSettings
  | LocalServer
  | DeviceStorage
  | ObsidianEnv;

/**
 * The Local Bridge over the plugin's services. `webWorkbenchEnabled` is the
 * build gate, and `pluginVersion` the version the grant carries so the page
 * can name it.
 */
export const layerLocalBridge = (options: {
  readonly webWorkbenchEnabled: boolean;
  readonly pluginVersion: string;
}): Layer.Layer<LocalBridge, never, LocalBridgeServices> =>
  Layer.effect(
    LocalBridge,
    Effect.gen(function* () {
      const settings = yield* PluginSettings;
      const localServer = yield* LocalServer;
      const profiles = yield* Profile;
      const profileName = (profileId: string) =>
        profileDisplayName(profileId).pipe(
          Effect.provideService(Profile, profiles),
        );
      const { vaultName } = yield* ObsidianEnv;
      // Hono handlers and the sessions' callback run outside Effect. A pending
      // grant read ends when the layer closes.
      const runSync = Effect.runSyncWith(yield* Effect.context<never>());
      const runPromise = yield* FiberSet.makeRuntimePromise();

      const held = yield* SubscriptionRef.make<BridgeConnection | null>(null);
      const saved = yield* PubSub.unbounded<string>();
      yield* Effect.addFinalizer(() =>
        Effect.all([PubSub.shutdown(held.pubsub), PubSub.shutdown(saved)]),
      );
      const sessions = new BridgeSessions(
        (connection) => runSync(SubscriptionRef.set(held, connection)),
        instantClock(yield* Clock.Clock),
      );
      const enabled = yield* Ref.make(
        options.webWorkbenchEnabled &&
          (yield* settings.current)["server.workbench"],
      );
      // Obsidian's device store catches its own errors, so a failure here is
      // a defect, and the layer fails with it.
      const installationId = yield* Effect.orDie(loadInstallationId);

      const describe = Effect.fnUntraced(function* (
        connection: BridgeConnection | null,
      ) {
        if (connection === null) return null;
        const described: WorkbenchConnection = {
          origin: connection.origin,
          profileId: connection.profileId,
          profileName: yield* profileName(connection.profileId),
          item: connection.item,
        };
        return described;
      });
      /** The grant as it stands now, which both the exchange and resume answer with. */
      const describeGrant = Effect.fnUntraced(function* (
        connection: BridgeConnection,
      ) {
        const current = yield* settings.current;
        const grant: ConnectionGrantDescription = {
          installation: { id: installationId, vault: vaultName },
          pluginVersion: options.pluginVersion,
          bridgeVersion: BRIDGE_VERSION,
          templateDataContractVersion: CONTRACT_VERSION,
          capabilities: [...BRIDGE_CAPABILITIES],
          selectedItem: connection.item,
          selectedProfile: {
            id: connection.profileId,
            name: yield* profileName(connection.profileId),
          },
          profileDefaults: bindingDefaults(current),
        };
        return grant;
      });

      yield* localServer.mount(
        "/",
        createLocalBridgeApp({
          available: () => options.webWorkbenchEnabled,
          enabled: () => runSync(Ref.get(enabled)),
          peerAddress: nodePeerAddress,
          allowedOrigins: ALLOWED_DOCS_ORIGINS,
          sessions,
          reads: yield* makeLocalBridgeReads({
            installationId,
            vault: vaultName,
          }),
          save: yield* makeLocalBridgeSave({
            pluginVersion: options.pluginVersion,
            onSaved: (profileId) => PubSub.publish(saved, profileId),
          }),
          describeGrant: (connection) => runPromise(describeGrant(connection)),
        }),
      );

      // Finalizers run last-added-first, so the settings watch ends before
      // the revoke: a settings emit arriving after it would otherwise re-open
      // the gate on a closed layer.
      yield* Effect.addFinalizer(() => Effect.sync(() => sessions.revokeAll()));
      yield* forkEach(settings.changes, (value) =>
        Effect.gen(function* () {
          const next = options.webWorkbenchEnabled && value["server.workbench"];
          if (next === (yield* Ref.get(enabled))) return;
          yield* Ref.set(enabled, next);
          // Turning the Workbench off refuses every path, so the connection it
          // left behind would be a row naming a session nothing answers for.
          if (!next) yield* Effect.sync(() => sessions.revokeAll());
        }),
      );

      return LocalBridge.of({
        connection: SubscriptionRef.get(held).pipe(
          Effect.flatMap((connection) => describe(connection)),
          Effect.withSpan("LocalBridge.connection"),
        ),
        changes: SubscriptionRef.changes(held).pipe(
          Stream.mapEffect((connection) => describe(connection)),
        ),
        saved: Stream.fromPubSub(saved),
        launchUrl: Effect.fn("LocalBridge.launchUrl")(function* (launch) {
          const port = yield* localServer.effectivePort;
          if (!(yield* Ref.get(enabled)) || port === null) return null;
          const code = sessions.mintCode({
            origin: DOCS_SITE_URL,
            profileId: launch.profileId,
            item: launch.item,
          });
          yield* Effect.logDebug("Minted a Connection code").pipe(
            Effect.annotateLogs({ port }),
            withLogCategory("local-bridge"),
          );
          return `${DOCS_SITE_URL}${WORKBENCH_PATH}${connectFragment(code, port)}`;
        }),
        disconnect: Effect.gen(function* () {
          const connection = sessions.connection;
          if (connection === null) return;
          yield* Effect.logInfo("Workbench Connection ended from Obsidian");
          sessions.disconnect(connection.credential);
        }).pipe(
          withLogCategory("local-bridge"),
          Effect.withSpan("LocalBridge.disconnect"),
        ),
      });
    }).pipe(withLogCategory("local-bridge")),
  );

/** The vault's own value for each binding a Profile may override. */
function bindingDefaults(settings: Readonly<Settings>): ProfileBindingDefaults {
  const bindings = settings["note.default-profile"].bindings;
  return {
    folder: bindings["note.literature-folder"],
    citationStyle: bindings["citation.references-style"],
    importFolder: bindings["note.import-folder"],
    importColoredHighlights: bindings["note.import-colored-highlights"],
    importAnnotationsAsTemplate:
      bindings["note.import-annotations-as-template"],
  };
}

/**
 * The peer address Node's listener saw. A request that reaches the app without
 * one — an in-process call, say — is not a loopback peer, so the gate refuses it.
 */
function nodePeerAddress(context: HonoContext): string | undefined {
  try {
    return getConnInfo(context).remote.address;
  } catch {
    return undefined;
  }
}
