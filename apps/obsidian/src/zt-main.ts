import { getLanguage, Plugin, requestUrl } from "obsidian";
import semverGte from "semver/functions/gte";

import * as m from "@/lib/i18n/generated/messages";

import { initI18n, type LanguagePackLifecycle } from "./lib/i18n";
import {
  installLanguagePack,
  toastLanguagePackDownload,
} from "./lib/i18n/install-toast";
import { enableStartupLogging } from "./lib/log";
import { BaseNotice } from "./lib/notice";
import { buildServices } from "./services/build";
import { addDatabaseActions } from "./services/database/actions";
import { addIndexedKeyActions } from "./services/indexed-key/actions";
import { registerIndexedKeyFileMenu } from "./services/indexed-key/menu";
import { addNoteFeatureActions } from "./services/note-feature/actions";
import { registerProtocolHandlers } from "./services/protocol/register";
import { addReleaseActions } from "./services/release/actions";
import { ZotLitSettingTab } from "./setting-tab";
import { registerAnnotView } from "./views/annot-view/register";
import { registerCitationSuggest } from "./views/citation-suggest/register";
import { registerQuickSwitch } from "./views/quick-switch/register";
import { registerTemplateDataExplorer } from "./views/template-data-explorer/register";
import { registerWelcomeView } from "./views/welcome/register";
import "./zt-main.css";

/**
 * Block startup on Obsidian installers whose bundled Electron predates the
 * `minElectronVersion` declared in package.json (injected at build time as
 * `__MIN_ELECTRON_VERSION__`), pointing the user at the installer-update docs.
 *
 * @throws when the running Electron is too old, aborting plugin load.
 */
function assertElectronVersion(): void {
  const version = process.versions.electron;
  if (!version) return;
  if (semverGte(version, __MIN_ELECTRON_VERSION__)) return;

  new BaseNotice(
    BaseNotice.render((renderer) => {
      renderer.setTitle(m.notice_installer_update_needed());
      renderer.addAction((button) => {
        button
          .setButtonText(m.notice_installer_update_learn_more())
          .onClick(() => {
            window.open("https://obsidian.md/help/updates#Installer+updates");
          });
      });
    }),
    0,
  );
  throw new Error(
    `Obsidian installer is too old (Electron v${version}, required >=v${__MIN_ELECTRON_VERSION__})`,
  );
}

function showLanguagePackLifecycle(lifecycle: LanguagePackLifecycle): void {
  const situation = lifecycle.getSituation();
  switch (situation.kind) {
    case "offered":
      showLanguagePackInstallOffer(lifecycle);
      break;
    case "downloading":
      void toastLanguagePackDownload(situation.done);
      break;
  }
}

function showLanguagePackInstallOffer(lifecycle: LanguagePackLifecycle): void {
  const { endonym } = lifecycle;
  const notice = new BaseNotice(
    BaseNotice.render((renderer) => {
      renderer.setTitle(m.notice_language_pack_install({ language: endonym }));
      renderer.addAction((button) => {
        button
          .setButtonText(m.notice_language_pack_decline_action())
          .onClick(() => {
            lifecycle.decline();
            notice.hide();
          });
      });
      renderer.addAction((button) => {
        button
          .setButtonText(m.notice_language_pack_install_action())
          .setCta()
          .onClick(() => {
            notice.hide();
            installLanguagePack(lifecycle);
          });
      });
    }),
    0,
  );
  // Installing from the settings tab must also hide this notice, not just the
  // settings tab's own row, so the two entry points onto the same download
  // never disagree about whether it's still being offered.
  const unsubscribe = lifecycle.subscribe(() => {
    if (lifecycle.getSituation().kind === "offered") return;
    unsubscribe();
    notice.hide();
  });
}

/** Thin Obsidian plugin shell; feature work should live in services/actions. */
export default class ZotLitPlugin extends Plugin {
  // Owns every service/resource registered during onload after startup commits.
  #stack?: AsyncDisposableStack;

  // Debug/escape-hatch access only. Services should depend on each other via DI.
  #services?: ReturnType<typeof buildServices>["services"];

  get services(): ReturnType<typeof buildServices>["services"] {
    if (!this.#services) throw new Error("Plugin not loaded");
    return this.#services;
  }

  override async onload(): Promise<void> {
    await super.onload();

    if (__DEV__) enableStartupLogging();

    // Install the current session's pack before any service can call `m.*`.
    const languagePack = initI18n({
      pluginVersion: this.manifest.version,
      ports: {
        getLanguage,
        loadLocalStorage: (key) => this.app.loadLocalStorage(key),
        saveLocalStorage: (key, value) => this.app.saveLocalStorage(key, value),
        requestUrl,
      },
    });
    showLanguagePackLifecycle(languagePack);

    // Block load on too-old Obsidian installers before allocating any resources.
    assertElectronVersion();

    // Local stack gives automatic rollback if any synchronous startup wiring
    // fails before the plugin commits ownership with `stack.move()`.
    await using stack = new AsyncDisposableStack();
    const { services } = buildServices(this, stack);

    this.addSettingTab(
      new ZotLitSettingTab({
        plugin: this,
        settings: services.settings,
        db: services.db,
        zoteroPref: services.zoteroPref,
        template: services.template,
        release: services.release,
        languagePack,
      }),
    );

    addDatabaseActions(this, { db: services.db });
    addReleaseActions(this, { release: services.release });
    addIndexedKeyActions(this);
    registerIndexedKeyFileMenu(this);
    addNoteFeatureActions(this, {
      app: this.app,
      noteFeature: services.noteFeature,
      batchImport: services.batchImport,
    });
    registerCitationSuggest(this, {
      app: this.app,
      lookup: services.itemLookup,
      noteFeature: services.noteFeature,
      settings: services.settings,
    });
    registerQuickSwitch(this, {
      app: this.app,
      lookup: services.itemLookup,
      noteIndex: services.noteIndex,
      noteFeature: services.noteFeature,
      settings: services.settings,
    });

    void stack.use(
      registerProtocolHandlers(this, {
        app: this.app,
        settings: services.settings,
        db: services.db,
        zoteroPref: services.zoteroPref,
        noteFeature: services.noteFeature,
        noteIndex: services.noteIndex,
        batchImport: services.batchImport,
        liveUpdate: services.liveUpdate,
      }),
    );

    registerAnnotView(this, {
      app: this.app,
      db: services.db,
      liveUpdate: services.liveUpdate,
      zoteroPref: services.zoteroPref,
      noteFeature: services.noteFeature,
      noteIndex: services.noteIndex,
      attachmentImport: services.attachmentImport,
      itemLookup: services.itemLookup,
      settings: services.settings,
    });

    registerTemplateDataExplorer(this, {
      app: this.app,
      db: services.db,
      noteIndex: services.noteIndex,
      zoteroPref: services.zoteroPref,
      itemLookup: services.itemLookup,
      settings: services.settings,
      templates: services.template,
    });

    registerWelcomeView(this, {
      app: this.app,
      db: services.db,
      zoteroPref: services.zoteroPref,
      settings: services.settings,
    });

    // A Zotero item add/modify/trash push means the database changed; feed it
    // into the same coalesced refresh lane as the filesystem watchers.
    stack.defer(
      services.liveUpdate.on("item/update", () => {
        services.db.notifyExternalChange();
      }),
    );

    console.log("ZotLit loaded");

    this.#services = services;
    this.#stack = stack.move();
  }

  override onunload(): void {
    // Drop the service bag before async disposal so late callers fail clearly.
    this.#services = undefined;

    const stack = this.#stack;
    this.#stack = undefined;

    void stack?.disposeAsync().catch((error: unknown) => {
      console.error("ZotLit cleanup error:", error);
      new BaseNotice("Failed to clean up ZotLit resources");
    });
  }
}
