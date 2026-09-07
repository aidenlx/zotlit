// The Local Bridge service: what the plugin holds of a Workbench Connection —
// the launch a Customize action opens, the grant the bridge describes, and the
// revoke every exit path runs through. The gates themselves live in `app.ts`.

import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import type { App } from "obsidian";

import { CONTRACT_VERSION } from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";
import {
  BRIDGE_CAPABILITIES,
  BRIDGE_VERSION,
  connectFragment,
} from "@zotlit/workbench/bridge";
import type { ProfileBindingDefaults } from "@zotlit/workbench/bridge";

import { DOCS_SITE_URL } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { DEFAULT_PROFILE, isProfileId } from "@/lib/profile-stamp";
import type { DatabaseService } from "@/services/database/service";
import type { LocalServerService } from "@/services/local-server/service";
import type { NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import type { Settings, SettingsService } from "@/services/settings/service";
import type { TemplateService } from "@/services/template/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { createLocalBridgeApp } from "./app";
import type { ConnectionGrantDescription } from "./app";
import { loadInstallationId } from "./installation";
import { ALLOWED_DOCS_ORIGINS } from "./origins";
import { createLocalBridgeReads } from "./reads";
import { createLocalBridgeSave } from "./save";
import type { BridgeProfileWriter } from "./save";
import { BridgeSessions } from "./sessions";
import type { BridgeConnection, SelectedItemIdentity } from "./sessions";

const logger = getLogger("local-bridge");

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

export interface LocalBridgeEvents {
  /** The live connection started, ended, or was replaced by a newer one. */
  connection: (connection: WorkbenchConnection | null) => void;
  /** A connected Save wrote the Profile's document in this vault. */
  "profile-saved": (profileId: string) => void;
}

export interface LocalBridgeServiceDeps {
  app: App;
  settings: SettingsService;
  profile: BridgeProfileWriter;
  /** The one loopback listener the bridge mounts its routes on. */
  localServer: Pick<LocalServerService, "mount" | "effectivePort">;
  db: Pick<DatabaseService, "acquireRead">;
  noteIndex: Pick<
    NoteIndex,
    "whenIndexed" | "getNotesByItemKey" | "getImportedNoteByNoteKey"
  >;
  template: Pick<TemplateService, "ready" | "exportLiteratureNotePackSource">;
  zoteroPref: Pick<ZoteroPrefService, "ready" | "dataDir">;
  /** This build's version, which the grant carries so the page can name it. */
  pluginVersion: string;
}

/**
 * The Local Bridge: the Workbench Connection lifecycle behind the Local
 * Server's `/v1/*` routes.
 *
 * A connection starts in Obsidian and nowhere else — {@link launchUrl} mints a
 * Connection code, the page spends it once for a credential, and that
 * credential lives in this object for as long as the connection does. Unloading
 * the plugin disposes the service, which revokes it.
 */
export class LocalBridgeService extends Service<void> {
  readonly #app;
  readonly #settings;
  readonly #profile;
  readonly #localServer;
  readonly #pluginVersion;
  readonly #reads;
  readonly #save;
  readonly #emitter = createNanoEvents<LocalBridgeEvents>();
  readonly #sessions = new BridgeSessions((connection) => {
    this.#emitter.emit("connection", this.#describeConnection(connection));
  });

  #enabled = false;
  #installationId = "";

  ready: Promise<void>;

  constructor(deps: LocalBridgeServiceDeps) {
    super();
    this.#app = deps.app;
    this.#settings = deps.settings;
    this.#profile = deps.profile;
    this.#localServer = deps.localServer;
    this.#pluginVersion = deps.pluginVersion;
    this.#reads = createLocalBridgeReads({
      app: deps.app,
      settings: deps.settings,
      db: deps.db,
      noteIndex: deps.noteIndex,
      profile: deps.profile,
      template: deps.template,
      zoteroPref: deps.zoteroPref,
      installationId: () => this.#installationId,
      vaultName: () => this.#app.vault.getName(),
    });
    this.#save = createLocalBridgeSave({
      profile: deps.profile,
      template: deps.template,
      pluginVersion: deps.pluginVersion,
      onSaved: (profileId) => {
        this.#emitter.emit("profile-saved", profileId);
      },
    });
    this.ready = this.#load();
  }

  /** The connection standing now, without its credential; `null` while none does. */
  get connection(): WorkbenchConnection | null {
    return this.#describeConnection(this.#sessions.connection);
  }

  on<K extends keyof LocalBridgeEvents>(
    event: K,
    cb: LocalBridgeEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  /**
   * The URL a Customize action opens: the docs site's Workbench with a fresh
   * Connection code and the port the listener bound. `null` when the web
   * Template Workbench is off or nothing is listening, which is the caller's
   * cue to offer the in-vault path instead.
   */
  launchUrl(launch: WorkbenchLaunch): string | null {
    const port = this.#localServer.effectivePort;
    if (!this.#enabled || port === null) return null;
    const code = this.mintCode(launch);
    logger.debug("Minted a Connection code", { port });
    return `${DOCS_SITE_URL}${WORKBENCH_PATH}${connectFragment(code, port)}`;
  }

  /**
   * A single-use Connection code bound to this build's docs site, the Profile,
   * and the Item. Exposed apart from {@link launchUrl} so a caller that builds
   * its own URL — the end-to-end run, say — spends the same lifecycle.
   */
  mintCode(launch: WorkbenchLaunch): string {
    return this.#sessions.mintCode({
      origin: DOCS_SITE_URL,
      profileId: launch.profileId,
      item: launch.item,
    });
  }

  /** End the connection from Obsidian; the page's next request answers 401. */
  disconnect(): void {
    const connection = this.#sessions.connection;
    if (connection === null) return;
    logger.info("Workbench Connection ended from Obsidian");
    this.#sessions.disconnect(connection.credential);
  }

  async #load(): Promise<void> {
    const settings = await this.#settings.loaded;
    await using stack = new AsyncDisposableStack();

    this.#enabled = settings["server.workbench"];
    this.#installationId = loadInstallationId(this.#app);

    this.#localServer.mount(
      "/",
      createLocalBridgeApp({
        enabled: () => this.#enabled,
        peerAddress: nodePeerAddress,
        allowedOrigins: ALLOWED_DOCS_ORIGINS,
        sessions: this.#sessions,
        reads: this.#reads,
        save: this.#save,
        describeGrant: (connection) => this.#describeGrant(connection),
      }),
    );

    // The stack unwinds last-registered-first, so the subscription goes last:
    // a settings emit arriving after the revoke would otherwise re-open the
    // gate on a disposed service.
    stack.defer(() => {
      this.#sessions.revokeAll();
    });
    stack.defer(
      this.#settings.subscribe((value) => {
        if (value) this.#onSettingsChanged(value);
      }),
    );

    this.commit(stack.move());
  }

  #onSettingsChanged(settings: Readonly<Settings>): void {
    const enabled = settings["server.workbench"];
    if (enabled === this.#enabled) return;
    this.#enabled = enabled;
    // Turning the Workbench off refuses every path, so the connection it left
    // behind would be a row naming a session nothing answers for.
    if (!enabled) this.#sessions.revokeAll();
  }

  /** The grant as it stands now, which both the exchange and resume answer with. */
  async #describeGrant(
    connection: BridgeConnection,
  ): Promise<ConnectionGrantDescription> {
    const settings = await this.#settings.loaded;
    return {
      installation: {
        id: this.#installationId,
        vault: this.#app.vault.getName(),
      },
      pluginVersion: this.#pluginVersion,
      bridgeVersion: BRIDGE_VERSION,
      templateDataContractVersion: CONTRACT_VERSION,
      capabilities: [...BRIDGE_CAPABILITIES],
      selectedItem: connection.item,
      selectedProfile: {
        id: connection.profileId,
        name: this.#profileName(connection.profileId),
      },
      profileDefaults: bindingDefaults(settings),
    };
  }

  #describeConnection(
    connection: BridgeConnection | null,
  ): WorkbenchConnection | null {
    if (connection === null) return null;
    return {
      origin: connection.origin,
      profileId: connection.profileId,
      profileName: this.#profileName(connection.profileId),
      item: connection.item,
    };
  }

  /**
   * The Profile's own label, the built-in name for Default, and the id itself
   * when the vault no longer carries that Profile.
   */
  #profileName(profileId: string): string {
    if (profileId === DEFAULT_PROFILE) return m.settings_profile_default_name();
    if (!this.#profile.loaded || !isProfileId(profileId)) return profileId;
    return this.#profile.resolveProfile(profileId)?.label ?? profileId;
  }
}

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
function nodePeerAddress(context: Context): string | undefined {
  try {
    return getConnInfo(context).remote.address;
  } catch {
    return undefined;
  }
}
