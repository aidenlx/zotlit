import { getLanguage, Plugin, requestUrl } from "obsidian";
import semverGte from "semver/functions/gte";

import { DOCS_SITE_URL } from "@/lib/constants";
import { DisposableAbortController } from "@/lib/disposables";
import * as m from "@/lib/i18n/generated/messages";

import { initI18n } from "./lib/i18n";
import type { LanguagePackLifecycle } from "./lib/i18n";
import {
  installLanguagePack,
  toastLanguagePackDownload,
} from "./lib/i18n/install-toast";
import { enableStartupLogging } from "./lib/log";
import { BaseNotice } from "./lib/notice";
import { openSettingsTab, revealSetting } from "./lib/open-settings";
import { registerAttachmentSkipNotice } from "./services/attachment-import/notices";
import { buildServices } from "./services/build";
import { registerCitationsCli } from "./services/citation-index/cli/register";
import { addCitekeyEditorActions } from "./services/citekey-editor/actions";
import { registerCitekeyCandidatePicker } from "./services/citekey-editor/candidates";
import { registerCitekeyEditorNotices } from "./services/citekey-editor/notices";
import { addDatabaseActions } from "./services/database/actions";
import { reapReadClones } from "./services/database/reap-temps";
import { addIndexedKeyActions } from "./services/indexed-key/actions";
import { registerIndexedKeyFileMenu } from "./services/indexed-key/menu";
import { registerLibraryScopeCli } from "./services/library-scope/cli";
import { registerLibraryScopeNotices } from "./services/library-scope/notices";
import { addNoteFeatureActions } from "./services/note-feature/actions";
import { runBatchUpdateAll } from "./services/note-feature/update-batch";
import { registerCitationStyleNotice } from "./services/pandoc/notices";
import { reapCslStore } from "./services/pandoc/reap-temps";
import { registerPandocResolve } from "./services/pandoc/register";
import { addProfileActions } from "./services/profile/actions";
import { registerProtocolHandlers } from "./services/protocol/register";
import { addReleaseActions } from "./services/release/actions";
import { registerTemplateWorkbench } from "./services/template-workbench/register";
import { ZotLitSettingTab } from "./setting-tab";
import { registerAnnotView } from "./views/annot-view/register";
import { registerCitationPresentation } from "./views/citation-presentation/register";
import { registerCitationSuggest } from "./views/citation-suggest/register";
import { registerCitedByView } from "./views/cited-by/register";
import { registerPandocExport } from "./views/pandoc-export/register";
import { registerQuickSwitch } from "./views/quick-switch/register";
import { registerReferencesView } from "./views/references/register";
import { registerTemplateDataExplorer } from "./views/template-data-explorer/register";
import { registerWelcomeView } from "./views/welcome/register";
import "./zt-main.css";

function showInstallerUpdateNotice(): BaseNotice {
  return new BaseNotice(
    BaseNotice.render((renderer) => {
      renderer.setTitle(m.notice_installer_update_needed());
      renderer.addText(m.notice_installer_update_explanation());
      renderer.addSteps([
        m.notice_installer_update_step_download(),
        m.notice_installer_update_step_close(),
        m.notice_installer_update_step_run(),
      ]);
      renderer.addText(m.notice_installer_update_no_uninstall());
      renderer.addAction((button) => {
        button
          .setButtonText(m.notice_installer_update_learn_more())
          .onClick(() => {
            window.open(
              `${DOCS_SITE_URL}/docs/how-to/update-obsidian-installer`,
            );
          });
      });
      renderer.addAction((button) => {
        button
          .setButtonText(m.notice_installer_update_download())
          .setCta()
          .onClick(() => {
            window.open("https://obsidian.md/download");
          });
      });
    }),
    0,
  );
}

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

  showInstallerUpdateNotice();
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

  /**
   * The service container, for `obsidian eval` callers outside the bundle —
   * `packages/e2e` and `packages/scripts` reach it through a string, so they
   * keep working while TypeScript sees nothing to navigate.
   *
   * Typed `unknown` on purpose: it stays unset until `onload()` commits, so
   * anything inside the bundle that reads a service through it gets a value
   * that throws at exactly the wrong moment. Take the service as an explicit
   * dependency instead.
   */
  get services(): unknown {
    if (!this.#services) throw new Error("Plugin not loaded");
    return this.#services;
  }

  /** Show the installer notice independently of the version check. */
  showInstallerUpdateNotice(): BaseNotice {
    return showInstallerUpdateNotice();
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

    // Clear the temp residue of crashed runs before any service adds more.
    // Fire-and-forget: a launch never waits on housekeeping, and unloading
    // mid-sweep aborts it. Each producer owns what its own residue is, and
    // each reap reports its own failures rather than raising them.
    const reapAbort = stack.use(new DisposableAbortController());
    void reapReadClones({ signal: reapAbort.signal });
    void reapCslStore({ signal: reapAbort.signal });

    const { services } = buildServices(this, stack);

    this.addSettingTab(
      new ZotLitSettingTab({
        importProfile: services.importProfile,
        profile: services.profile,
        plugin: this,
        settings: services.settings,
        db: services.db,
        libraryScope: services.libraryScope,
        zoteroPref: services.zoteroPref,
        attachmentImport: services.attachmentImport,
        citationIndex: services.citationIndex,
        template: services.template,
        release: services.release,
        pandocEngine: services.pandocEngine,
        languagePack,
      }),
    );

    addProfileActions(this, { importProfile: services.importProfile });
    addDatabaseActions(this, { db: services.db });
    addReleaseActions(this, { release: services.release });
    addIndexedKeyActions(this);
    addCitekeyEditorActions(this, { citekeyEditor: services.citekeyEditor });
    registerIndexedKeyFileMenu(this);
    addNoteFeatureActions(this, {
      createProfile: services.createProfile,
      importProfile: services.importProfile,
      app: this.app,
      noteFeature: services.noteFeature,
      zoteroPref: services.zoteroPref,
      batchImport: services.batchImport,
      updateAll: () =>
        runBatchUpdateAll({
          createProfile: services.createProfile,
          importProfile: services.importProfile,
          zoteroPref: services.zoteroPref,
          profile: services.profile,
          app: this.app,
          db: services.db,
          settings: services.settings,
          libraryScope: services.libraryScope,
          noteFeature: services.noteFeature,
          noteIndex: services.noteIndex,
        }),
    });
    registerCitationSuggest(this, {
      app: this.app,
      lookup: services.itemLookup,
      noteFeature: services.noteFeature,
      settings: services.settings,
      citationIndex: services.citationIndex,
    });
    registerQuickSwitch(this, {
      createProfile: services.createProfile,
      importProfile: services.importProfile,
      app: this.app,
      lookup: services.itemLookup,
      noteIndex: services.noteIndex,
      noteFeature: services.noteFeature,
      settings: services.settings,
      zoteroPref: services.zoteroPref,
    });

    void stack.use(
      registerProtocolHandlers(this, {
        createProfile: services.createProfile,
        importProfile: services.importProfile,
        profile: services.profile,
        app: this.app,
        settings: services.settings,
        db: services.db,
        libraryScope: services.libraryScope,
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

    stack.defer(
      registerCitationStyleNotice(services.bibliographyRender, () => {
        revealSetting(
          this.app,
          this.manifest.id,
          m.settings_citation_references_style_name(),
        );
      }),
    );
    registerReferencesView(this, {
      profile: services.profile,
      app: this.app,
      db: services.db,
      citationIndex: services.citationIndex,
      libraryScope: services.libraryScope,
      citationText: services.citationText,
      citekeyEditor: services.citekeyEditor,
      pandocEngine: services.pandocEngine,
      bibliographyRender: services.bibliographyRender,
    });

    registerCitedByView(this, {
      app: this.app,
      citationIndex: services.citationIndex,
    });

    registerCitationsCli(this, {
      app: this.app,
      citationIndex: services.citationIndex,
      db: services.db,
      zoteroPref: services.zoteroPref,
    });

    // e2e-only: lets packages/e2e read the resolved Library Scope after a
    // Scope Case switch, through the plugin's own CLI Contract surface
    // rather than an internal eval. A dev-build diagnostic port, not a
    // feature for end users — never registered in a production build.
    if (__DEV__) {
      registerLibraryScopeCli(this, { libraryScope: services.libraryScope });
    }

    registerTemplateWorkbench(this, {
      profile: services.profile,
      app: this.app,
      db: services.db,
      noteIndex: services.noteIndex,
      settings: services.settings,
      templates: services.template,
      zoteroPref: services.zoteroPref,
    });

    registerPandocResolve(this, {
      app: this.app,
      db: services.db,
      zoteroPref: services.zoteroPref,
    });

    registerPandocExport(this, {
      profile: services.profile,
      app: this.app,
      db: services.db,
      pandocEngine: services.pandocEngine,
      zoteroPref: services.zoteroPref,
      settings: services.settings,
      openSettings: () => {
        this.app.setting.open();
        this.app.setting.openTabById(this.manifest.id);
      },
    });

    registerCitationPresentation(this, {
      app: this.app,
      zoteroPref: services.zoteroPref,
      settings: services.settings,
    });

    registerWelcomeView(this, {
      app: this.app,
      db: services.db,
      zoteroPref: services.zoteroPref,
      settings: services.settings,
      templateMigration: services.templateMigration,
      release: services.release,
    });

    stack.defer(
      registerAttachmentSkipNotice({
        attachmentImport: services.attachmentImport,
        openSettings: () => {
          openSettingsTab(this.app, this.manifest.id, [
            m.settings_page_attachments(),
            m.settings_attachment_approved_name(),
          ]);
        },
      }),
    );
    stack.defer(registerCitekeyEditorNotices(services.citekeyEditor));
    stack.defer(
      registerCitekeyCandidatePicker(this.app, services.citekeyEditor),
    );
    stack.defer(
      registerLibraryScopeNotices(services.libraryScope, () => {
        revealSetting(
          this.app,
          this.manifest.id,
          m.settings_library_scope_name(),
        );
      }),
    );

    // The companion's Freshness Signal means the database changed and its
    // Checkpoint attempt has settled; feed it into the same coalesced refresh
    // lane as the filesystem watchers.
    stack.defer(
      services.liveUpdate.on("db/updated", () => {
        services.db.notifyExternalChange();
      }),
    );

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
