// Once-per-launch release check: onboarding branch, update notice, Release Note.

import { TFile } from "obsidian";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { Service } from "@/services/service-base";
import type { Settings } from "@/services/settings/schema";
import type {
  SettingsPatch,
  SettingsService,
} from "@/services/settings/service";

import { releaseNoteUrl, V1_TEMPLATE_FOLDER } from "./constants";
import { decideRelease } from "./decide";
import type { ReleaseDecision } from "./decide";

const logger = getLogger("release");

const WEBVIEWER_PLUGIN_ID = "webviewer";
const WEBVIEWER_VIEW_TYPE = "webviewer";

/** v1's ejected template filenames, e.g. `zt-note.eta.md`; matches the `zt-*.eta.md` glob. */
const V1_EJECTED_TEMPLATE = /^zt-.+\.eta\.md$/i;

export interface ReleaseServiceOptions {
  app: App;
  /** The plugin's current version, from the manifest. */
  version: string;
  settings: SettingsService;
  openWelcomeView?: (mode: "fresh" | "upgraded") => void | Promise<void>;
}

export class ReleaseService extends Service<void> {
  readonly #app: App;
  readonly #version: string;
  readonly #settings: SettingsService;
  readonly #openWelcomeView?: (
    mode: "fresh" | "upgraded",
  ) => void | Promise<void>;
  #stopped = false;

  ready: Promise<void>;

  constructor(options: ReleaseServiceOptions) {
    super();
    this.#app = options.app;
    this.#version = options.version;
    this.#settings = options.settings;
    this.#openWelcomeView = options.openWelcomeView;
    this.ready = this.#load();
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    // `onLayoutReady` is a one-shot with no unregister, so gate the deferred
    // check on disposal to avoid touching settings after the plugin unloads.
    stack.defer(() => {
      this.#stopped = true;
    });
    // The launch check needs settings loaded and the workspace ready to open
    // leaves; `ready` settles now, the check runs after layout is ready.
    this.#app.workspace.onLayoutReady(() => {
      void this.#runCheck();
    });
    this.commit(stack.move());
  }

  /**
   * Open the Release Note for the current version — reusing or creating a Web
   * Viewer leaf when that core plugin is enabled, else the system browser. The
   * external page only ever opens from a user action, never automatically.
   */
  async openReleaseNote(): Promise<void> {
    const url = releaseNoteUrl(this.#version);
    const { workspace } = this.#app;
    if (!this.#app.internalPlugins.getEnabledPluginById(WEBVIEWER_PLUGIN_ID)) {
      logger.info("Opened Release Note", { url, target: "system-browser" });
      window.open(url);
      return;
    }
    const leaf =
      workspace.getLeavesOfType(WEBVIEWER_VIEW_TYPE)[0] ??
      workspace.getLeaf("tab");
    await leaf.setViewState({
      type: WEBVIEWER_VIEW_TYPE,
      active: true,
      state: { url },
    });
    void workspace.revealLeaf(leaf);
    logger.info("Opened Release Note", { url, target: "web-viewer" });
  }

  /**
   * Clear the Migration Prompt flag by hand. The setting-tab reminder's
   * "Mark as done" control wires this up; the Welcome View banner no longer
   * has a dismiss control. No-op when the flag is already clear.
   */
  acknowledgeMigration(): void {
    if (this.#settings.current?.["release.migration-pending"] !== true) return;
    this.#settings.update({ "release.migration-pending": false });
    logger.info("Migration Prompt acknowledged");
  }

  async #runCheck(): Promise<void> {
    const settings = await this.#settings.loaded;
    if (this.#stopped) return;

    const origin = this.#settings.hydrationOrigin ?? "current";
    const migrationPending = settings["release.migration-pending"];
    // Absent origin probes v1's default folder for templates-only detection;
    // a pending flag instead probes the user's configured folder to decide
    // whether the flag should auto-clear.
    const legacyTemplatesPresent =
      origin === "absent"
        ? this.#hasEjectedTemplates(V1_TEMPLATE_FOLDER)
        : migrationPending
          ? this.#hasEjectedTemplates(settings["template.folder"])
          : false;

    const decision = decideRelease({
      origin,
      recordedVersion: settings["release.previous-version"],
      currentVersion: this.#version,
      migrationPending,
      noticesEnabled: settings["release.notices-enabled"],
      legacyTemplatesPresent,
    });

    this.#recordState(settings, decision);

    logger.info("Release check complete", {
      branch: decision.branch,
      legacyTemplatesPresent,
    });
    switch (decision.branch) {
      case "update-notice":
        this.#showUpdateNotice();
        break;
      case "welcome-fresh":
        void this.#openWelcomeView?.("fresh");
        break;
      case "welcome-upgraded":
        void this.#openWelcomeView?.("upgraded");
        break;
      case "none":
        break;
    }
  }

  /** Write only the settings keys the decision changes whose value differs. */
  #recordState(current: Readonly<Settings>, decision: ReleaseDecision): void {
    const patch: SettingsPatch = {};
    if (current["release.previous-version"] !== decision.recordVersion) {
      patch["release.previous-version"] = decision.recordVersion;
    }
    if (
      decision.setMigrationPending !== undefined &&
      current["release.migration-pending"] !== decision.setMigrationPending
    ) {
      patch["release.migration-pending"] = decision.setMigrationPending;
    }
    if (
      decision.setTemplateFolder !== undefined &&
      current["template.folder"] !== decision.setTemplateFolder
    ) {
      patch["template.folder"] = decision.setTemplateFolder;
    }
    if (Object.keys(patch).length > 0) this.#settings.update(patch);
  }

  /** True when `folderPath` holds at least one ejected `zt-*.eta.md` template. */
  #hasEjectedTemplates(folderPath: string): boolean {
    const folder = this.#app.vault.getFolderByPath(folderPath);
    if (!folder) return false;
    return folder.children.some(
      (child) => child instanceof TFile && V1_EJECTED_TEMPLATE.test(child.name),
    );
  }

  #showUpdateNotice(): void {
    new BaseNotice(
      BaseNotice.render((renderer) => {
        renderer.setTitle(
          m.notice_update_available({ version: this.#version }),
        );
        renderer.addAction((button) => {
          button
            .setButtonText(m.notice_update_see_whats_new())
            .onClick(() => void this.openReleaseNote());
        });
      }),
      0,
    );
  }
}
