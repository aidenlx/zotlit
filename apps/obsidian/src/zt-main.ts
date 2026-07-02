import { Plugin } from "obsidian";
import { gte as semverGte } from "semver";

import * as m from "@/paraglide/messages";

import { initI18n } from "./lib/i18n";
import { BaseNotice } from "./lib/notice";
import { buildServices } from "./services/build";
import { addDatabaseActions } from "./services/database/actions";
import { addNoteFeatureActions } from "./services/note-feature/actions";
import { registerProtocolHandlers } from "./services/protocol/register";
import { ZotLitSettingTab } from "./setting-tab";
import { registerAnnotView } from "./views/annot-view/register";
import { registerCitationSuggest } from "./views/citation-suggest/register";
import { registerQuickSwitch } from "./views/quick-switch/register";
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

    // Register the Paraglide locale strategy before any service can call `m.*`.
    initI18n();

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
      }),
    );

    addDatabaseActions(this, { db: services.db });
    addNoteFeatureActions(this, {
      noteFeatures: services.noteFeatures,
      noteImportCtx: services.noteImportCtx,
    });
    registerCitationSuggest(this, {
      app: this.app,
      lookup: services.itemLookup,
      noteFeatures: services.noteFeatures,
      settings: services.settings,
    });
    registerQuickSwitch(this, {
      app: this.app,
      lookup: services.itemLookup,
      noteIndex: services.noteIndex,
      noteFeatures: services.noteFeatures,
      settings: services.settings,
    });

    void stack.use(
      registerProtocolHandlers(this, {
        app: this.app,
        settings: services.settings,
        db: services.db,
        zoteroPref: services.zoteroPref,
        noteFeatures: services.noteFeatures,
        noteIndex: services.noteIndex,
        noteImport: services.noteImport,
        liveUpdate: services.liveUpdate,
      }),
    );

    registerAnnotView(this, {
      app: this.app,
      db: services.db,
      liveUpdate: services.liveUpdate,
      zoteroPref: services.zoteroPref,
      noteFeatures: services.noteFeatures,
      attachmentImport: services.attachmentImport,
      itemLookup: services.itemLookup,
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
