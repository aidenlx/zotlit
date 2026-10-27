import { Plugin, View } from "obsidian";
import semverGte from "semver/functions/gte";

import type { CliCommand, CliHost } from "@/lib/cli-command";
import { handlerCheckedFlags, printableCliHandler } from "@/lib/cli-rejection";
import {
  ANNOTATION_SUGGESTER_ENABLED,
  DOCS_SITE_URL,
  WEB_WORKBENCH_ENABLED,
} from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import { ViewRegistry } from "@/lib/view-atoms";

import { startI18n } from "./lib/i18n";
import { enableStartupLogging } from "./lib/log";
import { BaseNotice } from "./lib/notice";
import { addAnnotationHistoryActions } from "./services/annotation-repository/actions";
import type { HistorySurface } from "./services/annotation-repository/actions";
import { annotationHistoryFileMenu } from "./services/annotation-repository/menu";
import { addAttachmentOpenActions } from "./services/attachment-open/actions";
import { registerFileLinkCapture } from "./services/attachment-open/capture";
import { attachmentOpenFileMenu } from "./services/attachment-open/menu";
import { buildServices } from "./services/build";
import { addCitekeyEditorActions } from "./services/citekey-editor/actions";
import { registerFileMenu } from "./services/file-menu";
import { addGraphCitationsActions } from "./services/graph-citations/actions";
import { addIndexedKeyActions } from "./services/indexed-key/actions";
import { indexedKeyFileMenu } from "./services/indexed-key/menu";
import {
  addCustomizeActions,
  customizeFileMenu,
} from "./services/local-bridge/actions";
import { registerWorkbenchSavedNotice } from "./services/local-bridge/notices";
import {
  addNoteFeatureActions,
  noteFeatureFileMenu,
} from "./services/note-feature/actions";
import { addProfileActions } from "./services/profile/actions";
import { ServiceStartupFailed } from "./services/startup-failure";
import {
  createProfileDialog,
  importProfileDialog,
} from "./setting-tab/profile-dialogs";
import { createCommentRenderer } from "./views/annot-view/comment-render";
import { registerAnnotView } from "./views/annot-view/register";
import { AnnotationView } from "./views/annot-view/view";
import {
  citationPresentationFileMenu,
  registerCitationPresentation,
} from "./views/citation-presentation/register";
import {
  registerAnnotationSuggest,
  registerCitationSuggest,
} from "./views/citation-suggest/register";
import { registerCitedByView } from "./views/cited-by/register";
import { itemActions } from "./views/library/item-actions";
import { registerLibraryView, showInLibrary } from "./views/library/register";
import { registerNotePreview } from "./views/note-preview/register";
import { registerPandocExport } from "./views/pandoc-export/register";
import { registerQueryBlock } from "./views/query-view/block";
import { QueryCardFocus } from "./views/query-view/card-focus";
import { QueryFileView } from "./views/query-view/file-view";
import {
  queryFileFileMenu,
  queryFileFolderMenu,
  registerQueryFileView,
} from "./views/query-view/register";
import { literatureNotes } from "./views/query-view/table-notes";
import type { QueryViewDeps } from "./views/query-view/view";
import { registerQuickSwitch } from "./views/quick-switch/register";
import { registerReferencesView } from "./views/references/register";
import {
  explorerFileMenu,
  registerTemplateDataExplorer,
} from "./views/template-data-explorer/register";
import {
  templateWorkbenchFileMenu,
  registerTemplateWorkbenchView,
} from "./views/template-workbench/register";
import { registerWelcomeView } from "./views/welcome/register";
import { createSetupActions } from "./views/welcome/setup-actions";
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

/**
 * Stop plugin load on a service whose acquisition died, naming it on screen
 * and in the console. The onload stack releases what started as the error
 * leaves onload.
 *
 * @throws the startup failure, aborting plugin load.
 */
function reportStartupFailure(error: unknown): never {
  if (error instanceof ServiceStartupFailed) {
    new BaseNotice(
      BaseNotice.render((renderer) => {
        renderer.setTitle(m.notice_startup_failed());
        renderer.addText(
          m.notice_startup_failed_detail({ service: error.service }),
        );
      }),
      0,
    );
    console.error(`ZotLit: ${error.message}`, error.cause);
  }
  throw error;
}

/** Thin Obsidian plugin shell; feature work should live in services/actions. */
export default class ZotLitPlugin extends Plugin implements CliHost {
  // Owns every service/resource registered during onload after startup commits.
  #stack?: AsyncDisposableStack;

  // Debug/escape-hatch access only. Services should depend on each other via DI.
  #services?: Awaited<ReturnType<typeof buildServices>>["services"];

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

  /**
   * Every zotlit:* command registers here, so each handler rejects with the
   * text of its error: Obsidian prints any other rejection as [object Object].
   * Its decoder, not Obsidian, reports a missing parameter.
   */
  override registerCliHandler(
    ...[command, description, flags, handler]: Parameters<
      Plugin["registerCliHandler"]
    >
  ): void {
    super.registerCliHandler(
      command,
      description,
      handlerCheckedFlags(flags),
      printableCliHandler(handler),
    );
  }

  /**
   * Register a zotlit:* command whose handler is an Effect, run on the
   * plugin's runtime (`@/lib/cli-command`).
   */
  registerCliCommand(
    name: string,
    { description, flags, handler }: CliCommand,
  ): void {
    this.registerCliHandler(name, description, flags, (params) => {
      if (!this.#services) throw new Error("Plugin not loaded");
      return this.#services.runCli(handler(params));
    });
  }

  /** Show the installer notice independently of the version check. */
  showInstallerUpdateNotice(): BaseNotice {
    return showInstallerUpdateNotice();
  }

  override async onload(): Promise<void> {
    await super.onload();

    if (__DEV__) enableStartupLogging();

    // Install the current session's pack before any copy shows: the installer
    // and startup-failure notices below read `m.*` outside the service graph.
    // The graph's LanguagePack carries on from here and shows the consent
    // notice or the refresh toast once it builds.
    const languagePack = startI18n(this.app, this.manifest.version);

    // Block load on too-old Obsidian installers before allocating any resources.
    assertElectronVersion();

    // Local stack gives automatic rollback if any startup acquisition or wiring
    // fails before the plugin commits ownership with `stack.move()`.
    await using stack = new AsyncDisposableStack();

    const { services } = await buildServices(this, stack, languagePack).catch(
      reportStartupFailure,
    );

    // One Customize flow shared by every entry action.
    const customize = services.customize;

    const customizeDeps = {
      settings: services.settings,
      profile: services.profileService,
      customize,
      bridge: services.bridge,
    };
    addCustomizeActions(this, customizeDeps);
    addProfileActions(this, { importProfile: services.importProfile });
    addIndexedKeyActions(this);
    addCitekeyEditorActions(this, {
      citekeyEditor: services.citekeyEditor,
      bridge: services.bridge,
    });
    addGraphCitationsActions(this, {
      app: this.app,
      graphCitations: services.graphCitations,
      bridge: services.bridge,
    });
    const attachmentOpenDeps = {
      app: this.app,
      attachments: services.literatureNoteAttachments,
      opener: services.targetOpener,
    };
    addAttachmentOpenActions(this, attachmentOpenDeps);
    void stack.use(
      registerFileLinkCapture({
        opener: services.targetOpener,
        attachments: services.attachmentResolver,
        settings: services.settings,
        bridge: services.bridge,
      }),
    );
    const noteFeatureDeps = {
      app: this.app,
      noteActions: services.noteActions,
      batchImport: services.batchImport,
    };
    addNoteFeatureActions(this, noteFeatureDeps);
    stack.defer(
      registerWorkbenchSavedNotice({
        localBridge: services.localBridge,
        updateAll: () => services.noteActions.updateAll(),
      }),
    );
    registerCitationSuggest(this, {
      app: this.app,
      lookup: services.itemLookup,
      noteFeature: services.noteFeature,
      settings: services.settings,
      bridge: services.bridge,
      ...services.citationSuggestServices,
    });
    if (ANNOTATION_SUGGESTER_ENABLED) {
      registerAnnotationSuggest(this, {
        app: this.app,
        query: services.query,
        annotations: services.annotationRepository,
        bridge: services.bridge,
        noteFeature: services.noteFeature,
        zoteroPref: services.zoteroPref,
        settings: services.settings,
        useLedger: services.useLedger,
        notify: (message) => void new BaseNotice(message),
        commentRenderer: (owner, sourcePath) =>
          createCommentRenderer({
            app: this.app,
            component: owner,
            getSourcePath: () => sourcePath,
          }),
      });
    }
    registerQuickSwitch(this, {
      app: this.app,
      attachments: services.literatureNoteAttachments,
      lookup: services.itemLookup,
      registry: services.runtime.runSync(ViewRegistry),
      creation: {
        app: this.app,
        createProfile: (options) => createProfileDialog(this.app, options),
        importProfile: (options) => importProfileDialog(this.app, options),
      },
      settings: services.settings,
      bridge: services.bridge,
      opener: services.targetOpener,
      showInLibrary: (indexedKey) => showInLibrary(this.app, indexedKey),
    });

    const queryCardFocus = new QueryCardFocus(this.app);
    const queryViewDeps: QueryViewDeps = {
      registry: services.runtime.runSync(ViewRegistry),
      runtime: services.runtime,
      app: this.app,
      cardFocus: queryCardFocus,
      reads: services.zoteroReads,
      libraryScope: services.libraryScope,
      query: services.query,
      literatureNotes: literatureNotes({
        registry: services.runtime.runSync(ViewRegistry),
        app: this.app,
        creation: {
          app: this.app,
          createProfile: (options) => createProfileDialog(this.app, options),
          importProfile: (options) => importProfileDialog(this.app, options),
        },
      }),
      opener: services.targetOpener,
    };
    registerAnnotView(this, {
      ...queryViewDeps,
      reads: services.zoteroReads,
      libraryScope: services.libraryScope,
      bridge: services.bridge,
      itemLookup: services.itemLookup,
      settings: services.settings,
      registry: services.runtime.runSync(ViewRegistry),
    });
    registerQueryFileView(this, queryViewDeps);
    registerQueryBlock(this, queryViewDeps);
    registerLibraryView(this, {
      ...queryViewDeps,
      reads: services.zoteroReads,
      libraryScope: services.libraryScope,
      welcome: {
        registry: services.runtime.runSync(ViewRegistry),
        setupActions: createSetupActions({
          app: this.app,
          registry: services.runtime.runSync(ViewRegistry),
          pluginId: this.manifest.id,
        }),
      },
      items: itemActions({
        creation: {
          app: this.app,
          createProfile: (options) => createProfileDialog(this.app, options),
          importProfile: (options) => importProfileDialog(this.app, options),
        },
        registry: services.runtime.runSync(ViewRegistry),
        app: this.app,
        noteFeature: services.noteFeature,
        opener: services.targetOpener,
      }),
    });

    // The Annotation History's own verbs. A bound PDF view and an Annotation
    // View each step the Attachment they show, and a Query View the
    // Attachment of its focused card, so the palette acts on whichever of
    // them the user is in, and the menu on the leaf it was opened over.
    addAnnotationHistoryActions(this, {
      annotations: services.annotationRepository,
      bridge: services.bridge,
      activeSurface: (): HistorySurface | null => {
        const view = this.app.workspace.getActiveViewOfType(View);
        if (view instanceof AnnotationView) return view;
        if (view instanceof QueryFileView) return view.query;
        return (
          (view && queryCardFocus.surfaceIn(view.containerEl)) ??
          services.bridge.runSync(services.pdfAnnotationEditor.bindingFor(view))
        );
      },
    });

    const templateWorkbenchDeps = {
      registry: services.runtime.runSync(ViewRegistry),
      bridge: services.bridge,
      noteFeature: services.noteFeature,
      webWorkbenchEnabled: WEB_WORKBENCH_ENABLED,
      customize,
      itemLookup: services.itemLookup,
      settings: services.settings,
      nativePreview: {
        app: this.app,
        registry: services.runtime.runSync(ViewRegistry),
      },
    };
    registerTemplateWorkbenchView(this, templateWorkbenchDeps);

    registerTemplateDataExplorer(this, {
      bridge: services.bridge,
      app: this.app,
      registry: services.runtime.runSync(ViewRegistry),
      itemLookup: services.itemLookup,
      settings: services.settings,
    });

    registerNotePreview(this, {
      app: this.app,
      registry: services.runtime.runSync(ViewRegistry),
      bridge: services.bridge,
      itemLookup: services.itemLookup,
      settings: services.settings,
    });

    registerReferencesView(this, {
      app: this.app,
      registry: services.runtime.runSync(ViewRegistry),
    });

    registerCitedByView(this, {
      app: this.app,
      registry: services.runtime.runSync(ViewRegistry),
    });

    registerPandocExport(this, {
      fileSystem: services.fileSystem,
      citationParse: services.citationParseService,
      profile: services.profile,
      app: this.app,
      db: services.zoteroReads,
      citationLookup: services.citationLookup,
      pandocEngine: services.pandocEngine,
      zoteroPref: services.zoteroPref,
      zoteroHttp: services.zoteroHttp,
      settings: services.settings,
      bridge: services.bridge,
      openSettings: () => {
        this.app.setting.open();
        this.app.setting.openTabById(this.manifest.id);
      },
    });

    const citationPresentationDeps = {
      workspace: services.workspace,
      metadataCache: services.metadataCache,
      fileSystem: services.fileSystem,
      app: this.app,
      zoteroPref: services.zoteroPrefService,
      notifier: services.notifier,
      settings: services.settings,
      bridge: services.bridge,
    };
    registerCitationPresentation(this, citationPresentationDeps);

    // Every ZotLit entry on Obsidian's file menu. Each entry names its own
    // section; this order is the order of the rows inside each section.
    registerFileMenu(
      this,
      [
        attachmentOpenFileMenu(attachmentOpenDeps),
        templateWorkbenchFileMenu(this.app, templateWorkbenchDeps),
        noteFeatureFileMenu(noteFeatureDeps),
        customizeFileMenu(this.app, customizeDeps),
        citationPresentationFileMenu(citationPresentationDeps),
        annotationHistoryFileMenu({
          annotations: services.annotationRepository,
          bridge: services.bridge,
          surfaceFor: (leaf) =>
            services.bridge.runSync(
              services.pdfAnnotationEditor.bindingFor(leaf.view),
            ),
        }),
        indexedKeyFileMenu(),
        explorerFileMenu(this.app),
        queryFileFileMenu(this.app),
      ],
      [queryFileFolderMenu(this.app)],
    );

    registerWelcomeView(this, {
      registry: services.runtime.runSync(ViewRegistry),
    });

    // The companion's Freshness Signal means the database changed and its
    // Checkpoint attempt has settled; feed it into the same coalesced refresh
    // lane as the filesystem watchers.
    stack.defer(
      services.bridge.subscribe(services.localServer.dbUpdated, () => {
        services.zoteroReads.notifyExternalChange();
      }),
    );

    this.#services = services;
    this.#stack = stack.move();
  }

  override onunload(): void {
    // Start the last settings write now rather than at the end of disposal, so
    // an instance enabled straight after reads it; a view that saves as it
    // closes after this hands its write on the same way.
    if (this.#services)
      this.#services.bridge.runSync(this.#services.settings.release);
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
