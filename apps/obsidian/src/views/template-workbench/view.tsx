import { EditorView } from "@codemirror/view";
// One file-backed authoring session; TextFileView owns vault updates and saves.
import { useAtomValue } from "@effect/atom-react";
import { Cause, Effect, Schema, Semaphore, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { apiVersion, Scope, TextFileView } from "obsidian";
import type {
  App,
  Menu,
  TFile,
  HoverParent,
  HoverPopover,
  ViewStateResult,
  WorkspaceLeaf,
} from "obsidian";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import type { TemplateLanguage } from "@zotlit/templates/facade";
import {
  externalEdit,
  WorkbenchDocumentController,
  entryPosition,
} from "@zotlit/workbench/document";
import type {
  WorkbenchDocumentKind,
  WorkbenchProblem,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";
import type { DisplayNode } from "@zotlit/workbench/explorer";
import {
  CITATION_EXAMPLE_IDS,
  DEFAULT_PARTIAL_CONTEXT,
  failedRender,
  isPartialContext,
  renderIdentity,
} from "@zotlit/workbench/render";
import type {
  PartialChoice,
  PartialContext,
  WorkbenchReportContext,
} from "@zotlit/workbench/render";
import {
  chooseAnnotation,
  chooseCitation,
  chooseItem,
  choosePartialProfile,
  citationExampleLabel,
  entryDiagnostics,
  fieldSnippet,
  fieldsActionAttributes,
  fieldsActionKey,
  holdPickerFocus,
  pressFieldsAction,
  panelSizeMenus,
  pickPanelSize,
  repairCommands,
  insertionTarget,
  setAdvanced,
  setPanelWidth,
  setPreview,
  setPreviewHeight,
  setRoot,
  setTab,
  showPanel,
} from "@zotlit/workbench/ui";
import {
  AnnotationPane,
  diagnosticText,
  AnnotationPointer,
  useWorkbenchHost,
  createWorkbenchEditor,
  NameFolderPane,
  NotePane,
  PropertiesPane,
  ProblemsFooter,
  WorkbenchDiagnosticsProvider,
  useWorkbenchProblems,
  workbenchDiagnoses,
  renderDiagnosis,
  SliceEditor,
  usePartialBoxes,
  TabBar,
  TabPanel,
  TABS,
  tabsFor,
  WorkbenchEditorProvider,
  WorkbenchHostProvider,
  WorkbenchThemeProvider,
  SidePanels,
  useParts,
  AnnotationSampleBar,
} from "@zotlit/workbench/ui";
import type {
  WorkbenchHostError,
  WorkbenchEditorInstance,
  WorkbenchHost,
  WorkbenchInsertTarget,
  WorkbenchItemChoice,
  WorkbenchModel,
  WorkbenchViewState,
  TemplateRoot,
  PanelSide,
  PartialPlaceholderHost,
  ViewSize,
} from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import { AppContext } from "@/lib/app-context";
import { awaitConfirm } from "@/lib/confirm";
import { DOCS_SITE_URL } from "@/lib/constants";
import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";
import * as m from "@/lib/i18n/generated/messages";
import * as workbenchM from "@/lib/i18n/generated/workbench-messages";
import { loadedTextFileView } from "@/lib/live-text";
import { MENU_SECTION } from "@/lib/menu-section";
import { Notifier, withOutcome } from "@/lib/notifier";
import type { NoticeMessage } from "@/lib/notifier";
import { Vault } from "@/lib/obsidian-vault";
import { ViewRegistryProvider, viewRuntime, watch } from "@/lib/view-atoms";
import type { ViewRegistryHandle, ViewServices } from "@/lib/view-atoms";
import {
  answerOf,
  inFlightSlot,
  joinOnView,
  latestSlot,
  makeViewRunner,
} from "@/lib/view-runner";
import type { InFlightSlot, LatestSlot, ViewRunner } from "@/lib/view-runner";
import type { ArrivingProblem } from "@/lib/workbench-recovery";
import type { ItemLookupHandle } from "@/services/item-lookup/handle";
import type { ItemSearchDeps } from "@/services/item-lookup/search-modal";
import { plainNoteError } from "@/services/note-feature/errors";
import type { UpdateResult } from "@/services/note-feature/operations";
import { NoteFeature } from "@/services/note-feature/service";
import { updateNoteToast } from "@/services/note-feature/update-single";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import { bibliographyRevisionAtom } from "@/services/pandoc/atoms";
import { defaultProfilePathAtom, profilesAtom } from "@/services/profile/atoms";
import { Profile } from "@/services/profile/service";
import { templateFolderAtom } from "@/services/settings/atoms";
import { reportCitationTemplateOpen } from "@/services/template/actions";
import {
  partialDocumentsAtom,
  partialNamesAtom,
  templateRevisionAtom,
} from "@/services/template/atoms";
import { Template } from "@/services/template/service";
import type { PartialUnpackOutcome } from "@/services/template/service";
import { zoteroStateAtom } from "@/services/zotero-reads/atoms";
import type { ExplorerActions } from "@/views/template-data-explorer/actions";
import { makeExportTemplateDataCommand } from "@/views/template-data-explorer/atoms";
import { exportTarget } from "@/views/template-data-explorer/export-file";
import type { TemplateDataExportTarget } from "@/views/template-data-explorer/export-file";
import { rememberTemplateItem } from "@/views/template-data-explorer/item-memory";
import type {
  NativeRenderDeps,
  NativeRenderResult,
} from "@/views/template-workbench/preview/render";
import {
  nativeResult,
  retainNativeOutputs,
  makeNativeRenderer,
} from "@/views/template-workbench/preview/render";
import { COMMUNITY } from "@/views/welcome/links";

import { templateWorkbenchAction } from "./actions";
import {
  builtInSource,
  installedStyles,
  materializeDefault,
  profileOfFile,
} from "./atoms";
import { templateDocumentKind, templatePartialName } from "./document-kind";
import { partialCall } from "./extract-partial";
import {
  FieldsPanel,
  FieldsPicker,
  makeFieldsActions,
  makeFieldsPanelModel,
} from "./fields-panel";
import type { FieldsPanelModel } from "./fields-panel";
import { fieldsActionHost } from "./fields-popover";
import { createTemplateWorkbenchHost, hostEffect } from "./host";
import { workbenchAnnotationChoice, workbenchItemChoice } from "./item-choice";
import { openWorkbenchLayout, setLeafState } from "./layout";
import { createMatchData } from "./match-data";
import { NativeMatchPane } from "./match-pane";
import {
  holdTemplateWorkbenchModel,
  makePartialPreviews,
  makeTemplateWorkbenchModel,
  readEphemeralWorkbench,
  readSavedWorkbench,
  savedWorkbench,
  setPresentation,
} from "./model";
import type { TemplateWorkbenchModel } from "./model";
import type { CreateSharedPartialOptions } from "./new-partial";
import { openTemplateWorkbench } from "./open";
import { readPartialChoice, writePartialChoice } from "./partial-choice-memory";
import { createSharedPartialEffect } from "./partial-command";
import {
  PreviewPanel,
  WorkbenchMarkdown,
  previewTarget,
} from "./preview-panel";
import { selectionName } from "./selection";
import { getSampleItem } from "./selection-data";
import {
  originatingNoteNotice,
  PANEL_HANDLE_WIDTH,
  templateWorkbenchButton,
  templateWorkbenchTheme,
  selectionBar,
  selectionHint,
} from "./theme";

export const TEMPLATE_WORKBENCH_VIEW_TYPE = "zotlit-template-workbench";

/** A native read that a newer read, an edit, or another file outran. */
class StaleSourceRead extends Schema.TaggedError<
  StaleSourceRead,
  { readonly brand: unique symbol }
>()("StaleSourceRead", {}) {}
export type OriginatingNoteUpdateOutcome =
  | { outcome: "no-target" }
  | { outcome: "unavailable" | "save-failed" | "not-ready"; name: string }
  | { outcome: "updated" | "refused"; name: string; result: UpdateResult };

/** The note operation failed while updating the originating note `note`. */
export class OriginatingNoteUpdateError extends Schema.TaggedError<
  OriginatingNoteUpdateError,
  { readonly brand: unique symbol }
>()("OriginatingNoteUpdateError", {
  /** The originating note's name. */
  note: Schema.String,
  /** What the note operation rejected with. */
  cause: Schema.Defect(),
}) {}

/** The notices that report what unpacking a Profile's bundled partials did. */
export function unpackedPartialNotices(
  result: Pick<
    PartialUnpackOutcome,
    "written" | "kept" | "otherCase" | "refused"
  >,
): string[] {
  const { written, kept, otherCase, refused } = result;
  return [
    ...(written.length > 0
      ? [m.notice_partials_unpacked({ names: written.join(", ") })]
      : []),
    ...(kept.length > 0
      ? [m.notice_partials_kept({ names: kept.join(", ") })]
      : []),
    ...(otherCase.length > 0
      ? [m.notice_partials_other_case({ names: otherCase.join(", ") })]
      : []),
    // The manifest entry stays, so without this the action reads as inert:
    // the bundled-partial problem is still there the next time it is read.
    ...(refused.length > 0
      ? [m.notice_partials_refused({ names: refused.join(", ") })]
      : []),
  ];
}

/** The UI renders operation outcomes, keeping template saves separate from note updates. */
export function originatingNoteUpdateNotice(
  app: App,
  result: OriginatingNoteUpdateOutcome,
): string | DocumentFragment | null {
  const feedback = updateNoteToast("full", { app });
  switch (result.outcome) {
    case "no-target":
      return null;
    case "unavailable":
      return m.template_workbench_update_unavailable({ name: result.name });
    case "save-failed":
      return m.template_workbench_update_save_failed();
    case "not-ready":
      return m.template_workbench_update_not_ready();
    case "refused":
    case "updated": {
      if (result.result.bodyUpdated && !result.result.diagnostic)
        return m.template_workbench_updated_note({ name: result.name });
      const message = feedback.success(result.result);
      return !result.result.diagnostic && typeof message === "string"
        ? m.template_workbench_note_update_result({
            name: result.name,
            result: message,
          })
        : message;
    }
  }
}

export interface TemplateWorkbenchDeps {
  registry: ViewRegistryHandle;
  render?: WorkbenchHost["render"];
  nativePreview?: NativeRenderDeps;
  pluginVersion?: string;
  // The shared Item search modal still reads these capabilities.
  itemLookup: Pick<ItemLookupHandle, "search" | "openSession">;
  settings: ItemSearchDeps["settings"];
  bridge: ItemSearchDeps["bridge"];
}

export class TemplateWorkbenchView extends TextFileView implements HoverParent {
  /** The editor hover popover now open, which the next one replaces. */
  hoverPopover: HoverPopover | null = null;
  readonly #editor: WorkbenchEditorInstance<NativeRenderResult>;
  /**
   * The leaf's size, which places the side panels; null until measured.
   * Public so a test, whose document lays nothing out, can set it.
   */
  readonly viewSize = Atom.make<ViewSize | null>(null);
  /** Measures the leaf in its own window, which a pop-out has apart. */
  #sizeObserver: ResizeObserver | null = null;
  readonly #revealListeners = new Set<
    (target: Pick<WorkbenchProblem, "slice" | "range" | "params">) => void
  >();
  readonly #openProblemsListeners = new Set<() => void>();
  /**
   * The captured failure a refused note operation asked this editor to explain.
   * Its report remains available even when this editor's own check differs.
   */
  #arrival: ArrivingProblem | null = null;
  /** This leaf's host model: its view state, choices, and Item read. */
  readonly model: TemplateWorkbenchModel;
  /** A Shared Partial's previews; a leaf without the native renderer has none. */
  readonly partialPreviews: ReturnType<typeof makePartialPreviews> | null;
  /** The Fields panel's atoms over {@link model}. */
  readonly fields: FieldsPanelModel;
  /** The Fields panel's actions: choosing, sections, copy and export. */
  readonly fieldsActions: ExplorerActions;
  get registry() {
    return this.#deps.registry;
  }
  /** The Workbench model the editor's tabs read, in this leaf's registry. */
  get workbench(): WorkbenchModel<NativeRenderResult> {
    return this.#editor.model;
  }
  /** The view state's transitions, applied to this leaf's model. */
  readonly change = {
    setTab: (tab: WorkbenchViewState["tab"]) => this.#update(setTab(tab)),
    setRoot: (root: TemplateRoot) => this.#update(setRoot(root)),
    setAdvanced: (advanced: boolean) => this.#update(setAdvanced(advanced)),
  };
  get #view(): WorkbenchViewState {
    return this.registry.get(this.model.view);
  }
  #update(transition: (state: WorkbenchViewState) => WorkbenchViewState) {
    this.registry.update(this.model.view, transition);
  }
  /** Runs this leaf's Effects; closing the leaf interrupts them all. */
  readonly #runner: ViewRunner;
  readonly #exportCommand = makeExportTemplateDataCommand();
  #release: (() => void) | null;
  readonly #cleanup = new DisposableStack();
  readonly #deps: TemplateWorkbenchDeps;
  readonly #host: ReturnType<typeof createTemplateWorkbenchHost>;
  #controller = new WorkbenchDocumentController("", { runtime: "native" });
  #root: Root | null = null;
  #updateActions = () => {};
  /** The Fields view action, which the Fields picker opens under. */
  readonly #fieldsAnchor: { current: HTMLElement | null } = { current: null };
  /** The Fields view action and the picker it opens where the column does not fit. */
  readonly #fieldsAction = fieldsActionHost(this.#fieldsAnchor);
  #unsubscribe: (() => void) | null = null;
  #closed = false;
  /** Counts the documents this leaf loaded, so each one mounts a fresh tree. */
  #loads = 0;
  /** The partial this leaf's partial Profile and root were chosen for. */
  #partialChoiceFile: string | null = null;
  get #defaultDraft(): boolean {
    return this.registry.get(this.model.defaultDraft);
  }
  set #defaultDraft(value: boolean) {
    this.registry.set(this.model.defaultDraft, value);
  }
  #bindingDraft = false;
  #receivingSource = false;
  #sourceRevision = 0;
  /** The file read; a newer read or a clear stops the one in flight. */
  readonly #reads: LatestSlot<ViewServices>;
  /** The read that a clearing load started, while it runs. */
  #initialRead: object | null = null;
  #pendingSource: string | null = null;
  #clearing = false;
  /** The launch that sets the originating note; a later one stops an older one. */
  readonly #origins: LatestSlot<ViewServices>;
  /** One save at a time: a native save returns early while another runs. */
  readonly #saveLock = Semaphore.makeUnsafe(1);
  /** The originating-note update; a second press joins the one in flight. */
  readonly #noteUpdates: InFlightSlot<
    OriginatingNoteUpdateOutcome,
    OriginatingNoteUpdateError
  >;
  /** Customize; a second press joins the materialization in flight. */
  readonly #customizing: InFlightSlot<void, never>;
  /** The citation styles read; a request while one runs joins it. */
  readonly #styles: InFlightSlot<void, never>;

  /**
   * Save this file after any save in progress. The write finishes once it
   * starts, so closing the leaf waits for it.
   */
  #saveFile(clear?: boolean): Effect.Effect<void, Cause.UnknownError> {
    const write = () => super.save(clear);
    return this.#saveLock.withPermit(
      Effect.uninterruptible(Effect.tryPromise(() => write())),
    );
  }
  /** Obsidian's save, run on this leaf so its close waits for the write. */
  override save(clear?: boolean): Promise<void> {
    return answerOf(this.#runner.run(this.#saveFile(clear)), undefined);
  }

  get originatingNote(): TFile | null {
    return this.registry.get(this.model.origin)?.file ?? null;
  }
  /** Whether the originating note's update runs. */
  get updatingNote(): boolean {
    return this.registry.get(this.model.updating);
  }
  /**
   * Fork `flow` on this leaf, for a button or a menu entry. The flow reports
   * its own outcome, so it fails with nothing.
   */
  #start(flow: Effect.Effect<unknown, never, ViewServices>): void {
    this.#runner.run(flow);
  }
  /**
   * A launch explicitly sets the target; focus and preview changes leave it
   * intact. A later launch outranks one still reading its Profile.
   *
   * @returns the name of a note this editor cannot update, for the launch to
   *   explain, or `null`.
   */
  setOriginatingNote(file: TFile | null) {
    return this.#origins.join(
      Effect.gen({ self: this }, function* () {
        const indexedKey =
          file &&
          itemKeyFromFrontmatter(this.app.metadataCache.getFileCache(file));
        const resolved = file ? yield* profileOfFile(file) : null;
        this.registry.set(
          this.model.origin,
          file && indexedKey && resolved?.ok
            ? {
                file,
                indexedKey,
                template: this.file,
                profile: resolved.profile.selector,
              }
            : null,
        );
        return file && (!indexedKey || !resolved?.ok) ? file.basename : null;
      }),
      null,
    );
  }
  /**
   * Update the originating note and report the outcome in a notice. A second
   * call while one runs joins it; closing the leaf before the note's write
   * stops it quietly.
   */
  updateOriginatingNote(): Effect.Effect<
    OriginatingNoteUpdateOutcome,
    OriginatingNoteUpdateError
  > {
    return this.#noteUpdates.join;
  }
  /** Run a Workbench action on this leaf; closing the leaf stops it quietly. */
  #act(operation: string, action: Effect.Effect<void, unknown, ViewServices>) {
    this.#start(Effect.ignore(templateWorkbenchAction(operation, action)));
  }
  /** Update the originating note, for the button; the run reports its outcome. */
  startNoteUpdate(): void {
    this.#noteUpdates.start();
  }
  /** Customize the Default Profile, for the button. */
  startCustomize(): void {
    this.#customizing.start();
  }
  /** Open the Item chooser, for a button or a menu entry. */
  startItemChoice(): void {
    this.#start(this.chooseItem());
  }
  /** Open the annotation chooser, for a button or a menu entry. */
  startAnnotationChoice(): void {
    this.#start(this.chooseAnnotation());
  }
  /** Read the citation styles again, as the Name tab asks on each visit. */
  startStylesRefresh(): void {
    this.#styles.start();
  }
  /** Update the originating note and report the outcome in a notice. */
  #noteUpdate(): Effect.Effect<
    OriginatingNoteUpdateOutcome,
    OriginatingNoteUpdateError,
    ViewServices
  > {
    return Effect.gen({ self: this }, function* () {
      return yield* withOutcome(this.#updateOriginatingNote(), {
        success: (result): NoticeMessage | undefined =>
          originatingNoteUpdateNotice(this.app, result) ?? undefined,
        error: (error) =>
          updateNoteToast("full", { app: this.app }).error(
            error instanceof OriginatingNoteUpdateError ? error.cause : error,
          ),
      });
    });
  }
  /** `effect` as a Workbench host member that runs on this leaf's services. */
  toHostEffect<A, E>(
    effect: Effect.Effect<A, E, ViewServices>,
  ): Effect.Effect<A, WorkbenchHostError> {
    return hostEffect(this.#runner.provide(effect));
  }
  /**
   * Save this template, wait for it to compile, and update the originating
   * note with it. What stands in the way is an outcome; the note operation's
   * own failure is an {@link OriginatingNoteUpdateError}.
   */
  #updateOriginatingNote(): Effect.Effect<
    OriginatingNoteUpdateOutcome,
    OriginatingNoteUpdateError,
    ViewServices
  > {
    return Effect.gen({ self: this }, function* () {
      const origin = this.registry.get(this.model.origin);
      if (!origin) return { outcome: "no-target" } as const;
      const name = origin.file.basename;
      // Session state only: the note update checks the note's own Zotero key
      // against the content its one write replaces. Closing the leaf
      // interrupts the update before the write; a write that started finishes.
      const available = () =>
        this.registry.get(this.model.origin) === origin &&
        this.file === origin.template &&
        this.app.vault.getFileByPath(origin.file.path) === origin.file;
      if (!available()) return { outcome: "unavailable", name } as const;
      const vault = yield* Vault;
      /** Whether the file on disk holds what this editor shows; `false` where it cannot be read. */
      const saved = Effect.gen({ self: this }, function* () {
        const file = this.file;
        return (
          file !== null && (yield* vault.read(file)) === this.getViewData()
        );
      }).pipe(
        Effect.catch((error) =>
          Effect.logError("Failed to read the saved template").pipe(
            Effect.annotateLogs({ error }),
            Effect.as(false),
          ),
        ),
      );
      const written = yield* this.#saveFile().pipe(
        Effect.as(true),
        Effect.catch((error) =>
          Effect.logError("Failed to save template before note update").pipe(
            Effect.annotateLogs({ error }),
            Effect.as(false),
          ),
        ),
      );
      if (!written || !(yield* saved))
        return { outcome: "save-failed", name } as const;
      // Settlement covers this revision. Later edits get their own update attempt.
      const revision = this.#sourceRevision;
      const settled = yield* (yield* Template).waitUntilSettled(10_000);
      if (settled !== "settled") return { outcome: "not-ready", name } as const;
      if (!(yield* saved)) return { outcome: "save-failed", name } as const;
      /** What a write this editor can no longer stand behind answers. */
      const refusal = () =>
        !available()
          ? ({ outcome: "unavailable", name } as const)
          : this.#sourceRevision !== revision
            ? ({ outcome: "not-ready", name } as const)
            : null;
      const before = refusal();
      if (before) return before;
      return yield* (yield* NoteFeature)
        .updateNote(origin.file, {
          indexedKey: origin.indexedKey,
          scope: "full",
          profile: origin.profile,
          // The note operation stops its write where this throws.
          beforeWrite: () => {
            if (refusal()) throw new Error("The originating note moved on");
          },
        })
        .pipe(
          Effect.map((result): OriginatingNoteUpdateOutcome =>
            // The note no longer belongs to the item this editor opened it for,
            // so another update from here would be refused the same way.
            result.diagnostic?.code === "literature-note-key-changed"
              ? { outcome: "unavailable", name }
              : {
                  outcome: result.diagnostic ? "refused" : "updated",
                  name,
                  result,
                },
          ),
          Effect.catch((error) => {
            const refused = refusal();
            return refused
              ? Effect.succeed(refused)
              : Effect.fail(
                  new OriginatingNoteUpdateError({
                    note: name,
                    cause: plainNoteError(error),
                  }),
                );
          }),
        );
    }).pipe(withLogCategory("template-workbench"));
  }

  constructor(leaf: WorkspaceLeaf, deps: TemplateWorkbenchDeps) {
    super(leaf);
    this.#deps = deps;
    const renderer = deps.nativePreview
      ? makeNativeRenderer(deps.nativePreview)
      : null;
    this.model = makeTemplateWorkbenchModel();
    this.#release = holdTemplateWorkbenchModel(deps.registry, this.model);
    // Closing the leaf interrupts every Effect it still runs.
    this.#runner = makeViewRunner(deps.registry);
    this.#origins = latestSlot(this.#runner.run);
    this.#reads = latestSlot(this.#runner.run);
    this.#noteUpdates = inFlightSlot(
      this.#runner.run,
      Effect.suspend(() => this.#noteUpdate()),
      () => this.registry.set(this.model.updating, this.#noteUpdates.running()),
    );
    this.#customizing = inFlightSlot(
      this.#runner.run,
      Effect.suspend(() => this.#customize()),
    );
    this.#styles = inFlightSlot(
      this.#runner.run,
      Effect.suspend(() => this.#refreshStyles()),
    );
    this.#cleanup.defer(deps.registry.mount(this.#exportCommand));
    this.#cleanup.defer(deps.registry.mount(templateFolderAtom));
    this.#cleanup.defer(deps.registry.mount(defaultProfilePathAtom));
    this.#cleanup.defer(deps.registry.mount(partialDocumentsAtom));
    this.#cleanup.defer(deps.registry.mount(zoteroStateAtom));
    this.#cleanup.defer(deps.registry.mount(profilesAtom));
    this.contentEl.addClass("zt-root", "zt-template-workbench");
    const nativeRenderer = renderer;
    const render: WorkbenchHost["render"] =
      (nativeRenderer
        ? (request) => this.toHostEffect(nativeRenderer.render(request))
        : deps.render) ??
      ((request) =>
        Effect.succeed(
          failedRender(renderIdentity(request), { code: "render-error" }),
        ));
    this.#host = createTemplateWorkbenchHost(
      this.app,
      {
        run: this.#runner.run,
        render,
        ...(deps.nativePreview && {
          openCitationEngineSettings:
            deps.nativePreview.openCitationEngineSettings,
        }),
        markdown: (props) => <WorkbenchMarkdown {...props} view={this} />,
        matchData: createMatchData(this.#runner.provide),
        insertTarget: () => this.insertTarget,
        window: () => this.contentEl.win,
        partials: {
          names: () => this.partialNames,
          create: (query) =>
            this.toHostEffect(
              createSharedPartialEffect(this.app, { name: query }),
            ),
        },
        // The menu runs this on the host's runner, which is this leaf's.
        extractPartial: (source) =>
          this.#runner.provide(this.#extractPartial(source)),
        hoverParent: this,
        fieldsAction: this.#fieldsAction,
      },
      (content) => this.provide(content),
    );
    this.#editor = createWorkbenchEditor({
      host: this.#host,
      registry: deps.registry,
      runtime: viewRuntime,
      view: this.model.view,
      partialName: Atom.map(this.model.document, (facts) => facts.partialName),
      itemData: this.model.itemData,
      viewSize: this.viewSize,
      controller: this.#controller,
      reportContext: () => this.reportContext(this.#defaultRoot),
      mapResult: nativeResult,
      retain: retainNativeOutputs,
    });
    this.partialPreviews =
      renderer &&
      makePartialPreviews({
        model: this.model,
        workbench: this.#editor.model,
        renderPartial: renderer.partial,
        source: () => this.#controller.source,
      });
    this.fields = makeFieldsPanelModel(this.model, this.#editor.model, {
      document: this.#editor.model.document,
      insertTarget: () => this.insertTarget,
    });
    this.#cleanup.defer(deps.registry.mount(this.fields.local));
    this.fieldsActions = makeFieldsActions(this, this.#host, (target) =>
      this.exportTemplateData(target),
    );
    this.#cleanup.defer(this.#follow());
    this.#cleanup.defer(this.#logRenders());
    this.scope = new Scope(this.app.scope);
    this.scope.register(["Mod"], "z", (event) => this.#history(event, false));
    this.scope.register(["Mod", "Shift"], "z", (event) =>
      this.#history(event, true),
    );
    this.scope.register(["Mod"], "y", (event) => this.#history(event, true));
    this.#subscribe();
    this.registerEvent(
      this.app.workspace.on("quick-preview", (file, source) => {
        if (
          this.#closed ||
          this.#defaultDraft ||
          this.#bindingDraft ||
          file !== this.file
        )
          return;
        if (this.#initialRead !== null) {
          this.#pendingSource = source;
          return;
        }
        if (source === this.#controller.source) return;
        this.#receivingSource = true;
        try {
          this.#controller.applyExternalSource(source);
          // Native external-file merging must include unsaved peer input.
          this.dirty = true;
        } finally {
          this.#receivingSource = false;
        }
      }),
    );
    // The Default Profile's bindings feed a render through the Profile.
    this.#cleanup.defer(
      watch(deps.registry, this.model.bindingDefaults, () =>
        this.#invalidate(),
      ),
    );
  }
  /** Logs from plain code under this leaf's category, on its runner. */
  #log(entry: Effect.Effect<void>): void {
    this.#runner.run(entry.pipe(withLogCategory("template-workbench")));
  }
  /**
   * The scheduler decides on its own which render runs and which result the
   * reader sees; this reads its state transitions back out as the log lines a
   * diagnosis needs, since the shared package carries no logger of its own.
   */
  #logRenders(): () => void {
    const { registry } = this;
    const { state } = this.workbench.scheduler;
    let previous = registry.get(state);
    return registry.subscribe(state, (next) => {
      const before = previous;
      previous = next;
      if (next.busy === before.busy) return;
      const revision = registry.get(this.model.read).snapshot?.revision;
      this.#log(
        next.busy
          ? Effect.logDebug("Preview render started").pipe(
              Effect.annotateLogs({
                revision,
                live: registry.get(this.workbench.preview).live,
              }),
            )
          : next.result !== null && next.result !== before.result
            ? Effect.logDebug("Preview render published").pipe(
                Effect.annotateLogs({
                  revision: next.result.snapshotRevision,
                  diagnostics: next.result.diagnostics.length,
                }),
              )
            : Effect.logDebug("Discarded stale preview render").pipe(
                Effect.annotateLogs({ revision, closed: this.#closed }),
              ),
      );
    });
  }
  #invalidate(): void {
    if (!this.#closed)
      this.registry.set(this.workbench.scheduler.invalidate, undefined);
  }
  /**
   * What follows this leaf's model: the layout save, the authoring context
   * the companion panes read, and the render's own inputs from outside it.
   * @returns Stops following.
   */
  #follow(): () => void {
    const { registry, model } = this;
    const stops: (() => void)[] = [];
    stops.push(
      watch(registry, model.view, (next, previous) => {
        // A Shared Partial's caller is this root, which its file remembers.
        if (next.root !== previous.root && this.documentKind === "partial")
          this.#rememberPartialChoice();
        if (
          next.tab !== previous.tab ||
          next.root !== previous.root ||
          next.advanced !== previous.advanced ||
          next.item?.id !== previous.item?.id
        )
          this.app.workspace.requestSaveLayout();
      }),
    );
    stops.push(
      // Every choice is saved state.
      registry.subscribe(this.workbench.choices, () =>
        this.app.workspace.requestSaveLayout(),
      ),
      registry.subscribe(this.workbench.panels, () => {
        this.#updateActions();
        this.app.workspace.requestSaveLayout();
      }),
      // The Fields action shows whether its column or its picker is open.
      registry.subscribe(this.workbench.fieldsAction, () =>
        this.#updateActions(),
      ),
    );
    stops.push(
      watch(registry, model.read, (next, previous) => {
        if (
          next.status === "error" &&
          next.error &&
          next.error !== previous.error
        )
          registry.set(this.workbench.scheduler.fail, {
            code: "render-error",
            message: next.error,
          });
      }),
    );
    if (this.#deps.nativePreview) stops.push(this.#followRenderInputs());
    return () => {
      for (const stop of stops.reverse()) stop();
    };
  }
  /** What a native render reads from outside the model: partials, bibliography, the note. */
  #followRenderInputs(): () => void {
    const nativePreview = this.#deps.nativePreview!;
    const { registry } = nativePreview;
    const stops: (() => void)[] = [];
    // A saved partial or bibliography changes what a render reads.
    for (const atom of [templateRevisionAtom, bibliographyRevisionAtom])
      stops.push(
        watch(registry, atom, (next, previous) => {
          if (next !== previous) this.#invalidate();
        }),
      );
    // The note a render previews as an update changed on disk.
    this.registerEvent(
      nativePreview.app.vault.on("modify", (file) => {
        if (
          file.path ===
          this.registry.get(this.workbench.scheduler.state).result?.sourcePath
        )
          this.#invalidate();
      }),
    );
    return () => {
      for (const stop of stops.reverse()) stop();
    };
  }

  get nativeRenderDeps(): NativeRenderDeps | undefined {
    return this.#deps.nativePreview;
  }
  /**
   * The Template Document this view holds, which picks its tabs and its root:
   * the kind the controller was opened for, from the file's path at load.
   */
  get documentKind(): WorkbenchDocumentKind {
    return this.#controller.kind;
  }
  /**
   * What names this Workbench in a copied error report. Read once per failed
   * attempt, so the report keeps the document, root, and Item that attempt
   * ran against however the reader moves on afterwards.
   *
   * `selection` is the Item the attempt read, which a linked preview answers
   * for itself: a pinned one keeps the Item it was pinned on while this editor
   * moves to another. Left out, this editor's own choice answers.
   */
  reportContext(
    root: TemplateRoot,
    selection: string | null = this.#view.item?.id ?? null,
  ): WorkbenchReportContext {
    const path = this.file?.path;
    const version = this.#deps.pluginVersion;
    return {
      ...(path === undefined ? {} : { document: path }),
      language: this.#controller.language,
      root,
      ...(selection === null ? {} : { selection }),
      ...(version === undefined ? {} : { zotlitVersion: version }),
      hostVersion: `Obsidian ${apiVersion}`,
    };
  }
  /** The folder a filename has to sit in to name a Template Document. */
  get #templateFolder(): string {
    return this.registry.get(templateFolderAtom);
  }
  /** The root an editor with no template region of its own writes. */
  get #defaultRoot(): TemplateRoot {
    if (this.documentKind === "citation") return "citation";
    return this.documentKind === "partial" ? this.partialContext : "note";
  }
  /**
   * The caller a Shared Partial is previewed as called from, which is the root
   * its one editor completes and its companions read.
   *
   * @see {@link PartialContext} for whose choice it is.
   */
  get partialContext(): PartialContext {
    const { root } = this.#view;
    return isPartialContext(root) ? root : DEFAULT_PARTIAL_CONTEXT;
  }
  /** The Profile a Shared Partial preview reads bindings from; null is the default one. */
  get partialProfile(): string | null {
    return this.registry.get(this.workbench.choices).partialProfile;
  }
  /** Applies the caller and Profile the reader chose for this partial. */
  setPartialSelection(selection: PartialChoice): void {
    if (this.documentKind !== "partial") return;
    this.registry.update(
      this.workbench.choices,
      choosePartialProfile(selection.profile),
    );
    this.#update(setRoot(selection.context));
    this.#rememberPartialChoice();
  }

  /**
   * Hold this partial's caller and Profile against its own file, so reopening
   * it — in a new leaf, or after a restart — shows the choice the reader made
   * rather than the default the workspace has no leaf left to carry.
   */
  #rememberPartialChoice(): void {
    if (this.documentKind !== "partial") return;
    writePartialChoice(this.app, this.file?.path ?? null, {
      context: this.partialContext,
      profile: this.partialProfile,
    });
  }
  /**
   * Measures the leaf, whose size places the side panels. A leaf in a
   * background tab measures nothing and keeps the size it last had.
   */
  #measure(): void {
    const { clientWidth: width, clientHeight: height } = this.contentEl;
    if (width === 0 || height === 0) return;
    const current = this.registry.get(this.viewSize);
    if (current?.width !== width || current.height !== height)
      this.registry.set(this.viewSize, {
        width,
        height,
        handle: PANEL_HANDLE_WIDTH,
      });
  }
  override onResize(): void {
    super.onResize();
    for (const element of this.contentEl.querySelectorAll<HTMLElement>(
      ".cm-editor",
    )) {
      const editor = EditorView.findFromDOM(element);
      if (editor && editor.root !== element.ownerDocument)
        editor.setRoot(element.ownerDocument);
    }
  }
  subscribeReveals(
    listener: (
      target: Pick<WorkbenchProblem, "slice" | "range" | "params">,
    ) => void,
  ): () => void {
    this.#revealListeners.add(listener);
    return () => {
      this.#revealListeners.delete(listener);
    };
  }
  /**
   * Opens the Problems area on whatever it already has selected, which is
   * what a failed note operation asks for.
   */
  openProblems(reveal = true): void {
    for (const listener of this.#openProblemsListeners) listener();
    // A deliberate request brings this editor forward; a failed automatic or
    // Run attempt leaves the reader's pane where they put it.
    if (reveal) void this.app.workspace.revealLeaf(this.leaf);
  }
  subscribeOpenProblems(listener: () => void): () => void {
    this.#openProblemsListeners.add(listener);
    return () => {
      this.#openProblemsListeners.delete(listener);
    };
  }
  /** Records the captured failure that brought the reader here, and opens Problems. */
  explainArrival(arrival: ArrivingProblem): void {
    this.#arrival = arrival;
    this.openProblems(false);
  }
  /** Takes one arrival so it opens one explanation. */
  takeArrival(): ArrivingProblem | null {
    const held = this.#arrival;
    this.#arrival = null;
    return held;
  }
  get arrival(): ArrivingProblem | null {
    return this.#arrival;
  }
  revealSlice(slice: "advanced" | "annotation" | `entry:${number}`): void {
    const range = this.#controller.sliceRange(slice);
    for (const listener of this.#revealListeners)
      listener({ slice, ...(range ? { range } : {}) });
    void this.app.workspace.revealLeaf(this.leaf);
  }
  get controller(): WorkbenchDocumentController {
    return this.#controller;
  }
  /** The last focused slice remains the insertion target while a sidebar has focus. */
  get insertTarget(): WorkbenchInsertTarget | null {
    return insertionTarget(this.#view.presentation.selection, this.#controller);
  }

  /** Inserts the field `node` names at the editor's insertion target. */
  insertTemplateField(node: DisplayNode): boolean {
    if (this.#closed || this.#controller.readOnly) return false;
    const target = this.insertTarget;
    if (!target) return false;
    const region = this.#controller.templateRegions.find(
      (region) =>
        target.range.from >= region.from && target.range.to <= region.to,
    );
    const mode = region?.expression
      ? "expression"
      : region?.language === "json-e"
        ? "json-e"
        : "template";
    const engine = this.#documentLanguage;
    return this.insertField(fieldSnippet(node, mode, { engine }));
  }

  insertField(snippet: string): boolean {
    if (this.#controller.readOnly || this.#closed) return false;
    const target = this.insertTarget;
    if (!target) {
      this.#log(
        Effect.logTrace("Rejected Explorer insertion").pipe(
          Effect.annotateLogs({
            slice: this.#view.presentation.selection?.slice ?? null,
            reason: this.#view.presentation.selection
              ? "removed-slice"
              : "no-selection",
          }),
        ),
      );
      return false;
    }
    const range = this.#controller.sliceRange(target.slice);
    const from = Math.min(Math.max(target.range.from, range.from), range.to);
    const to = Math.min(Math.max(target.range.to, from), range.to);
    this.#controller.dispatch({
      changes: { from, to, insert: snippet },
      userEvent: "input.complete",
    });
    this.#log(
      Effect.logDebug("Applied Explorer insertion").pipe(
        Effect.annotateLogs({ slice: target.slice }),
      ),
    );
    const cursor = from + snippet.length;
    this.#focusTarget({
      slice: target.slice,
      range: { from: cursor, to: cursor },
    });
    return true;
  }

  #focusTarget(target: WorkbenchInsertTarget): void {
    this.registry.set(this.model.insertRequest, target);
    this.setPresentation({ selection: target });
    const state = this.change;
    state.setAdvanced(target.slice === "advanced");
    state.setTab(
      entryPosition(target.slice) !== null
        ? "properties"
        : target.slice === "filename"
          ? "name"
          : target.slice === "annotation"
            ? "annotation"
            : target.slice === "source"
              ? this.documentKind === "partial"
                ? "partial"
                : "citation"
              : "note",
    );
    state.setRoot(
      this.#controller.templateRegions.find(
        (region) =>
          target.range.from >= region.from && target.range.to <= region.to,
      )?.root ?? this.#defaultRoot,
    );
    this.app.workspace.setActiveLeaf(this.leaf, { focus: false });
  }

  override getViewType(): string {
    return TEMPLATE_WORKBENCH_VIEW_TYPE;
  }
  override getDisplayText(): string {
    if (this.documentKind === "citation")
      return m.template_workbench_title_citation();
    const name = templatePartialName(
      this.file?.path ?? "",
      this.#templateFolder,
    );
    if (name !== null) return m.template_workbench_title_partial({ name });
    const label = this.profileLabel;
    return label === null
      ? m.template_workbench_name()
      : m.template_workbench_title_profile({ label });
  }
  /**
   * The name the Profile calls itself, which the tab title carries beside its
   * kind. The manifest's own name leads, so a renamed file still reads as the
   * Profile the reader knows; a draft that does not parse falls back to it.
   */
  get profileLabel(): string | null {
    return (
      this.#controller.document?.manifest.name ?? this.file?.basename ?? null
    );
  }
  override getIcon(): string {
    return "file-pen-line";
  }
  override getViewData(): string {
    return this.#controller.source;
  }
  override setViewData(input: string, clear: boolean): void {
    let source = input;
    if (this.#bindingDraft) {
      this.data = source;
      return;
    }
    if (clear && this.file && !this.#clearing) {
      source =
        this.#pendingSource ??
        loadedTextFileView(this.app, this.file, this)?.getViewData() ??
        source;
      this.#pendingSource = null;
    }
    if (clear) {
      this.#host[Symbol.dispose]();
      this.#unsubscribe?.();
      this.#loads++;
      this.#sourceRevision++;
      this.#controller = new WorkbenchDocumentController(source, {
        runtime: "native",
        readOnly: this.#defaultDraft,
        kind: templateDocumentKind(this.file, this.#templateFolder),
        context: () => this.partialContext,
      });
      this.registry.set(this.model.document, {
        path: this.file?.path ?? null,
        partialName: templatePartialName(
          this.file?.path ?? "",
          this.#templateFolder,
        ),
      });
      this.#editor.attach(this.#controller);
      this.setPresentation({
        selection: null,
        selected: null,
        reveal: null,
        fieldFocus: null,
        scroll: {},
        restoring: false,
      });
      this.registry.set(this.model.insertRequest, null);
      this.#applyKindDefaults();
      this.#subscribe();
      this.#mount();
    } else this.#controller.applyExternalSource(source);
    this.data = this.#controller.source;
    if (clear && this.file && !this.#clearing) {
      if (this.data !== this.lastSavedData) this.dirty = true;
      this.app.workspace.trigger("quick-preview", this.file, this.data);
    }
  }
  /** Obsidian's file read, run on this leaf so its close stops the read. */
  override loadFileInternal(file: TFile, clear: boolean): Promise<void> {
    return answerOf(this.#reads.run(this.#loadFile(file, clear)), undefined);
  }
  /**
   * Read `file` into this view. A read that a newer read, an edit, or another
   * file outran is discarded before it changes anything, and read again while
   * the edit is the only change. Closing the leaf stops the read.
   */
  #loadFile(
    file: TFile,
    clear: boolean,
  ): Effect.Effect<void, Cause.UnknownError> {
    const loadBase = (receiver: this, reset: boolean) =>
      super.loadFileInternal.call(receiver, file, reset);
    return Effect.suspend(() => {
      const initial = {};
      let reset = clear;
      if (clear) this.#initialRead = initial;
      /** Set once the read is interrupted; the native read then stands down. */
      let stopped = false;
      const read = (): Effect.Effect<void, Cause.UnknownError> =>
        Effect.suspend(() => {
          if (file !== this.file) return Effect.void;
          const revision = this.#sourceRevision;
          const baseline = this.lastSavedData;
          // TextFileView writes its baseline immediately after the awaited
          // read, before its native three-way merge. Cancel there, before any
          // mutation; native methods still run on this view so private fields
          // keep their owner.
          const receiver = new Proxy(this, {
            get(target, property) {
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
            set: (target, property, value) => {
              if (
                property === "lastSavedData" &&
                (stopped ||
                  file !== this.file ||
                  revision !== this.#sourceRevision ||
                  baseline !== this.lastSavedData)
              )
                throw new StaleSourceRead();
              return Reflect.set(target, property, value, target);
            },
          });
          return Effect.tryPromise({
            try: () => loadBase(receiver, reset),
            catch: (cause) =>
              cause instanceof StaleSourceRead
                ? cause
                : new Cause.UnknownError(cause),
          }).pipe(
            Effect.catchTag("StaleSourceRead", () =>
              Effect.gen({ self: this }, function* () {
                yield* Effect.logTrace(
                  "Discarded stale Profile source read",
                ).pipe(
                  Effect.annotateLogs({
                    path: file.path,
                    fileChanged: file !== this.file,
                    sourceChanged: revision !== this.#sourceRevision,
                    baselineChanged: baseline !== this.lastSavedData,
                  }),
                );
                if (revision !== this.#sourceRevision) reset = false;
                yield* read();
              }),
            ),
          );
        });
      return read().pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            stopped = true;
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (this.#initialRead === initial) {
              this.#initialRead = null;
              this.#pendingSource = null;
            }
          }),
        ),
        withLogCategory("template-workbench"),
      );
    });
  }
  override clear(): void {
    if (this.#defaultDraft || this.#bindingDraft) return;
    this.#reads.interrupt();
    this.#clearing = true;
    try {
      this.setViewData("", true);
    } finally {
      this.#clearing = false;
    }
  }

  override getState(): Record<string, unknown> {
    return {
      ...super.getState(),
      ...savedWorkbench({
        defaultDraft: this.#defaultDraft,
        view: this.#view,
        choices: this.registry.get(this.workbench.choices),
        panels: this.registry.get(this.workbench.panels),
        partial:
          this.documentKind === "partial"
            ? { context: this.partialContext, profile: this.partialProfile }
            : null,
      }),
    };
  }
  setPresentation(value: Partial<WorkbenchViewState["presentation"]>): void {
    this.#update(setPresentation(value));
  }
  #presentationContext(): string {
    return JSON.stringify([
      this.file?.path ?? (this.#defaultDraft ? "default" : null),
      this.#view.item?.id ?? null,
    ]);
  }
  override getEphemeralState(): Record<string, unknown> {
    const { presentation } = this.#view;
    return {
      zotlitTemplateWorkbench: {
        context: this.#presentationContext(),
        selection: presentation.selection,
        selected: presentation.selected,
        field: presentation.fieldFocus?.field ?? null,
        scroll: presentation.scroll,
      },
    };
  }
  override setEphemeralState(input: unknown): void {
    const state = readEphemeralWorkbench(input);
    if (!state || state.context !== this.#presentationContext()) return;
    // The decoded target names a slice of some document; this one checks it.
    const selection = state.selection as WorkbenchInsertTarget | null;
    let restoredSelection: WorkbenchInsertTarget | null = null;
    if (selection && this.controller.hasSlice(selection.slice)) {
      const slice = this.controller.sliceRange(selection.slice);
      const clamp = (position: number) =>
        Math.max(slice.from, Math.min(slice.to, position));
      const anchor = clamp(selection.range.anchor ?? selection.range.from);
      const head = clamp(selection.range.head ?? selection.range.to);
      restoredSelection = {
        slice: selection.slice,
        range: {
          from: Math.min(anchor, head),
          to: Math.max(anchor, head),
          ...(anchor > head ? { anchor, head } : {}),
        },
      };
    }
    const selected =
      state.selected !== null &&
      state.selected < (this.controller.managedEntries?.length ?? 0)
        ? state.selected
        : null;
    this.setPresentation({
      selection: restoredSelection,
      selected,
      reveal: restoredSelection
        ? {
            ...restoredSelection.range,
            slice: restoredSelection.slice,
            focus: state.focus,
            scrollIntoView: false,
          }
        : null,
      fieldFocus:
        state.field === null
          ? null
          : { field: state.field, focus: state.focus, scrollIntoView: false },
      scroll: state.scroll,
      restoreVersion: this.#view.presentation.restoreVersion + 1,
      restoring: true,
    });
  }
  restoreScroll(): void {
    const { scroll, restoring } = this.#view.presentation;
    if (
      !restoring ||
      this.registry.get(this.model.read).status === "loading" ||
      !this.contentEl.querySelector("[data-workbench-scroll]")
    )
      return;
    for (const element of this.contentEl.querySelectorAll<HTMLElement>(
      "[data-workbench-scroll]",
    )) {
      const position = scroll[element.dataset.workbenchScroll!];
      if (position) {
        element.scrollTop = position.top;
        element.scrollLeft = position.left;
      }
    }
    this.setPresentation({ restoring: false });
  }
  /** Obsidian's view-state restore, run on this leaf. */
  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    const previous = JSON.stringify(this.getState());
    try {
      await answerOf(
        this.#runner.run(this.#restoreState(state, result)),
        undefined,
      );
    } finally {
      if (previous !== JSON.stringify(this.getState())) result.history = true;
    }
  }
  #restoreState(state: unknown, result: ViewStateResult) {
    const restoreBase = (state: unknown) =>
      Effect.tryPromise(() => super.setState(state, result));
    return Effect.gen({ self: this }, function* () {
      const value = readSavedWorkbench(state);
      // The saved choice lands first, so a choice the reader makes while the
      // document loads comes after it and stands.
      if (value) {
        const { itemIndexedKey, annotationId } = value;
        if (itemIndexedKey !== undefined)
          this.#update(
            chooseItem(
              itemIndexedKey === null
                ? null
                : this.#view.item?.id === itemIndexedKey
                  ? this.#view.item
                  : { id: itemIndexedKey, title: null },
            ),
          );
        if (annotationId !== undefined)
          this.registry.update(
            this.workbench.choices,
            chooseAnnotation(annotationId),
          );
      }
      const builtin =
        !!state &&
        typeof state === "object" &&
        "defaultDraft" in state &&
        state.defaultDraft === true;
      if (builtin) {
        this.allowNoFile = true;
        yield* restoreBase({ ...state, file: null });
        this.#defaultDraft = true;
        this.setViewData(yield* builtInSource, true);
      } else {
        if (
          !this.#bindingDraft &&
          state &&
          typeof state === "object" &&
          "file" in state &&
          typeof state.file === "string"
        ) {
          this.#defaultDraft = false;
          this.allowNoFile = false;
        }
        yield* restoreBase(state);
      }
      if (!value) return;
      for (const side of ["fields", "preview"] as const) {
        const panel = value.panels[side];
        if (panel)
          this.registry.update(this.workbench.panels, (panels) =>
            setPanelWidth(
              side,
              panel.width,
            )(showPanel(side, panel.shown)(panels)),
          );
      }
      const height = value.panels.preview?.height;
      if (height !== undefined)
        this.registry.update(this.workbench.panels, setPreviewHeight(height));
      this.registry.update(this.workbench.choices, setPreview(value.preview));
      this.registry.update(
        this.workbench.choices,
        chooseCitation(value.citation),
      );
      const { change } = this;
      if (this.#applyKindDefaults()) {
        // A plain document has one tab and one editor, so nothing of the saved
        // tab or Basic and Source choice applies to it. A Shared Partial's root
        // is the reader's own "as called from" choice, which the workspace
        // carries with the Profile it was chosen beside. A descriptor that names
        // the file alone — every open through `openTemplateWorkbench` — keeps
        // what `#applyKindDefaults` read back from this device instead. The
        // Profile is set first, so the root subscription remembers the pair.
        if (this.documentKind === "partial" && value.partialContext !== null) {
          this.registry.update(
            this.workbench.choices,
            choosePartialProfile(value.partialProfile),
          );
          change.setRoot(value.partialContext);
        }
      } else {
        if (value.tab !== null)
          change.setTab(
            value.tab === "match" && this.isDefaultProfile ? "note" : value.tab,
          );
        if (value.root !== null && value.root !== "citation")
          change.setRoot(value.root);
        else if (value.tab !== null)
          change.setRoot(
            this.#view.tab === "annotation"
              ? "annotation"
              : this.#view.tab === "name"
                ? "filename"
                : "note",
          );
        if (value.advanced !== null) change.setAdvanced(value.advanced);
      }
    });
  }

  /**
   * The tab, root, and edit mode the kind fixes. A plain document is one
   * editor over one source under one root, so it has no such choice to make or
   * to restore. A Profile document keeps the reader's own choice, less a tab
   * and root the leaf held for a document of another kind.
   * @returns whether the kind fixed them.
   */
  #applyKindDefaults(): boolean {
    const { change } = this;
    const kind = this.documentKind;
    if (kind === "profile") {
      // A tab and root this leaf kept from a document of another kind name no
      // panel and no data here, which would leave every panel unmounted.
      if (!TABS.includes(this.#view.tab)) {
        change.setTab("note");
        change.setRoot("note");
      }
      return false;
    }
    change.setTab(kind);
    change.setAdvanced(false);
    if (kind === "citation") {
      change.setRoot("citation");
      return true;
    }
    // The caller and the Profile belong to the partial they were chosen for, so
    // a leaf that moves to another partial — or that kept a root from a document
    // of another kind — opens on the default caller rather than on that choice.
    const path = this.file?.path ?? null;
    if (path !== this.#partialChoiceFile) {
      this.#partialChoiceFile = path;
      const held = readPartialChoice(this.app, path);
      this.registry.update(
        this.workbench.choices,
        choosePartialProfile(held.profile),
      );
      change.setRoot(held.context);
    } else if (!isPartialContext(this.#view.root))
      change.setRoot(DEFAULT_PARTIAL_CONTEXT);
    return true;
  }

  protected override onOpen(): Promise<void> {
    this.#closed = false;
    this.#release ??= holdTemplateWorkbenchModel(this.registry, this.model);
    this.#sizeObserver?.disconnect();
    const { ResizeObserver } = this.contentEl.win as typeof window;
    const observer = new ResizeObserver(() => this.#measure());
    observer.observe(this.contentEl);
    this.#sizeObserver = observer;
    this.#measure();
    this.registerDomEvent(
      this.contentEl,
      "scroll",
      (event) => {
        const element = event.target as HTMLElement;
        const key = element.dataset?.workbenchScroll;
        if (!key || this.#view.presentation.restoring) return;
        this.setPresentation({
          scroll: {
            ...this.#view.presentation.scroll,
            [key]: { top: element.scrollTop, left: element.scrollLeft },
          },
        });
      },
      true,
    );
    // Added first, so it sits nearest More options; Obsidian prepends actions.
    const preview = this.addAction(
      "panel-right",
      m.workbench_show_preview(),
      () => this.togglePanel("preview"),
    );
    // Added after the Preview's, so it sits to its left.
    // It shows the Fields column, or opens the Fields picker where the column
    // does not fit.
    const fields = this.addAction("panel-left", m.workbench_show_fields(), () =>
      pressFieldsAction(this.registry, this.workbench),
    );
    this.#fieldsAnchor.current = fields;
    // Where it opens the picker, an arrow opens it and a printable key opens
    // it searching for that key, as a Bases combobox opens.
    this.registerDomEvent(fields, "keydown", (event) => {
      const action = this.registry.get(this.workbench.fieldsAction);
      const query = fieldsActionKey(action, event);
      if (query === null) return;
      event.preventDefault();
      this.registry.set(this.workbench.fieldsPicker, { query });
    });
    for (const type of ["pointerdown", "mousedown"] as const)
      this.registerDomEvent(fields, type, (event) =>
        holdPickerFocus(this.registry.get(this.workbench.fieldsAction), event),
      );
    const source = this.addAction("code", m.workbench_advanced(), () => {
      this.change.setAdvanced(!this.#view.advanced);
    });
    const choose = this.addAction("search", m.workbench_choose_item(), () => {
      if (this.#view.root === "annotation") this.startAnnotationChoice();
      else this.startItemChoice();
    });
    const redo = this.addAction("redo-2", m.workbench_redo(), () => {
      this.#controller.redo();
    });
    const undo = this.addAction("undo-2", m.workbench_undo(), () => {
      this.#controller.undo();
    });
    this.#updateActions = () => {
      choose.setAttribute(
        "aria-label",
        this.#view.root === "annotation"
          ? m.workbench_choose_annotation()
          : m.workbench_choose_item(),
      );
      for (const [action, enabled] of [
        [undo, this.#controller.canUndo],
        [redo, this.#controller.canRedo],
      ] as const) {
        action.setAttribute("aria-disabled", String(!enabled));
        action.classList.toggle("is-disabled", !enabled);
      }
      // Basic and Source are two views of a Profile document's structure; a
      // plain document is one source, so it is never offered the choice.
      source.toggle(this.documentKind === "profile");
      const { advanced } = this.#view;
      source.setAttribute("aria-pressed", String(advanced));
      source.classList.toggle("is-active", advanced);
      const shown = this.registry.get(this.workbench.panels).preview.shown;
      preview.setAttribute("aria-pressed", String(shown));
      preview.classList.toggle("is-active", shown);
      const action = this.registry.get(this.workbench.fieldsAction);
      // A toggle for the column; a disclosure for the picker.
      for (const [name, value] of Object.entries(
        fieldsActionAttributes(action, this.#fieldsAction.popoverId),
      ))
        if (value === undefined) fields.removeAttribute(name);
        else fields.setAttribute(name, value);
      fields.classList.toggle("is-active", action.open);
    };
    const syncChrome = () => {
      this.#updateActions();
      const title = this.getDisplayText();
      if (this.titleEl.textContent !== title) {
        this.titleEl.textContent = title;
        this.leaf.updateHeader();
      }
    };
    this.#cleanup.defer(this.registry.subscribe(this.model.view, syncChrome));
    this.#cleanup.defer(
      this.registry.subscribe(this.workbench.document.revision, syncChrome),
    );
    this.#cleanup.defer(
      this.registry.subscribe(templateFolderAtom, syncChrome),
    );
    this.#cleanup.defer(
      this.registry.subscribe(defaultProfilePathAtom, syncChrome),
    );
    syncChrome();
    this.#updateActions();
    this.#root = createRoot(this.contentEl);
    this.#mount();
    this.startStylesRefresh();
    return Promise.resolve();
  }
  /**
   * Obsidian's close. It waits for the write a running flow has started, such
   * as a save or the originating note's write, and interrupts the rest.
   */
  protected override async onClose(): Promise<void> {
    this.#closed = true;
    try {
      await super.onClose();
    } finally {
      this.#root?.unmount();
      this.#root = null;
      this.#sizeObserver?.disconnect();
      this.#sizeObserver = null;
      this.#cleanup.dispose();
      // Interrupts what still runs before the host and the editor go.
      const stopped = this.#runner[Symbol.asyncDispose]();
      this.#editor[Symbol.dispose]();
      this.#host[Symbol.dispose]();
      this.#unsubscribe?.();
      this.#unsubscribe = null;
      this.#release?.();
      this.#release = null;
      await stopped;
    }
  }

  templateDataTarget(): TemplateDataExportTarget | null {
    const { item, root } = this.#view;
    const { current, example } = this.registry.get(this.workbench.examples);
    const indexedKey = example?.root.indexedKey;
    return exportTarget(
      item,
      root,
      typeof indexedKey === "string" &&
        current.some((entry) => entry.id === example?.id)
        ? indexedKey
        : null,
    );
  }

  /** Saves the Template data of `target` as a JSON file. */
  exportTemplateData(target: TemplateDataExportTarget): void {
    const pluginVersion = this.#deps.pluginVersion;
    if (pluginVersion)
      this.registry.set(this.#exportCommand, { ...target, pluginVersion });
  }

  templateDataExportLabel(): string {
    return this.#view.root === "annotation" &&
      this.templateDataTarget()?.root === "note"
      ? m.template_data_explorer_export_selected_paper()
      : m.template_data_explorer_menu_export_json();
  }

  /** Shows a side panel the leaf hides, or hides one it shows. */
  togglePanel(side: PanelSide): void {
    this.registry.update(this.workbench.panels, (panels) =>
      showPanel(side, !panels[side].shown)(panels),
    );
  }

  override onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.pane)
        .setTitle(m.workbench_show_fields())
        .setIcon("panel-left")
        // The view action's own press: the column, or the picker where the
        // column does not fit.
        .setChecked(this.registry.get(this.workbench.fieldsAction).open)
        .onClick(() => pressFieldsAction(this.registry, this.workbench)),
    );
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.pane)
        .setTitle(m.workbench_show_preview())
        .setIcon("panel-right")
        .setChecked(this.registry.get(this.workbench.panels).preview.shown)
        .onClick(() => this.togglePanel("preview")),
    );
    this.#addPanelSizeMenu(menu);
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.open)
        .setTitle(m.template_workbench_open_layout())
        .setIcon("panels-top-left")
        .onClick(() => this.#act("open-workbench", openWorkbenchLayout(this))),
    );
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.action)
        .setTitle(m.workbench_choose_item())
        .setIcon("search")
        .onClick(() => this.startItemChoice()),
    );
    if (this.documentKind !== "citation")
      menu.addItem((item) =>
        item
          .setSection(MENU_SECTION.action)
          .setTitle(m.workbench_choose_annotation())
          .setIcon("highlighter")
          .onClick(() => this.startAnnotationChoice()),
      );
    this.#addPartialsMenu(menu);
    this.#addPreviewMenu(menu);
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.open)
        .setTitle(m.template_workbench_open_citation())
        .setIcon("quote")
        .onClick(() => this.#start(Effect.ignore(reportCitationTemplateOpen))),
    );
    if (this.documentKind !== "profile") this.#addLanguageMenu(menu);
    // With the Fields shown, the export saves the root the panel shows.
    const target = this.templateDataTarget();
    if (this.registry.get(this.workbench.panels).fields.shown)
      this.fieldsActions.addExportMenuItem(menu);
    else if (target && this.#deps.pluginVersion)
      menu.addItem((item) =>
        item
          .setSection(MENU_SECTION.action)
          .setTitle(this.templateDataExportLabel())
          .setIcon("file-json")
          .onClick(() => this.exportTemplateData(target)),
      );
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.open)
        .setTitle(m.template_workbench_open_markdown())
        .setIcon("file-text")
        .setDisabled(!this.file)
        .onClick(() => this.#act("open-markdown", this.#openMarkdown())),
    );
    this.#addHelpMenu(menu);
    if (this.file?.path === this.registry.get(defaultProfilePathAtom))
      menu.addItem((item) =>
        item
          .setSection(MENU_SECTION.danger)
          .setTitle(m.settings_profile_document_restore())
          .setWarning(true)
          .setIcon("rotate-ccw")
          .onClick(() => this.#start(Effect.ignore(this.#restoreDefault()))),
      );
  }
  /**
   * One submenu per handle the leaf draws, named as the handle is, to grow,
   * shrink or reset its panel without a drag (WCAG 2.5.7).
   */
  #addPanelSizeMenu(menu: Menu): void {
    const { registry } = this;
    const { panels, panelDefaults } = this.workbench;
    const menus = panelSizeMenus(workbenchM, registry.get(panels), {
      size: registry.get(this.viewSize),
      defaults: panelDefaults,
    });
    for (const { axis, label, items } of menus)
      menu.addItem((item) => {
        item
          .setSection(MENU_SECTION.pane)
          .setTitle(label)
          .setIcon(`move-${axis}`);
        const submenu = item.setSubmenu();
        for (const size of items)
          submenu.addItem((entry) =>
            entry
              .setTitle(size.label)
              .setIcon(
                size.resize === "reset"
                  ? "rotate-ccw"
                  : `${size.resize === "grow" ? "unfold" : "fold"}-${axis}`,
              )
              .setDisabled(size.disabled)
              .onClick(() => pickPanelSize(registry, this.workbench, size)),
          );
      });
  }
  /**
   * The Preview panel's settings (ADR 0048), while the panel shows: what the
   * render reads beside the Item, which note it shows, and how it refreshes.
   */
  #addPreviewMenu(menu: Menu): void {
    const { registry } = this;
    if (!registry.get(this.workbench.panels).preview.shown) return;
    const { mode, citationSet } = previewTarget(
      this.documentKind,
      this.#view.root,
    );
    const { choices } = this.workbench;
    const { preview, variant, citationExample } = registry.get(choices);
    const setSettings = (value: Partial<typeof preview>) =>
      registry.update(choices, setPreview(value));
    const setCitation = (value: Parameters<typeof chooseCitation>[0]) =>
      registry.update(choices, chooseCitation(value));
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.action)
        .setTitle(m.workbench_refresh_item())
        .setIcon("refresh-cw")
        .onClick(() => this.refresh()),
    );
    if (!preview.live)
      menu.addItem((item) =>
        item
          .setSection(MENU_SECTION.action)
          .setTitle(m.workbench_preview_run())
          .setIcon("play")
          .onClick(() => registry.set(this.workbench.scheduler.run, undefined)),
      );
    if (citationSet)
      menu.addItem((item) => {
        item
          .setSection(MENU_SECTION.action)
          .setTitle(m.template_workbench_use_example())
          .setIcon("list");
        const submenu = item.setSubmenu().setNoIcon();
        for (const id of CITATION_EXAMPLE_IDS)
          submenu.addItem((entry) =>
            entry
              .setTitle(citationExampleLabel(m, id))
              .setChecked(citationExample === id)
              .onClick(() => setCitation({ citationExample: id })),
          );
      });
    // The caller leads: it decides which set the Citation pair below it names.
    if (mode === "partial") this.#addCallerMenu(menu);
    if (citationSet)
      for (const [value, title] of [
        ["main", m.template_workbench_preview_main_citation()],
        ["alt", m.template_workbench_preview_alt_citation()],
      ] as const)
        menu.addItem((item) =>
          item
            .setSection(MENU_SECTION.pane)
            .setTitle(title)
            .setIcon("quote")
            .setChecked(variant === value)
            .onClick(() => setCitation({ variant: value })),
        );
    if (mode === "note") {
      const result = registry.get(this.workbench.scheduler.state).result;
      for (const [value, title, icon] of [
        ["create", m.workbench_preview_as_new_note(), "file-plus"],
        ["update", m.workbench_preview_as_updated_note(), "file-pen"],
      ] as const)
        menu.addItem((item) =>
          item
            .setSection(MENU_SECTION.pane)
            .setTitle(title)
            .setIcon(icon)
            .setChecked(preview.mode === value && !preview.showManaged)
            // A Sample Item, or an Item with no note in the vault yet, has no
            // existing note to update; until a result lands the choice stays open.
            .setDisabled(
              value === "update" && result !== null && !result.sourcePath,
            )
            .onClick(() => setSettings({ mode: value, showManaged: false })),
        );
      menu.addItem((item) =>
        item
          .setSection(MENU_SECTION.pane)
          .setTitle(m.workbench_preview_updated_section())
          .setIcon("rows-3")
          .setChecked(preview.showManaged)
          .onClick(() => setSettings({ showManaged: true })),
      );
    }
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.pane)
        .setTitle(m.workbench_preview_auto_refresh())
        .setIcon("zap")
        .setChecked(preview.live)
        .onClick(() => setSettings({ live: !preview.live })),
    );
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.pane)
        .setTitle(m.workbench_show_markdown())
        .setIcon("code")
        .setChecked(preview.showMarkdown)
        .onClick(() => setSettings({ showMarkdown: !preview.showMarkdown })),
    );
  }
  /**
   * The checked triple naming the caller a Shared Partial is rendered as called
   * from, and — only where the vault holds more than one — the Profile whose
   * bindings that caller's data is built with.
   */
  #addCallerMenu(menu: Menu): void {
    const current = this.partialContext;
    const profile = this.partialProfile;
    for (const [context, title, icon] of [
      ["note", m.template_workbench_preview_as_note(), "file-text"],
      [
        "annotation",
        m.template_workbench_preview_as_annotation(),
        "highlighter",
      ],
      ["citation", m.template_workbench_preview_as_citation(), "quote"],
    ] as const)
      menu.addItem((item) =>
        item
          .setSection(MENU_SECTION.pane)
          .setTitle(title)
          .setIcon(icon)
          .setChecked(current === context)
          .onClick(() => this.setPartialSelection({ context, profile })),
      );
    // `profiles` holds the custom Profiles alone, so an empty list is the
    // default Profile by itself: there is nothing to choose between.
    const profiles = this.registry.get(profilesAtom);
    if (profiles.length === 0) return;
    menu.addItem((item) => {
      item
        .setSection(MENU_SECTION.pane)
        .setTitle(m.template_workbench_use_profile())
        .setIcon("book-user");
      const submenu = item.setSubmenu().setNoIcon();
      for (const [id, label] of [
        [null, m.settings_profile_default_name()],
        ...profiles.map(({ id, label }) => [id, label] as const),
      ] as const)
        submenu.addItem((entry) =>
          entry
            .setTitle(label)
            .setChecked(profile === id)
            .onClick(() =>
              this.setPartialSelection({ context: current, profile: id }),
            ),
        );
    });
  }
  /**
   * The docs pages a template author returns to: the step-by-step guide, the
   * syntax and the field references, and the community for what they miss.
   */
  #addHelpMenu(menu: Menu): void {
    const pages: readonly [string, string][] = [
      [m.template_workbench_docs_guide(), "/docs/how-to/customize-a-template"],
      [m.workbench_docs_note(), "/docs/reference/templates/syntax"],
      [m.template_workbench_docs_data(), "/docs/reference/templates/data"],
    ];
    menu.addItem((item) => {
      item
        .setSection(MENU_SECTION.info)
        .setTitle(m.workbench_help())
        .setIcon("circle-help");
      const submenu = item.setSubmenu();
      for (const [title, path] of pages)
        submenu.addItem((entry) =>
          entry
            .setTitle(title)
            .setIcon("book-open")
            .onClick(() => window.open(`${DOCS_SITE_URL}${path}`)),
        );
      submenu.addSeparator();
      submenu.addItem((entry) =>
        entry
          .setTitle(m.workbench_problems_community())
          .setIcon("messages-square")
          .onClick(() => window.open(COMMUNITY)),
      );
    });
  }
  /**
   * Every Shared Partial the vault holds, so the reader moves between
   * documents without leaving the view, and the create flow that ends the list.
   */
  #addPartialsMenu(menu: Menu): void {
    const partials = this.registry.get(partialDocumentsAtom);
    if (!AsyncResult.isSuccess(partials)) return;
    // The partials this document still carries from the Profile it was shared
    // with. Unpacking writes them into files, which is an ordinary partial
    // operation and belongs beside the rest of them rather than inside the
    // reading of a problem (ADR 0056).
    const bundled = this.#controller.document?.manifest.partials ?? [];
    menu.addItem((item) => {
      item
        .setSection(MENU_SECTION.open)
        .setTitle(m.template_workbench_partials())
        .setIcon("puzzle");
      const submenu = item.setSubmenu();
      for (const partial of partials.value)
        submenu.addItem((entry) =>
          entry
            .setTitle(partial.name)
            .setChecked(this.file?.path === partial.path)
            .onClick(() => this.#openPartial(partial.path)),
        );
      submenu.addSeparator();
      submenu.addItem((entry) =>
        entry
          .setTitle(m.workbench_partial_new())
          .setIcon("plus")
          .onClick(() =>
            this.#start(Effect.ignore(this.#createPartial({ name: "" }))),
          ),
      );
      if (bundled.length > 0 && !this.#controller.readOnly)
        submenu.addItem((entry) =>
          entry
            .setTitle(m.workbench_problem_bundled_partial_unpack())
            .setIcon("package-open")
            .onClick(() =>
              this.#start(Effect.ignore(this.#unpackBundledPartials())),
            ),
        );
    });
  }

  #openPartial(path: string): void {
    this.#act(
      "open-partial",
      Effect.gen(function* () {
        const file = yield* (yield* Vault).getFileByPath(path);
        if (file)
          yield* openTemplateWorkbench(file, {
            explainUnsupported: false,
          });
      }),
    );
  }

  /**
   * The shared create flow. A failure answers `null` as a dismissal does.
   *
   * @returns the created name, or `null` when the reader dismisses the prompt.
   */
  #createPartial(
    options: CreateSharedPartialOptions,
  ): Effect.Effect<string | null, never, ViewServices> {
    return createSharedPartialEffect(this.app, options);
  }

  /**
   * Move an editor selection into a new Shared Partial through the same create
   * flow, under this document's own language. The language always writes a
   * manifest, which is what keeps a selection that opens with its own `---`
   * line out of the manifest position.
   *
   * @returns the call that replaces the selection, or `null` when the reader
   *   dismisses the prompt.
   */
  extractPartial(source: string): Effect.Effect<string | null> {
    return joinOnView(this.#runner.run, this.#extractPartial(source));
  }
  #extractPartial(source: string) {
    const language = this.#documentLanguage;
    return this.#createPartial({ source, language, open: "split" }).pipe(
      Effect.map((name) =>
        name === null ? null : partialCall(name, language),
      ),
    );
  }

  /** The language this document renders in; a document with no manifest is Liquid. */
  get #documentLanguage(): TemplateLanguage {
    return (
      this.#controller.document?.manifest.language ??
      this.#controller.plainDocument?.manifest.language ??
      "liquid"
    );
  }

  /**
   * The rendering language, switched on the manifest key alone: a Template
   * changes language by being rewritten, so no source is converted here.
   */
  #addLanguageMenu(menu: Menu): void {
    const current = this.#controller.plainDocument?.manifest.language;
    if (current === undefined) return;
    menu.addItem((item) => {
      item
        .setSection(MENU_SECTION.action)
        .setTitle(m.template_workbench_change_language())
        .setIcon("code-2");
      const submenu = item.setSubmenu().setNoIcon();
      for (const [language, title] of [
        ["liquid", m.workbench_name_language_liquid()],
        ["eta", m.workbench_name_language_eta()],
      ] as const)
        submenu.addItem((entry) =>
          entry
            .setTitle(title)
            .setChecked(current === language)
            .setDisabled(this.#controller.readOnly)
            .onClick(() => this.#controller.setPlainLanguage(language)),
        );
    });
  }
  get isDefaultProfile(): boolean {
    return (
      this.#defaultDraft ||
      Boolean(
        this.file &&
        this.file.path === this.registry.get(defaultProfilePathAtom),
      )
    );
  }
  get isDefaultDraft(): boolean {
    return this.#defaultDraft;
  }
  /**
   * Every Shared Partial the vault registers. Read during render, so it
   * answers empty until the folder scan has run.
   */
  get partialNames(): readonly string[] {
    if (this.#closed) return [];
    return this.registry.get(partialNamesAtom);
  }
  /**
   * Open the Shared Partial `name` in a Template Workbench View of its own.
   * Edit partial reaches a document the vault already holds; a call to a name
   * with no document offers Create instead.
   */
  openPartial(name: string): void {
    const partials = this.registry.get(partialDocumentsAtom);
    if (!AsyncResult.isSuccess(partials)) {
      this.#log(
        Effect.logDebug("Edit partial before the folder scan settled").pipe(
          Effect.annotateLogs({ name }),
        ),
      );
      return;
    }
    const document = partials.value.find((partial) => partial.name === name);
    if (!document) {
      this.#log(
        Effect.logDebug(
          "Edit partial for a name the vault holds no document for",
        ).pipe(Effect.annotateLogs({ name })),
      );
      return;
    }
    this.#openPartial(document.path);
  }
  /**
   * Write every partial this document still carries in its manifest into the
   * Shared Partial file it belongs in, then drop the entries those names came
   * from, so each partial is edited in one place from here on.
   *
   * A name the vault already holds a document for under this very spelling
   * keeps that document, and its entry goes with the rest: the reader's own
   * file answers the call. A name the vault holds a file for only under
   * another case keeps its entry, which is all that still answers the call.
   * The keep-or-replace ask belongs to import, which is where the bundle's copy
   * still has somewhere to go.
   */
  unpackBundledPartials() {
    return joinOnView(this.#runner.run, this.#unpackBundledPartials());
  }
  #unpackBundledPartials() {
    return templateWorkbenchAction(
      "unpack-partials",
      Effect.gen({ self: this }, function* () {
        const bundled = this.#controller.document?.manifest.partials ?? [];
        if (this.#controller.readOnly || !bundled.length) return;
        const template = yield* Template;
        const result = yield* template.unpackPartials(
          yield* template.planPartialUnpack(bundled),
        );
        this.#controller.dropBundledPartials(result.dropped);
        const notifier = yield* Notifier;
        for (const message of unpackedPartialNotices(result))
          yield* notifier.show(message);
      }),
    );
  }
  /** Save this document, then restore the Default Profile and show it. */
  restoreDefault() {
    return joinOnView(this.#runner.run, this.#restoreDefault());
  }
  #restoreDefault() {
    return templateWorkbenchAction(
      "restore-default",
      Effect.gen({ self: this }, function* () {
        const path = this.registry.get(defaultProfilePathAtom);
        const confirmed = yield* awaitConfirm(
          {
            title: m.settings_profile_document_restore_title(),
            content: m.settings_profile_document_restore_desc({ path }),
            action: m.settings_profile_document_restore_action(),
            destructive: true,
          },
          this.app,
        );
        if (!confirmed) return;
        yield* this.#saveFile();
        this.allowNoFile = true;
        this.#defaultDraft = true;
        yield* setLeafState(this.leaf, {
          type: TEMPLATE_WORKBENCH_VIEW_TYPE,
          state: { file: null, defaultDraft: true },
          active: true,
        });
        const profile = yield* Profile;
        yield* profile.restoreDefault;
        this.setViewData(yield* profile.getSource("default"), true);
      }),
    );
  }

  /**
   * Customize binds the existing document before enabling any edits. A second
   * press while the Default Profile materializes joins that run, so the
   * document is written once.
   */
  customizeDefault(): Effect.Effect<void> {
    return this.#customizing.join;
  }
  #customize(): Effect.Effect<void, never, ViewServices> {
    const path = this.registry.get(defaultProfilePathAtom);
    if (!this.#defaultDraft) return Effect.void;
    const controller = this.#controller;
    this.registry.set(this.model.customization, "pending");
    return Effect.gen({ self: this }, function* () {
      yield* Effect.logDebug("Opening Default Profile for customization");
      const { file } = yield* materializeDefault;
      if (!this.#defaultDraft || this.#controller !== controller) return;
      this.#bindingDraft = true;
      yield* Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          yield* setLeafState(this.leaf, {
            type: TEMPLATE_WORKBENCH_VIEW_TYPE,
            state: { ...this.getState(), defaultDraft: false, file: file.path },
            active: true,
          });
          const source =
            loadedTextFileView(this.app, file, this)?.getViewData() ??
            this.data;
          this.#bindingDraft = false;
          this.#defaultDraft = false;
          controller.setReadOnly(false);
          if (source !== controller.source) this.setViewData(source, true);
          this.allowNoFile = false;
          this.data = this.#controller.source;
        }),
        Effect.sync(() => {
          this.#bindingDraft = false;
        }),
      );
      this.#mount();
      yield* openWorkbenchLayout(this);
    }).pipe(
      recover(
        (cause) =>
          Effect.logError("Failed to customize Default Profile").pipe(
            Effect.annotateLogs({ error: Cause.squash(cause) }),
            Effect.andThen(
              Effect.sync(() =>
                this.registry.set(this.model.customization, "failed"),
              ),
            ),
          ),
        Effect.void,
      ),
      Effect.tap(() =>
        Effect.sync(() => {
          if (this.registry.get(this.model.customization) === "pending")
            this.registry.set(this.model.customization, "idle");
        }),
      ),
      Effect.annotateLogs({ path }),
      withLogCategory("template-workbench"),
    );
  }
  /** Read the citation styles again; closing the leaf stops the read quietly. */
  #refreshStyles(): Effect.Effect<void, never, ViewServices> {
    return Effect.gen({ self: this }, function* () {
      const list = yield* installedStyles;
      this.registry.set(this.model.styles, { list, unavailable: false });
    }).pipe(
      recover(
        (cause) =>
          Effect.logWarning(
            "Failed to read Template Workbench citation styles",
          ).pipe(
            Effect.annotateLogs({ error: Cause.squash(cause) }),
            Effect.andThen(
              Effect.sync(() =>
                this.registry.update(this.model.styles, (styles) => ({
                  ...styles,
                  unavailable: true,
                })),
              ),
            ),
          ),
        Effect.void,
      ),
      withLogCategory("template-workbench"),
    );
  }
  /**
   * Read the citation styles again. A request while a read runs joins it, so
   * an older read never lands after a newer one.
   */
  refreshStyles(): Effect.Effect<void> {
    return this.#styles.join;
  }
  /** Save this document, then show it in Obsidian's Markdown view. */
  #openMarkdown(): Effect.Effect<void, Cause.UnknownError> {
    return Effect.gen({ self: this }, function* () {
      const file = this.file;
      if (!file) return;
      yield* this.#saveFile();
      yield* setLeafState(this.leaf, {
        type: "markdown",
        state: { file: file.path },
        active: true,
      });
    });
  }
  /**
   * Ask the reader for an Item. A second request while the chooser is open
   * joins it; the leaf's close interrupts it.
   *
   * @returns whether the reader chose an Item.
   */
  chooseItem(): Effect.Effect<boolean> {
    return this.#join<WorkbenchItemChoice>(this.model.chooseItem, () =>
      workbenchItemChoice(
        this.#host,
        {
          app: this.app,
          lookup: this.#deps.itemLookup,
          settings: this.#deps.settings,
          bridge: this.#deps.bridge,
        },
        this.#view.item ?? undefined,
      ).pipe(
        Effect.tap((choice) =>
          Effect.sync(() => {
            if (choice) this.setItem(choice);
          }),
        ),
      ),
    ).pipe(Effect.map((choice) => choice !== null));
  }
  /**
   * Starts `command` with the chooser `open` makes, or joins the chooser
   * already open.
   * @returns what the reader chose; an interrupt when the leaf closes.
   */
  #join<A>(
    command: Atom.AtomResultFn<
      Effect.Effect<A | null, never, ViewServices>,
      A | null,
      unknown
    >,
    open: () => Effect.Effect<A | null, never, ViewServices>,
  ): Effect.Effect<A | null> {
    return joinOnView(
      this.#runner.run,
      Effect.suspend(() => {
        const { registry } = this;
        if (this.#closed) return Effect.interrupt;
        if (!registry.get(command).waiting) registry.set(command, open());
        return AtomRegistry.getResult(registry, command, {
          suspendOnWaiting: true,
        }).pipe(
          // A chooser that could not open answers as a dismissal does.
          recover(
            (cause) =>
              Effect.logWarning("Template Workbench chooser failed").pipe(
                Effect.annotateLogs({ error: Cause.squash(cause) }),
                withLogCategory("template-workbench"),
              ),
            Effect.succeed(null),
          ),
        );
      }),
    );
  }
  /** Makes `item` the choice of this leaf. */
  setItem(item: WorkbenchItemChoice): void {
    if (this.#closed) return;
    this.registry.set(this.workbench.pick, item);
    this.#remember(item);
  }
  #remember(item: WorkbenchItemChoice): void {
    if (!getSampleItem(item.id)) rememberTemplateItem(this.app, item.id);
  }
  /**
   * Make `item` the choice, and wait for its read.
   * @returns whether the read found it while it is still the choice.
   */
  selectItem(item: WorkbenchItemChoice): Effect.Effect<boolean> {
    return joinOnView(
      this.#runner.run,
      Effect.suspend(() => {
        this.setItem(item);
        const { registry, model } = this;
        const read = AtomRegistry.getResult(registry, model.chosen, {
          suspendOnWaiting: true,
        }).pipe(
          Effect.as(true),
          recover(
            (cause) =>
              Effect.logWarning(
                "Failed to restore Template Workbench Item",
              ).pipe(
                Effect.annotateLogs({
                  indexedKey: item.id,
                  error: Cause.squash(cause),
                }),
                withLogCategory("template-workbench"),
              ),
            Effect.succeed(false),
          ),
        );
        // A newer choice outruns this one before its read answers.
        const outrun = AtomRegistry.toStream(registry, model.item).pipe(
          Stream.filter((choice) => choice?.id !== item.id),
          Stream.runHead,
          Effect.as(false),
        );
        return Effect.raceFirst(read, outrun);
      }),
    );
  }
  /** Read the chosen Item again. */
  refresh(): void {
    if (!this.#closed) this.registry.update(this.model.refresh, (n) => n + 1);
  }
  /** Ask the reader for the annotation the preview renders. */
  chooseAnnotation(): Effect.Effect<void> {
    return this.#join<string>(this.model.chooseAnnotation, () => {
      const { current, example } = this.registry.get(this.workbench.examples);
      return workbenchAnnotationChoice(
        this.#host,
        current,
        example?.id ?? null,
      ).pipe(
        Effect.tap((id) =>
          Effect.sync(() => {
            if (id !== null && !this.#closed)
              this.registry.update(
                this.workbench.choices,
                chooseAnnotation(id),
              );
          }),
        ),
      );
    }).pipe(Effect.asVoid);
  }
  #subscribe(): void {
    this.#unsubscribe = this.#controller.subscribe(
      ({ docChanged, transaction }) => {
        if (!docChanged) return;
        // What the scheduler follows on its own, named here so a diagnosis can
        // read the edit that queued or dropped a render.
        this.#log(
          Effect.logTrace("Preview source changed").pipe(
            Effect.annotateLogs({
              live: this.registry.get(this.workbench.preview).live,
            }),
          ),
        );
        const selection = this.#view.presentation.selection;
        if (selection) {
          const { slice, range } = selection;
          this.setPresentation({
            selection: {
              slice,
              range: {
                from: transaction.changes.mapPos(range.from, 1),
                to: transaction.changes.mapPos(range.to, 1),
                ...(range.anchor === undefined
                  ? {}
                  : {
                      anchor: transaction.changes.mapPos(range.anchor, 1),
                      head: transaction.changes.mapPos(
                        range.head ?? range.to,
                        1,
                      ),
                    }),
                // An edit moves the caret the reader put; it is still theirs.
                ...(range.placed ? { placed: range.placed } : {}),
              },
            },
          });
        }
        this.#sourceRevision++;
        this.data = this.#controller.source;
        if (this.file && !this.#receivingSource)
          this.app.workspace.trigger("quick-preview", this.file, this.data);
        if (transaction.annotation(externalEdit) !== true) {
          if (!this.#defaultDraft) this.requestSave();
        }
      },
    );
  }
  #history(event: KeyboardEvent, redo: boolean): boolean | void {
    const target = event.target as Node | null;
    if (
      target?.instanceOf(HTMLElement) &&
      target.closest("input, textarea, [contenteditable], .cm-editor")
    )
      return;
    if (redo ? this.#controller.redo() : this.#controller.undo()) return false;
  }
  provide(content: ReactNode): ReactNode {
    // The Match tab's selects are Choosers, which hold Obsidian's keyboard.
    return (
      <ViewRegistryProvider registry={this.registry}>
        <AppContext value={this.app}>
          <WorkbenchThemeProvider theme={templateWorkbenchTheme}>
            <WorkbenchHostProvider host={this.#host}>
              <WorkbenchEditorProvider key={this.#loads} editor={this.#editor}>
                {content}
              </WorkbenchEditorProvider>
            </WorkbenchHostProvider>
          </WorkbenchThemeProvider>
        </AppContext>
      </ViewRegistryProvider>
    );
  }
  #mount(): void {
    if (this.#closed) return;
    this.#updateActions();
    this.#root?.render(
      this.provide(
        <EditorContent
          view={this}
          onSelection={(target) => {
            this.setPresentation({ selection: target });
            const root =
              this.#controller.templateRegions.find(
                (region) =>
                  target.range.from >= region.from &&
                  target.range.from <= region.to,
              )?.root ?? this.#defaultRoot;
            this.#update(setRoot(root));
          }}
        />,
      ),
    );
  }
}

function EditorContent({
  view,
  onSelection,
}: {
  view: TemplateWorkbenchView;
  onSelection: (target: WorkbenchInsertTarget) => void;
}) {
  const controller = view.controller;
  const insertRequest = useAtomValue(view.model.insertRequest);
  const origin = useAtomValue(view.model.origin);
  const originatingNote = origin?.file ?? null;
  const updatingNote = useAtomValue(view.model.updating);
  const isDefaultDraft = useAtomValue(view.model.defaultDraft);
  const unavailable = useAtomValue(view.model.unavailable);
  const bindingDefaults = useAtomValue(view.model.bindingDefaults);
  const { list: citationStyles } = useAtomValue(view.model.styles);
  const host = useWorkbenchHost();
  const resultPart = useParts("resultColumn");
  const { workbench } = view;
  const tab = useAtomValue(workbench.tab);
  useAtomValue(workbench.document.revision);
  const { result, trigger, attempt, busy, staleReason } = useAtomValue(
    workbench.scheduler.state,
  );
  const formatProblem = (result?.diagnostics ?? []).find(
    ({ part, engine }) =>
      part === "annotation" || engine?.template === "annotation",
  );
  // A render reads the selected example, so the inline preview waits on a
  // choice rather than on a render while the reader has made none.
  const annotation = useSelectedAnnotation(view);
  const advanced = useAtomValue(workbench.advanced);
  const [sourceVisited, setSourceVisited] = useState(advanced);
  useEffect(() => {
    if (advanced && !sourceVisited) setSourceVisited(true);
  }, [advanced, sourceVisited]);
  const kind = controller.kind;
  const languageCaption =
    controller.plainDocument?.manifest.language === "eta"
      ? m.workbench_name_language_eta()
      : m.workbench_name_language_liquid();
  const { presentation } = useAtomValue(view.model.view);
  const customization = useAtomValue(view.model.customization);
  const { selected, reveal, fieldFocus } = presentation;
  const setSelected = (selected: number | null) =>
    view.setPresentation({ selected });
  const setReveal = (reveal: WorkbenchViewState["presentation"]["reveal"]) =>
    view.setPresentation({ reveal });
  const previewStatus = useAtomValue(view.model.read).status;
  useEffect(
    () => view.restoreScroll(),
    [view, presentation.restoreVersion, previewStatus, reveal],
  );
  useEffect(() => {
    if (!insertRequest) return;
    const position = entryPosition(insertRequest.slice);
    view.setPresentation({
      ...(position === null ? {} : { selected: position }),
      reveal: insertRequest.range,
    });
  }, [view, insertRequest]);
  // The last manifest that parsed, so a repair keeps the form's values.
  const manifest = useAtomValue(view.workbench.document.manifest);
  // A missing partial is the engine's own render failure, so the boxes read
  // the names the last render could not resolve rather than a scan.
  const missingPartials = (result?.diagnostics ?? []).flatMap((diagnostic) =>
    diagnostic.code === "missing-partial" &&
    diagnostic.params?.name !== undefined
      ? [String(diagnostic.params.name)]
      : [],
  );
  const partialsFor = (
    partialContext: PartialContext,
  ): PartialPlaceholderHost | undefined => {
    const previews = view.partialPreviews;
    if (!previews) return undefined;
    return {
      missing: missingPartials,
      preview: (name) => previews(JSON.stringify([name, partialContext])),
      onEdit: (name) => view.openPartial(name),
      onShowProblem: (name) => {
        const found = diagnoses.find(
          (diagnosis) =>
            diagnosis.kind === "render" &&
            diagnosis.diagnostic.code === "missing-partial" &&
            String(diagnosis.diagnostic.params?.name) === name,
        );
        if (found) problems.select(found.id);
        else problems.setOpen(true);
      },
    };
  };
  const sourceBoxes = usePartialBoxes(
    controller,
    "source",
    kind === "profile"
      ? undefined
      : partialsFor(
          kind === "citation" ? "citation" : controller.partialContext,
        ),
  );
  // A manifest the parser never read has no field pane to open, so its
  // problems are repaired in the source the reader can still see.
  const documentProblems = controller.problems.map((entry) =>
    entry.slice === "details" && manifest === null
      ? { ...entry, slice: "advanced" as const }
      : entry,
  );
  const [arrival, setArrival] = useState<ArrivingProblem | null>(null);
  const arrivalAttempt = useRef(0);
  const pendingArrival = view.arrival;
  const arrivalDiagnostic = arrival?.diagnostic;
  const diagnoses = workbenchDiagnoses(documentProblems, [
    ...(result?.diagnostics ?? []),
    ...(arrivalDiagnostic === undefined ? [] : [arrivalDiagnostic]),
  ]);
  const problems = useWorkbenchProblems({
    diagnoses,
    trigger,
    attempt,
    // A parser problem never reached a render, so the area captures its report
    // itself, naming this Workbench the way a failed render's report does.
    capture: {
      messages: workbenchM,
      source: controller.source,
      context: () =>
        view.reportContext(view.registry.get(view.model.view).root),
    },
  });
  const selectProblem = problems.select;
  const openProblems = problems.setOpen;
  useEffect(
    () => view.subscribeOpenProblems(() => openProblems(true)),
    [view, openProblems],
  );
  // A refused note operation brings its own captured diagnosis here. Consume
  // the arrival once, then keep its report available even when this editor's
  // own check finds no matching failure.
  useEffect(() => {
    if (!pendingArrival) return;
    arrivalAttempt.current = attempt;
    setArrival(pendingArrival);
    view.takeArrival();
    openProblems(true);
  }, [view, pendingArrival, openProblems, attempt]);
  const arrivalSelection = useRef<ArrivingProblem | null>(null);
  const detected = diagnoses.map(({ id }) => id).join("\n");
  useEffect(() => {
    if (!arrival || arrivalSelection.current === arrival) return;
    const match = diagnoses.find(
      (diagnosis) =>
        diagnosis.kind === "render" &&
        diagnosis.diagnostic.code === arrival.diagnostic.code &&
        String(diagnosis.diagnostic.params?.name ?? "") ===
          String(arrival.diagnostic.params?.name ?? ""),
    );
    if (!match) return;
    arrivalSelection.current = arrival;
    selectProblem(match.id);
  }, [arrival, detected, diagnoses, selectProblem]);
  useEffect(() => {
    if (
      !arrival ||
      attempt <= arrivalAttempt.current ||
      busy ||
      staleReason !== null ||
      !result ||
      documentProblems.length > 0
    )
      return;
    const { report, part } = arrival.diagnostic;
    const annotationCheck =
      kind === "profile" &&
      (part === "annotation" || report?.context.root === "annotation");
    const output = annotationCheck
      ? result.annotation
      : kind === "profile"
        ? result.creationBody
        : kind === "citation"
          ? result.citation
          : result.partial;
    if (output === null) return;
    if (
      result.diagnostics.some((diagnostic) =>
        annotationCheck
          ? diagnostic.part === "annotation"
          : diagnostic.part !== "annotation",
      )
    )
      return;
    const context = view.reportContext(
      kind === "profile"
        ? "note"
        : kind === "citation"
          ? "citation"
          : view.partialContext,
    );
    if (
      (report?.context.document !== undefined &&
        report.context.document !== context.document) ||
      (report?.context.selection !== undefined &&
        report.context.selection !== context.selection) ||
      (report?.context.root !== undefined &&
        report.context.root !== context.root &&
        !(
          report.context.root === "annotation" && result.annotation !== null
        )) ||
      (report?.context.selection === undefined &&
        report?.identity.snapshotRevision &&
        report.identity.snapshotRevision !== result.snapshotRevision) ||
      (report?.identity.annotationId !== undefined &&
        report.identity.annotationId !== result.annotationId) ||
      (annotationCheck && result.annotation === null)
    )
      return;
    // The Problems area already holds the inspected report. A fresh applicable
    // success clears its active failure while that report remains available.
    setArrival(null);
  }, [
    arrival,
    attempt,
    busy,
    staleReason,
    result,
    documentProblems.length,
    view,
    kind,
  ]);
  const state = view.change;
  // The repair commands both hosts share. The leaf supplies only the Obsidian
  // notice its host adapter shows.
  const repair = repairCommands({
    registry: view.registry,
    model: { view: view.model.view, fieldsPicker: workbench.fieldsPicker },
    controller,
    host,
    problems,
  });
  const revealHandler = useRef(repair.goToProblem);
  revealHandler.current = repair.goToProblem;
  useEffect(
    () => view.subscribeReveals((target) => revealHandler.current(target)),
    [view],
  );
  const selection =
    (slice: WorkbenchInsertTarget["slice"]) => (range: WorkbenchSliceRange) =>
      onSelection({ slice, range });
  const content = (
    // The pane the source and the Problems area share. It measures itself, so
    // whether a reading fits beside the source is the pane's own question
    // rather than the window's.
    <div className="zt:@container-[size]/workbench-editor zt:flex zt:h-full zt:min-w-0 zt:flex-col zt:text-sm">
      {/* A Citation Template renders an example set, not the note of an Item,
          so its selection is the preview pane's own. */}
      {kind === "profile" && <EditorHeader view={view} />}
      {originatingNote && (
        <div
          data-part="originating-note"
          className={originatingNoteNotice.root}
        >
          <div className={originatingNoteNotice.guidance}>
            <p className={originatingNoteNotice.scope}>
              {(tab === "annotation"
                ? m.template_workbench_shared_annotation
                : m.template_workbench_shared_template)({
                name: view.profileLabel ?? m.settings_profile_default_name(),
              })}
            </p>
            <p className={originatingNoteNotice.behavior}>
              {m.template_workbench_auto_save_scope()}
            </p>
          </div>
          <div className={originatingNoteNotice.action}>
            <span className={originatingNoteNotice.note}>
              <Icon name="file-text" aria-hidden="true" />
              <span className={originatingNoteNotice["note-name"]}>
                {originatingNote.basename}
              </span>
            </span>
            <button
              className={originatingNoteNotice.button}
              disabled={updatingNote}
              onClick={() =>
                // The update reports its own outcome, failures included.
                view.startNoteUpdate()
              }
            >
              <span className={originatingNoteNotice.labels}>
                <span
                  className={
                    updatingNote
                      ? originatingNoteNotice["label-hidden"]
                      : undefined
                  }
                  aria-hidden={updatingNote}
                >
                  {m.template_workbench_update_this_note()}
                </span>
                <span
                  className={
                    !updatingNote
                      ? originatingNoteNotice["label-hidden"]
                      : undefined
                  }
                  aria-hidden={!updatingNote}
                >
                  {m.notice_updating_note()}
                </span>
              </span>
            </button>
          </div>
        </div>
      )}
      {isDefaultDraft && (
        <p
          role="status"
          className="zt:px-3 zt:pb-2 zt:text-xs zt:leading-normal zt:text-muted-foreground"
        >
          {m.template_workbench_default_inspect()}
          <button
            className={templateWorkbenchButton}
            disabled={customization === "pending"}
            onClick={() => view.startCustomize()}
          >
            {customization === "pending"
              ? m.template_workbench_default_creating()
              : customization === "failed"
                ? m.settings_citation_engine_retry()
                : m.template_workbench_customize()}
          </button>
          {customization === "failed" && (
            <span role="alert">
              {m.notice_profile_document_customize_failed()}
            </span>
          )}
        </p>
      )}
      {unavailable.map((message) => (
        <p
          key={message}
          role="status"
          className="zt:px-3 zt:pb-2 zt:text-xs zt:leading-normal zt:text-muted-foreground"
        >
          {message}
        </p>
      ))}
      {!advanced && (
        <TabBar
          tabs={tabsFor(kind)}
          defaultProfile={view.isDefaultProfile ? true : undefined}
          onTabChange={(tab) => {
            // The Partial tab keeps the caller the reader chose; every other
            // tab names one root of its own.
            if (tab !== "partial")
              state.setRoot(
                tab === "annotation"
                  ? "annotation"
                  : tab === "name"
                    ? "filename"
                    : tab === "citation"
                      ? "citation"
                      : "note",
              );
            setReveal(null);
            if (tab === "name") view.startStylesRefresh();
          }}
        />
      )}
      <div
        data-workbench-scroll="editor"
        className="zt:min-h-0 zt:flex-1 zt:overflow-auto"
      >
        {kind !== "profile" ? (
          <TabPanel tab={kind}>
            <p className={selectionHint}>{languageCaption}</p>
            <SliceEditor
              controller={controller}
              slice="source"
              label={
                kind === "citation"
                  ? m.workbench_tab_citation()
                  : m.workbench_tab_partial()
              }
              extensions={sourceBoxes.extensions}
              reveal={reveal}
              onSelection={selection("source")}
            />
            {sourceBoxes.boxes}
          </TabPanel>
        ) : (
          <>
            {(advanced || sourceVisited) && (
              <div data-workbench-mode="source" hidden={!advanced}>
                <SliceEditor
                  controller={controller}
                  slice="advanced"
                  label={m.workbench_advanced()}
                  reveal={advanced ? reveal : null}
                  onSelection={selection("advanced")}
                />
              </div>
            )}
            <TabPanel tab="note" modeActive={!advanced}>
              <NotePane
                controller={controller}
                preview={result?.annotation ?? null}
                previewHint={
                  annotation ? null : m.workbench_preview_choose_annotation()
                }
                formatProblem={
                  formatProblem
                    ? diagnosticText(workbenchM, formatProblem)
                    : null
                }
                annotationSelector={
                  view.nativeRenderDeps ? (
                    <AnnotationSelection view={view} />
                  ) : null
                }
                onOpenAnnotation={repair.openAnnotationBox}
                partials={partialsFor("note")}
                reveal={advanced ? null : reveal}
                onSelection={(range) => {
                  selection("note")(range);
                }}
              />
              {controller.noteRegions.annotationCalls.length === 0 && (
                <AnnotationPointer
                  disabled={controller.readOnly}
                  onInsert={repair.insertAnnotationLoop}
                />
              )}
            </TabPanel>
            <TabPanel tab="properties" modeActive={!advanced}>
              {controller.managedEntries === null ? (
                <p>
                  {m.template_workbench_properties_advanced()}{" "}
                  <button
                    className={templateWorkbenchButton}
                    onClick={() => state.setAdvanced(true)}
                  >
                    {m.workbench_advanced()}
                  </button>
                </p>
              ) : (
                <PropertiesPane
                  onChooseItem={() => view.startItemChoice()}
                  onRetry={() => view.refresh()}
                  onShowProblem={(id) => problems.select(id)}
                  controller={controller}
                  entries={controller.managedEntries}
                  properties={result?.properties ?? []}
                  fold={result?.fold ?? []}
                  diagnostics={entryDiagnostics(
                    workbenchM,
                    result?.diagnostics ?? [],
                    controller.problems,
                  )}
                  selected={selected}
                  onSelect={setSelected}
                  onOpenSource={(range) => {
                    state.setAdvanced(true);
                    setReveal(range);
                  }}
                  reveal={advanced ? null : reveal}
                  onSelection={selection(
                    selected === null ? "advanced" : `entry:${selected}`,
                  )}
                />
              )}
            </TabPanel>
            <TabPanel tab="match" modeActive={!advanced}>
              <NativeMatchPane
                onChooseItem={() => view.startItemChoice()}
                controller={controller}
              />
            </TabPanel>
            <TabPanel tab="annotation" modeActive={!advanced}>
              {formatProblem && (
                <button
                  type="button"
                  {...resultPart("problem-open")}
                  className={templateWorkbenchButton}
                  onClick={() =>
                    problems.select(renderDiagnosis(formatProblem).id)
                  }
                >
                  {m.workbench_problem_show()}
                </button>
              )}
              <AnnotationPane
                finishHelp={
                  originatingNote
                    ? m.workbench_annotation_help_finish_note()
                    : m.workbench_annotation_help_finish_native()
                }
                controller={controller}
                problem={
                  formatProblem
                    ? diagnosticText(workbenchM, formatProblem)
                    : null
                }
                partials={partialsFor("annotation")}
                reveal={advanced ? null : reveal}
                onSelection={selection("annotation")}
              />
            </TabPanel>
            <TabPanel tab="name" modeActive={!advanced}>
              <NameFolderPane
                onChooseItem={() => view.startItemChoice()}
                onRetry={() => view.refresh()}
                controller={controller}
                manifest={manifest}
                defaults={bindingDefaults}
                citationStyles={citationStyles}
                focus={fieldFocus}
                filename={result?.filename ?? null}
                notePath={result?.notePath ?? null}
                onOpenSource={() => state.setAdvanced(true)}
                onShowProblem={(id) => problems.select(id)}
                reveal={advanced ? null : reveal}
                onSelection={selection("filename")}
              />
            </TabPanel>
            <TabPanel tab="profile" modeActive={!advanced}>
              <NameFolderPane
                section="profile"
                controller={controller}
                manifest={manifest}
                focus={fieldFocus}
                filename={null}
                notePath={null}
                onOpenSource={() => state.setAdvanced(true)}
              />
            </TabPanel>
          </>
        )}
      </div>
      <ProblemsFooter
        problems={problems}
        onOpen={repair.openDiagnosis}
        onReturn={repair.returnToTemplate}
      />
    </div>
  );
  return (
    <WorkbenchDiagnosticsProvider
      value={problems.diagnoses}
      onReveal={selectProblem}
    >
      <SidePanels
        panels={{
          fields: {
            label: m.workbench_view_fields(),
            resizeLabel: m.workbench_fields_resize(),
            content: <FieldsPanel view={view} actions={view.fieldsActions} />,
            picker: <FieldsPicker view={view} />,
          },
          preview: {
            label: m.workbench_view_preview(),
            resizeLabel: m.workbench_preview_resize(),
            content: (
              <PreviewPanel view={view} showProblem={repair.showProblem} />
            ),
          },
        }}
      >
        {content}
      </SidePanels>
    </WorkbenchDiagnosticsProvider>
  );
}

/** The annotation examples of the chosen Item, and the one the render reads. */
function AnnotationSelection({ view }: { view: TemplateWorkbenchView }) {
  const { current, example } = useAtomValue(view.workbench.examples);
  return (
    <AnnotationSampleBar
      compact
      current={current}
      example={example}
      onSelect={(id) =>
        view.registry.update(view.workbench.choices, chooseAnnotation(id))
      }
    />
  );
}

/**
 * The example the render reads, live as the reader chooses another. The pane
 * title carries the file, so the header names the selected data itself.
 */
function useSelectedAnnotation(view: TemplateWorkbenchView) {
  return useAtomValue(view.workbench.examples).example;
}

function EditorHeader({ view }: { view: TemplateWorkbenchView }) {
  const root = useAtomValue(view.workbench.root);
  const item = useAtomValue(view.workbench.item);
  const title = useAtomValue(view.model.title);
  const annotation = useSelectedAnnotation(view);
  const name = selectionName({
    item: item && { id: item.id, title },
    annotation,
    annotationMode: root === "annotation",
  });
  const { row, caption, trigger } = selectionBar({ placement: "header" });
  return (
    <div className={row()}>
      {name && <p className={caption()}>{name}</p>}
      <button
        className={trigger()}
        onClick={() =>
          root === "annotation"
            ? view.startAnnotationChoice()
            : view.startItemChoice()
        }
      >
        <Icon name="search" />
        <span>
          {root === "annotation"
            ? m.workbench_choose_annotation()
            : m.workbench_choose_item()}
        </span>
      </button>
    </div>
  );
}
