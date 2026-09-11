// One file-backed authoring session; TextFileView owns vault updates and saves.
import { EditorView } from "@codemirror/view";
import { Scope, TextFileView } from "obsidian";
import type {
  Menu,
  TFile,
  HoverParent,
  HoverPopover,
  ViewStateResult,
  WorkspaceLeaf,
} from "obsidian";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import {
  getItemsByKey,
  getLibraries,
  isChildItemFields,
  parseIndexedKey,
  USER_LIBRARY_ID,
} from "@zotlit/db";
import type { CitationVariant } from "@zotlit/db";
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
  DEFAULT_PARTIAL_CONTEXT,
  failedRender,
  isPartialContext,
  renderIdentity,
} from "@zotlit/workbench/render";
import type {
  CitationExampleId,
  PartialChoice,
  PartialContext,
} from "@zotlit/workbench/render";
import { fieldSnippet } from "@zotlit/workbench/ui";
import {
  AnnotationPane,
  diagnosticText,
  AnnotationPointer,
  useWorkbenchHost,
  createWorkbenchEditor,
  BUILT_IN_BINDING_DEFAULTS,
  NameFolderPane,
  NotePane,
  PropertiesPane,
  ProblemsFooter,
  problemText,
  SliceEditor,
  usePartialBoxes,
  TabBar,
  TabPanel,
  TABS,
  tabsFor,
  WorkbenchEditorProvider,
  WorkbenchHostProvider,
  WorkbenchThemeProvider,
  useDocumentRevision,
  useRenderState,
  useWorkbenchStore,
} from "@zotlit/workbench/ui";
import type {
  RenderScheduler,
  WorkbenchEditorInstance,
  WorkbenchHost,
  WorkbenchInsertTarget,
  WorkbenchStore,
  WorkbenchItemChoice,
  WorkbenchViewState,
  TemplateRoot,
  NameFolderPaneProps,
  PartialPlaceholderHost,
} from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import { confirm } from "@/lib/confirm";
import * as m from "@/lib/i18n/generated/messages";
import { itemSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { listInstalledStyles } from "@/services/pandoc/styles";
import type { ProfileService } from "@/services/profile/service";
import { openCitationTemplate } from "@/services/template/actions";
import type { TemplateService } from "@/services/template/service";
import { PreviewAnnotationSelection } from "@/views/note-preview/annotation-selection";
import { NativeMarkdown } from "@/views/note-preview/markdown";
import { openWorkbenchLayout } from "@/views/note-preview/register";
import type {
  NativeRenderDeps,
  NativeRenderResult,
} from "@/views/note-preview/render";
import { nativeResult, renderNativeProfile } from "@/views/note-preview/render";
import { NativePreviewSession } from "@/views/note-preview/session";
import { exportTemplateDataFile } from "@/views/template-data-explorer/export-file";
import type { TemplateDataExportTarget } from "@/views/template-data-explorer/export-file";
import { rememberTemplateItem } from "@/views/template-data-explorer/item-memory";
import type { ExplorerViewDeps } from "@/views/template-data-explorer/view";

import { runTemplateWorkbenchAction } from "./actions";
import {
  templateDocumentKind,
  templateFolderOf,
  templatePartialName,
} from "./document-kind";
import { partialCall } from "./extract-partial";
import { createTemplateWorkbenchHost } from "./host";
import { createMatchData } from "./match-data";
import { NativeMatchPane } from "./match-pane";
import { createSharedPartial } from "./new-partial";
import { readPartialChoice, writePartialChoice } from "./partial-choice-memory";
import { openTemplateWorkbench } from "./register";
import {
  chooseWorkbenchItem,
  chooseWorkbenchAnnotation,
  publishWorkbenchSelection,
  selectionName,
  subscribeWorkbenchSelection,
} from "./selection";
import { getSampleItem } from "./selection-data";
import { currentProfileSource } from "./source";
import {
  templateWorkbenchButton,
  templateWorkbenchTheme,
  selectionBar,
  selectionHint,
} from "./theme";

export const TEMPLATE_WORKBENCH_VIEW_TYPE = "zotlit-template-workbench";
const logger = getLogger(["views", "template-workbench"]);
export type TemplateWorkbenchDeps = Omit<ExplorerViewDeps, "pluginVersion"> & {
  render?: WorkbenchHost["render"];
  nativePreview?: NativeRenderDeps;
  pluginVersion?: string;
  templates: ExplorerViewDeps["templates"] &
    Pick<
      TemplateService,
      | "loaded"
      | "on"
      | "materializeCitationTemplate"
      | "getPartialDocument"
      | "getPartialDocuments"
      | "getPartialNames"
      | "createPartial"
      | "planPartialUnpack"
      | "unpackPartials"
    >;
  profile?: Pick<
    ProfileService,
    | "getSource"
    | "getBuiltInSource"
    | "materializeDefault"
    | "restoreDefault"
    | "defaultDocumentPath"
  >;
};

export interface TemplateAuthoringContext {
  readonly leaf: WorkspaceLeaf;
  readonly path: string | null;
  /** The Template Document kind, which picks the preview's own root data. */
  readonly kind: WorkbenchDocumentKind;
  readonly item: WorkbenchItemChoice | null;
  readonly root: TemplateRoot;
  readonly tab: WorkbenchViewState["tab"];
  readonly advanced: boolean;
  readonly annotationId: string | null;
  /**
   * The Citation set and Variant a Citation Template renders under, so every
   * pane that follows this editor reads the one selection. Null on a document
   * of another kind, which has no Citation set to name.
   */
  readonly citation: {
    readonly variant: CitationVariant;
    readonly example: CitationExampleId | null;
  } | null;
  /**
   * The Shared Partial this editor holds, the caller the reader chose to
   * preview it as called from, and the Profile whose bindings that caller's
   * data is built with. Null on a document of another kind.
   */
  readonly partial: {
    readonly name: string;
    readonly context: PartialContext;
    readonly profile: string | null;
  } | null;
  readonly canInsertField?: boolean;
}

export class TemplateWorkbenchView extends TextFileView implements HoverParent {
  /** The editor hover popover now open, which the next one replaces. */
  hoverPopover: HoverPopover | null = null;
  readonly store: WorkbenchStore;
  readonly #editor: WorkbenchEditorInstance<NativeRenderResult>;
  /** Renders compact examples independently of companion views. */
  readonly scheduler: RenderScheduler<NativeRenderResult>;
  readonly preview: NativePreviewSession | null;
  readonly #revealListeners = new Set<
    (target: Pick<WorkbenchProblem, "slice" | "range" | "params">) => void
  >();
  get matchDatabase() {
    return this.#deps.db;
  }
  readonly #deps: TemplateWorkbenchDeps;
  readonly #host: ReturnType<typeof createTemplateWorkbenchHost>;
  #controller = new WorkbenchDocumentController("", { runtime: "native" });
  #root: Root | null = null;
  #updateActions = () => {};
  #unsubscribe: (() => void) | null = null;
  get #insertTarget(): WorkbenchInsertTarget | null {
    return this.store.getState().presentation.selection;
  }
  set #insertTarget(selection: WorkbenchInsertTarget | null) {
    this.setPresentation({ selection });
  }
  #insertRequest: WorkbenchInsertTarget | null = null;
  #choosePending: Promise<boolean> | null = null;
  #itemGeneration = 0;
  #closed = false;
  #generation = 0;
  #bindingDefaults = BUILT_IN_BINDING_DEFAULTS;
  #databaseUnavailable = false;
  #stylesUnavailable = false;
  #citationStyles: NameFolderPaneProps["citationStyles"] = [];
  /** The Profile a Shared Partial preview reads bindings from; null is the default one. */
  #partialProfile: string | null = null;
  /** The partial `#partialProfile` and this leaf's root were chosen for. */
  #partialChoiceFile: string | null = null;
  #defaultDraft = false;
  #materializing: Promise<void> | null = null;
  #bindingDraft = false;
  #receivingSource = false;
  #sourceRevision = 0;
  #readGeneration = 0;
  #initialRead: number | null = null;
  #pendingSource: string | null = null;
  #clearing = false;

  constructor(leaf: WorkspaceLeaf, deps: TemplateWorkbenchDeps) {
    super(leaf);
    this.#deps = deps;
    this.contentEl.addClass("zt-root", "zt-template-workbench");
    const render: WorkbenchHost["render"] =
      (deps.nativePreview
        ? (request) => renderNativeProfile(deps.nativePreview!, request)
        : deps.render) ??
      ((request) =>
        Promise.resolve(
          failedRender(renderIdentity(request), { code: "render-error" }),
        ));
    this.#host = createTemplateWorkbenchHost(
      this.app,
      {
        render,
        markdown: (props) => (
          <NativeMarkdown
            {...props}
            app={this.app}
            result={this.scheduler.getState().result}
          />
        ),
        matchData: createMatchData(deps.db),
        insertTarget: () => this.insertTarget,
        partials: {
          names: () =>
            deps.templates.loaded ? deps.templates.getPartialNames() : [],
          create: (query) => this.createPartial(query),
        },
        extractPartial: (source) => this.extractPartial(source),
        hoverParent: this,
      },
      (content) => this.provide(content),
    );
    this.#editor = createWorkbenchEditor({
      host: this.#host,
      controller: this.#controller,
      mapResult: nativeResult,
    });
    this.store = this.#editor.store;
    this.scheduler = this.#editor.scheduler;
    this.register(
      subscribeWorkbenchSelection(this, {
        editor: () => this.leaf,
        apply: (selection) => {
          if (selection.kind === "item") this.selectItem(selection.item);
          else if (selection.kind === "annotation")
            this.preview?.select(selection.annotationId);
          else if (selection.kind === "partial")
            this.setPartialSelection(selection);
          else
            this.preview?.setCitation({
              variant: selection.variant,
              citationExample: selection.example,
            });
        },
      }),
    );
    this.preview = deps.nativePreview
      ? new NativePreviewSession(deps.nativePreview, this.scheduler, {
          item: this.store.getState().item,
        })
      : null;
    this.register(
      this.store.subscribe((state, previous) => {
        if (state.item !== previous.item) this.preview?.setItem(state.item);
        // The one editor a Shared Partial opens completes under the caller the
        // reader chose, which is this root.
        if (state.root !== previous.root && this.documentKind === "partial") {
          this.#controller.setPartialContext(this.partialContext);
          this.#rememberPartialChoice();
        }
        if (
          state.item !== previous.item ||
          state.root !== previous.root ||
          state.tab !== previous.tab ||
          state.advanced !== previous.advanced
        )
          this.#publishAuthoringContext();
      }),
    );
    if (this.preview)
      this.register(
        this.preview.state.subscribe((state, previous) => {
          if (
            state.example !== previous.example ||
            state.annotationId !== previous.annotationId ||
            state.variant !== previous.variant ||
            state.citationExample !== previous.citationExample
          )
            this.#publishAuthoringContext();
          if (state.annotationId !== previous.annotationId)
            this.app.workspace.requestSaveLayout();
          if (state.status !== previous.status) this.#mount();
        }),
      );
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
    this.register(
      deps.settings.subscribe((settings) => {
        if (!settings) return;
        const bindings = settings["note.default-profile"].bindings;
        this.#bindingDefaults = {
          folder: bindings["note.literature-folder"],
          citationStyle: bindings["citation.references-style"],
          importFolder: bindings["note.import-folder"],
          importColoredHighlights: bindings["note.import-colored-highlights"],
          importAnnotationsAsTemplate:
            bindings["note.import-annotations-as-template"],
        };
        this.scheduler.invalidate();
        this.#mount();
      }),
    );
    this.register(
      this.store.subscribe((state, previous) => {
        if (
          state.tab !== previous.tab ||
          state.root !== previous.root ||
          state.advanced !== previous.advanced ||
          state.item?.id !== previous.item?.id
        )
          this.app.workspace.requestSaveLayout();
      }),
    );
  }

  get nativeRenderDeps(): NativeRenderDeps | undefined {
    return this.#deps.nativePreview;
  }
  /** The Template Document this view holds, which picks its tabs and its root. */
  get documentKind(): WorkbenchDocumentKind {
    return templateDocumentKind(this.file, this.#templateFolder);
  }
  /** The folder a filename has to sit in to name a Template Document. */
  get #templateFolder(): string {
    return templateFolderOf(this.#deps.settings);
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
    const { root } = this.store.getState();
    return isPartialContext(root) ? root : DEFAULT_PARTIAL_CONTEXT;
  }
  /** {@link TemplateWorkbenchView.#partialProfile} */
  get partialProfile(): string | null {
    return this.#partialProfile;
  }
  /** Applies the caller and Profile another pane chose for this partial. */
  setPartialSelection(selection: PartialChoice): void {
    if (this.documentKind !== "partial") return;
    this.#partialProfile = selection.profile;
    this.store.getState().setRoot(selection.context);
    this.app.workspace.requestSaveLayout();
    this.#rememberPartialChoice();
    this.#publishAuthoringContext();
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
      profile: this.#partialProfile,
    });
  }
  get authoringContext(): TemplateAuthoringContext {
    const { item, root, tab, advanced } = this.store.getState();
    const partialName = templatePartialName(
      this.file?.path ?? "",
      this.#templateFolder,
    );
    return {
      leaf: this.leaf,
      path: this.file?.path ?? null,
      kind: this.documentKind,
      item,
      root,
      tab,
      advanced,
      annotationId:
        this.preview?.state.getState().annotationId ??
        this.preview?.state.getState().example?.id ??
        null,
      // A partial previewed as called from a Citation reads the same set the
      // Citation Template does, so both name it here for every pane to follow.
      citation:
        root === "citation" && this.preview
          ? {
              variant: this.preview.state.getState().variant,
              example: this.preview.state.getState().citationExample,
            }
          : null,
      partial:
        this.documentKind === "partial" && partialName !== null
          ? {
              name: partialName,
              context: this.partialContext,
              profile: this.#partialProfile,
            }
          : null,
      canInsertField:
        !this.#closed &&
        !this.#controller.readOnly &&
        this.insertTarget !== null,
    };
  }
  #publishAuthoringContext(): void {
    this.app.workspace.trigger(
      "zotlit:authoring-context",
      this.authoringContext,
    );
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
  get unavailableDependencies(): string[] {
    return [
      ...(this.#databaseUnavailable
        ? [m.template_workbench_database_unavailable()]
        : []),
      ...(this.#stylesUnavailable
        ? [m.template_workbench_styles_unavailable()]
        : []),
    ];
  }
  async #databaseReady(): Promise<boolean> {
    try {
      await this.#deps.db.ready;
      return true;
    } catch {
      this.#databaseUnavailable = true;
      this.#mount();
      return false;
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
  revealSlice(slice: "advanced" | "annotation" | `entry:${number}`): void {
    const range = this.#controller.sliceRange(slice);
    for (const listener of this.#revealListeners)
      listener({ slice, ...(range ? { range } : {}) });
    void this.app.workspace.revealLeaf(this.leaf);
  }
  get bindingDefaults(): typeof BUILT_IN_BINDING_DEFAULTS {
    return this.#bindingDefaults;
  }
  get citationStyles(): NameFolderPaneProps["citationStyles"] {
    return this.#citationStyles;
  }
  get controller(): WorkbenchDocumentController {
    return this.#controller;
  }
  /** The last focused slice remains the insertion target while a sidebar has focus. */
  get insertTarget(): WorkbenchInsertTarget | null {
    return this.#insertTarget &&
      this.#controller.hasSlice(this.#insertTarget.slice)
      ? this.#insertTarget
      : null;
  }

  insertTemplateField(request: {
    leaf: WorkspaceLeaf;
    node: DisplayNode;
  }): boolean {
    if (request.leaf !== this.leaf || this.#closed || this.#controller.readOnly)
      return false;
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
    return this.insertField(fieldSnippet(request.node, mode, { engine }));
  }

  insertField(snippet: string): boolean {
    if (this.#controller.readOnly || this.#closed) return false;
    const target = this.insertTarget;
    if (!target) {
      logger.trace("Rejected Explorer insertion", {
        slice: this.#insertTarget?.slice ?? null,
        reason: this.#insertTarget ? "removed-slice" : "no-selection",
      });
      return false;
    }
    const range = this.#controller.sliceRange(target.slice);
    const from = Math.min(Math.max(target.range.from, range.from), range.to);
    const to = Math.min(Math.max(target.range.to, from), range.to);
    this.#controller.dispatch({
      changes: { from, to, insert: snippet },
      userEvent: "input.complete",
    });
    logger.debug("Applied Explorer insertion", { slice: target.slice });
    const cursor = from + snippet.length;
    this.#focusTarget({
      slice: target.slice,
      range: { from: cursor, to: cursor },
    });
    return true;
  }

  #focusTarget(target: WorkbenchInsertTarget): void {
    this.#insertRequest = target;
    this.#insertTarget = target;
    this.#publishAuthoringContext();
    const state = this.store.getState();
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
    this.#mount();
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
        currentProfileSource(this.app, this.file, this) ??
        source;
      this.#pendingSource = null;
    }
    if (clear) {
      this.#host[Symbol.dispose]();
      this.#unsubscribe?.();
      this.#generation++;
      this.#sourceRevision++;
      this.#controller = new WorkbenchDocumentController(source, {
        runtime: "native",
        readOnly: this.#defaultDraft,
        kind: this.documentKind,
        context: this.partialContext,
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
      this.#insertRequest = null;
      this.#applyKindDefaults();
      this.#publishAuthoringContext();
      this.#subscribe();
      this.#mount();
    } else this.#controller.applyExternalSource(source);
    this.data = this.#controller.source;
    if (clear && this.file && !this.#clearing) {
      if (this.data !== this.lastSavedData) this.dirty = true;
      this.app.workspace.trigger("quick-preview", this.file, this.data);
    }
    this.#publishAuthoringContext();
  }
  override async loadFileInternal(file: TFile, clear: boolean): Promise<void> {
    const generation = ++this.#readGeneration;
    let reset = clear;
    if (clear) this.#initialRead = generation;
    const stale = Symbol("stale Profile source read");
    try {
      while (!this.#closed && file === this.file) {
        const revision = this.#sourceRevision;
        const baseline = this.lastSavedData;
        // TextFileView writes its baseline immediately after the awaited read,
        // before its native three-way merge. Cancel there, before any mutation;
        // native methods still run on this view so private fields keep their owner.
        const receiver = new Proxy(this, {
          get(target, property) {
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
          set: (target, property, value) => {
            if (
              property === "lastSavedData" &&
              (this.#closed ||
                file !== this.file ||
                generation !== this.#readGeneration ||
                revision !== this.#sourceRevision ||
                baseline !== this.lastSavedData)
            )
              throw stale;
            return Reflect.set(target, property, value, target);
          },
        });
        try {
          await super.loadFileInternal.call(receiver, file, reset);
          return;
        } catch (error) {
          if (error !== stale) throw error;
          logger.trace("Discarded stale Profile source read", {
            path: file.path,
            closed: this.#closed,
            fileChanged: file !== this.file,
            readChanged: generation !== this.#readGeneration,
            sourceChanged: revision !== this.#sourceRevision,
            baselineChanged: baseline !== this.lastSavedData,
          });
          if (generation !== this.#readGeneration) return;
          if (revision !== this.#sourceRevision) reset = false;
        }
      }
    } finally {
      if (this.#initialRead === generation) {
        this.#initialRead = null;
        this.#pendingSource = null;
      }
    }
  }
  override clear(): void {
    if (this.#defaultDraft || this.#bindingDraft) return;
    this.#readGeneration++;
    this.#clearing = true;
    try {
      this.setViewData("", true);
    } finally {
      this.#clearing = false;
    }
  }

  override getState(): Record<string, unknown> {
    const { tab, item, advanced } = this.store.getState();
    return {
      ...super.getState(),
      ...(this.#defaultDraft ? { defaultDraft: true, file: null } : {}),
      tab,
      itemIndexedKey: item?.id ?? null,
      annotationId: this.preview?.state.getState().annotationId ?? null,
      advanced,
      // A Shared Partial's caller is a choice nothing else can name, so the
      // workspace carries it back with the file it belongs to. No other kind
      // has one to carry.
      ...(this.documentKind === "partial"
        ? {
            partialContext: this.partialContext,
            partialProfile: this.#partialProfile,
          }
        : {}),
    };
  }
  setPresentation(value: Partial<WorkbenchViewState["presentation"]>): void {
    this.store.setState((state) => ({
      presentation: { ...state.presentation, ...value },
    }));
  }
  #presentationContext(): string {
    return JSON.stringify([
      this.file?.path ?? (this.#defaultDraft ? "default" : null),
      this.store.getState().item?.id ?? null,
    ]);
  }
  override getEphemeralState(): Record<string, unknown> {
    const { presentation } = this.store.getState();
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
    if (!input || typeof input !== "object") return;
    const value = input as Record<string, unknown>;
    const payload = value.zotlitTemplateWorkbench;
    if (!payload || typeof payload !== "object") return;
    const state = payload as Record<string, unknown>;
    if (state.context !== this.#presentationContext()) return;
    const selection = state.selection as WorkbenchInsertTarget | null;
    const valid =
      selection &&
      typeof selection.slice === "string" &&
      this.controller.hasSlice(selection.slice) &&
      selection.range &&
      Number.isFinite(selection.range.from) &&
      Number.isFinite(selection.range.to);
    let restoredSelection: WorkbenchInsertTarget | null = null;
    if (valid) {
      const slice = this.controller.sliceRange(selection.slice);
      const clamp = (position: number) =>
        Math.max(slice.from, Math.min(slice.to, position));
      const anchor = clamp(
        Number.isFinite(selection.range.anchor)
          ? selection.range.anchor!
          : selection.range.from,
      );
      const head = clamp(
        Number.isFinite(selection.range.head)
          ? selection.range.head!
          : selection.range.to,
      );
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
      Number.isInteger(state.selected) &&
      (state.selected as number) >= 0 &&
      (state.selected as number) < (this.controller.managedEntries?.length ?? 0)
        ? (state.selected as number)
        : null;
    const scroll: WorkbenchViewState["presentation"]["scroll"] = {};
    if (state.scroll && typeof state.scroll === "object") {
      for (const [key, position] of Object.entries(state.scroll)) {
        if (
          position &&
          typeof position === "object" &&
          Number.isFinite(position.top) &&
          Number.isFinite(position.left)
        )
          scroll[key] = {
            top: Math.max(0, position.top),
            left: Math.max(0, position.left),
          };
      }
    }
    this.setPresentation({
      selection: restoredSelection,
      selected,
      reveal: restoredSelection
        ? {
            ...restoredSelection.range,
            slice: restoredSelection.slice,
            focus: value.focus === true,
            scrollIntoView: false,
          }
        : null,
      fieldFocus:
        typeof state.field === "string"
          ? {
              field: state.field,
              focus: value.focus === true,
              scrollIntoView: false,
            }
          : null,
      scroll,
      restoreVersion: this.store.getState().presentation.restoreVersion + 1,
      restoring: true,
    });
  }
  restoreScroll(): void {
    const { scroll, restoring } = this.store.getState().presentation;
    if (
      !restoring ||
      this.preview?.state.getState().status === "loading" ||
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
  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    const previous = JSON.stringify(this.getState());
    try {
      await this.#restoreState(state, result);
    } finally {
      if (previous !== JSON.stringify(this.getState())) result.history = true;
    }
  }
  async #restoreState(state: unknown, result: ViewStateResult): Promise<void> {
    const builtin =
      !!state &&
      typeof state === "object" &&
      "defaultDraft" in state &&
      state.defaultDraft === true;
    if (builtin && this.#deps.profile) {
      this.allowNoFile = true;
      await super.setState({ ...state, file: null }, result);
      this.#defaultDraft = true;
      this.setViewData(this.#deps.profile.getBuiltInSource(), true);
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
      await super.setState(state, result);
    }
    if (!state || typeof state !== "object") return;
    const value = state as Record<string, unknown>;
    const store = this.store.getState();
    if (this.#applyKindDefaults()) {
      // A plain document has one tab and one editor, so nothing of the saved
      // tab or Basic and Source choice applies to it. A Shared Partial's root
      // is the reader's own "as called from" choice, which the workspace
      // carries with the Profile it was chosen beside. A descriptor that names
      // the file alone — every open through `openTemplateWorkbench` — keeps
      // what `#applyKindDefaults` read back from this device instead. The
      // Profile is set first, so the root subscription remembers the pair.
      if (
        this.documentKind === "partial" &&
        isPartialContext(value.partialContext)
      ) {
        this.#partialProfile =
          typeof value.partialProfile === "string"
            ? value.partialProfile
            : null;
        store.setRoot(value.partialContext);
      }
    } else {
      if (TABS.some((tab) => tab === value.tab))
        store.setTab(
          value.tab === "match" && this.isDefaultProfile
            ? "note"
            : (value.tab as typeof store.tab),
        );
      if (
        value.root === "note" ||
        value.root === "annotation" ||
        value.root === "filename"
      )
        store.setRoot(value.root);
      else
        store.setRoot(
          value.tab === "annotation"
            ? "annotation"
            : value.tab === "name"
              ? "filename"
              : "note",
        );
      if (typeof value.advanced === "boolean")
        store.setAdvanced(value.advanced);
    }

    const itemGeneration = ++this.#itemGeneration;
    if (typeof value.itemIndexedKey === "string") {
      store.setItem({ id: value.itemIndexedKey, title: null });
      if (
        !getSampleItem(value.itemIndexedKey) &&
        !(await this.#databaseReady())
      )
        return;
      if (!this.#closed && itemGeneration === this.#itemGeneration)
        this.#selectKey(value.itemIndexedKey);
    } else if (value.itemIndexedKey === null) store.setItem(null);
    if (typeof value.annotationId === "string" || value.annotationId === null)
      this.preview?.select(value.annotationId);
  }

  /**
   * The tab, root, and edit mode the kind fixes. A plain document is one
   * editor over one source under one root, so it has no such choice to make or
   * to restore. A Profile document keeps the reader's own choice, less a tab
   * and root the leaf held for a document of another kind.
   * @returns whether the kind fixed them.
   */
  #applyKindDefaults(): boolean {
    const store = this.store.getState();
    const kind = this.documentKind;
    if (kind === "profile") {
      // A tab and root this leaf kept from a document of another kind name no
      // panel and no data here, which would leave every panel unmounted.
      if (!TABS.includes(store.tab)) {
        store.setTab("note");
        store.setRoot("note");
      }
      return false;
    }
    store.setTab(kind);
    store.setAdvanced(false);
    if (kind === "citation") {
      store.setRoot("citation");
      return true;
    }
    // The caller and the Profile belong to the partial they were chosen for, so
    // a leaf that moves to another partial — or that kept a root from a document
    // of another kind — opens on the default caller rather than on that choice.
    const path = this.file?.path ?? null;
    if (path !== this.#partialChoiceFile) {
      this.#partialChoiceFile = path;
      const held = readPartialChoice(this.app, path);
      this.#partialProfile = held.profile;
      store.setRoot(held.context);
    } else if (!isPartialContext(store.root))
      store.setRoot(DEFAULT_PARTIAL_CONTEXT);
    return true;
  }

  protected override async onOpen(): Promise<void> {
    this.#closed = false;
    this.registerDomEvent(
      this.contentEl,
      "scroll",
      (event) => {
        const element = event.target as HTMLElement;
        const key = element.dataset?.workbenchScroll;
        if (!key || this.store.getState().presentation.restoring) return;
        this.setPresentation({
          scroll: {
            ...this.store.getState().presentation.scroll,
            [key]: { top: element.scrollTop, left: element.scrollLeft },
          },
        });
      },
      true,
    );
    this.registerEvent(
      this.app.workspace.on("zotlit:insert-template-field", (request) =>
        this.insertTemplateField(request),
      ),
    );
    const source = this.addAction("code", m.workbench_advanced(), () => {
      const state = this.store.getState();
      state.setAdvanced(!state.advanced);
    });
    const choose = this.addAction("search", m.workbench_choose_item(), () => {
      if (this.store.getState().root === "annotation")
        void this.chooseAnnotation();
      else void this.chooseItem();
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
        this.store.getState().root === "annotation"
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
      const advanced = this.store.getState().advanced;
      source.setAttribute("aria-pressed", String(advanced));
      source.classList.toggle("is-active", advanced);
    };
    this.register(this.store.subscribe(() => this.#updateActions()));
    this.#updateActions();
    this.#root = createRoot(this.contentEl);
    this.#mount();
    void this.refreshStyles();
    void this.#databaseReady();
  }
  protected override async onClose(): Promise<void> {
    this.#closed = true;
    try {
      await super.onClose();
    } finally {
      this.preview?.[Symbol.dispose]();
      this.#editor[Symbol.dispose]();
      this.#host[Symbol.dispose]();
      this.#root?.unmount();
      this.#root = null;
      this.#unsubscribe?.();
      this.#unsubscribe = null;
    }
  }
  templateDataTarget(): TemplateDataExportTarget | null {
    const { item, root } = this.store.getState();
    if (!item || getSampleItem(item.id)) return null;
    if (root !== "annotation") return { indexedKey: item.id, root };
    const preview = this.preview?.state.getState();
    const example = preview?.example;
    const indexedKey = example?.root.indexedKey;
    if (
      typeof indexedKey === "string" &&
      preview?.current.some((current) => current.id === example?.id)
    )
      return { indexedKey, root };
    return { indexedKey: item.id, root: "note" };
  }

  templateDataExportLabel(): string {
    return this.store.getState().root === "annotation" &&
      this.templateDataTarget()?.root === "note"
      ? m.template_data_explorer_export_selected_paper()
      : m.template_data_explorer_menu_export_json();
  }

  override onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    menu.addItem((item) =>
      item
        .setSection("zotlit")
        .setTitle(m.template_workbench_open_layout())
        .setIcon("panels-top-left")
        .onClick(
          () =>
            void runTemplateWorkbenchAction("open-workbench", () =>
              openWorkbenchLayout(this.app, this),
            ),
        ),
    );
    menu.addItem((item) =>
      item
        .setSection("zotlit")
        .setTitle(m.workbench_choose_item())
        .setIcon("search")
        .onClick(() => void this.chooseItem()),
    );
    if (this.documentKind !== "citation")
      menu.addItem((item) =>
        item
          .setSection("zotlit")
          .setTitle(m.workbench_choose_annotation())
          .setIcon("highlighter")
          .onClick(() => void this.chooseAnnotation()),
      );
    this.#addPartialsMenu(menu);
    menu.addItem((item) =>
      item
        .setSection("zotlit")
        .setTitle(m.template_workbench_open_citation())
        .setIcon("quote")
        .onClick(
          () =>
            void runTemplateWorkbenchAction("open-citation", () =>
              openCitationTemplate(this.app, this.#deps.templates),
            ),
        ),
    );
    if (this.documentKind !== "profile") this.#addLanguageMenu(menu);
    const target = this.templateDataTarget();
    const pluginVersion = this.#deps.pluginVersion;
    if (target && pluginVersion)
      menu.addItem((item) =>
        item
          .setTitle(this.templateDataExportLabel())
          .setIcon("file-json")
          .onClick(
            () =>
              void exportTemplateDataFile(this.#deps, {
                ...target,
                pluginVersion,
              }),
          ),
      );
    menu.addItem((item) =>
      item
        .setTitle(m.template_workbench_open_markdown())
        .setIcon("file-text")
        .setDisabled(!this.file)
        .onClick(() => void this.openMarkdown()),
    );
    if (this.file?.path === this.#deps.profile?.defaultDocumentPath)
      menu.addItem((item) =>
        item
          .setTitle(m.settings_profile_document_restore())
          .setIcon("rotate-ccw")
          .onClick(() => void this.restoreDefault()),
      );
  }
  /**
   * Every Shared Partial the vault holds, so the reader moves between
   * documents without leaving the view, and the create flow that ends the list.
   */
  #addPartialsMenu(menu: Menu): void {
    const templates = this.#deps.templates;
    if (!templates.loaded) return;
    menu.addItem((item) => {
      item.setSection("zotlit").setTitle(m.template_workbench_partials());
      const submenu = item.setSubmenu();
      for (const partial of templates.getPartialDocuments())
        submenu.addItem((entry) =>
          entry
            .setTitle(partial.name)
            .setChecked(this.file?.path === partial.path)
            .onClick(
              () =>
                void runTemplateWorkbenchAction("open-partial", () =>
                  this.#openPartial(partial.path),
                ),
            ),
        );
      submenu.addSeparator();
      submenu.addItem((entry) =>
        entry
          .setTitle(m.workbench_partial_new())
          .setIcon("plus")
          .onClick(() => void this.createPartial()),
      );
    });
  }

  async #openPartial(path: string): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (file)
      await openTemplateWorkbench(this.app, file, {
        explainUnsupported: false,
      });
  }

  /**
   * The shared create flow, seeded with `query` — what the reader had typed
   * into the render call the completion is finishing.
   *
   * @returns the created name, or `null` when the reader dismisses the prompt.
   */
  createPartial(query = ""): Promise<string | null> {
    return createSharedPartial(this.app, this.#deps.templates, { name: query });
  }

  /**
   * Move an editor selection into a new Shared Partial through the same create
   * flow, under this document's own language: an Eta document gets a manifest
   * naming it, and a Liquid one is a plain source file.
   *
   * @returns the call that replaces the selection, or `null` when the reader
   *   dismisses the prompt.
   */
  async extractPartial(source: string): Promise<string | null> {
    const language = this.#documentLanguage;
    const name = await createSharedPartial(this.app, this.#deps.templates, {
      source,
      ...(language === "eta" ? { language } : {}),
      open: "split",
    });
    return name === null ? null : partialCall(name, language);
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
      item.setTitle(m.template_workbench_change_language()).setIcon("code-2");
      const submenu = item.setSubmenu();
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
        this.file && this.file.path === this.#deps.profile?.defaultDocumentPath,
      )
    );
  }
  get isDefaultDraft(): boolean {
    return this.#defaultDraft;
  }
  /**
   * Every Shared Partial the vault registers, which Pick another chooses from.
   * Read during render, so it answers empty until the folder scan has run.
   */
  get partialNames(): readonly string[] {
    const templates = this.#deps.templates;
    return templates.loaded ? templates.getPartialNames() : [];
  }
  /**
   * Subscribes to the installed templates recompiling, which a saved or
   * deleted Shared Partial triggers. A surface showing a registered partial's
   * text reads it again from here, the way the preview pane does.
   */
  onTemplatesCompiled(listener: () => void): () => void {
    return this.#deps.templates.on("compile-status-changed", listener);
  }
  /**
   * Open the Shared Partial `name` in a Template Workbench View of its own.
   * Edit partial reaches a document the vault already holds; a call to a name
   * with no document offers Create instead.
   */
  openPartial(name: string): void {
    const templates = this.#deps.templates;
    if (!templates.loaded) {
      logger.debug("Edit partial before the folder scan settled", { name });
      return;
    }
    const document = templates.getPartialDocument(name);
    if (!document) {
      logger.debug("Edit partial for a name the vault holds no document for", {
        name,
      });
      return;
    }
    void runTemplateWorkbenchAction("open-partial", () =>
      this.#openPartial(document.path),
    );
  }
  /**
   * Write every partial this document still carries in its manifest into the
   * Shared Partial file it belongs in, then drop the entries those names came
   * from, so each partial is edited in one place from here on.
   *
   * A name the vault already holds a document for keeps that document, and its
   * entry goes with the rest: the reader's own file answers the call. The
   * keep-or-replace ask belongs to import, which is where the bundle's copy
   * still has somewhere to go.
   */
  unpackBundledPartials(): Promise<boolean> {
    return runTemplateWorkbenchAction("unpack-partials", async () => {
      const templates = this.#deps.templates;
      const bundled = this.#controller.document?.manifest.partials ?? [];
      if (!templates.loaded || this.#controller.readOnly || !bundled.length)
        return;
      const plan = templates.planPartialUnpack(bundled);
      const { written, kept, dropped, refused } =
        await templates.unpackPartials(plan);
      this.#controller.dropBundledPartials(dropped);
      if (written.length > 0)
        new BaseNotice(
          m.notice_partials_unpacked({ names: written.join(", ") }),
        );
      if (kept.length > 0)
        new BaseNotice(m.notice_partials_kept({ names: kept.join(", ") }));
      // The manifest entry stays, so without this the action reads as inert:
      // the bundled-partial problem is still there the next time it is read.
      if (refused.length > 0)
        new BaseNotice(
          m.notice_partials_refused({ names: refused.join(", ") }),
        );
    });
  }
  async restoreDefault(): Promise<void> {
    await runTemplateWorkbenchAction("restore-default", async () => {
      const profile = this.#deps.profile;
      if (
        !profile ||
        !(await confirm(
          {
            title: m.settings_profile_document_restore_title(),
            content: m.settings_profile_document_restore_desc({
              path: profile.defaultDocumentPath,
            }),
            action: m.settings_profile_document_restore_action(),
            destructive: true,
          },
          this.app,
        ))
      )
        return;
      await this.save();
      this.allowNoFile = true;
      this.#defaultDraft = true;
      await this.leaf.setViewState({
        type: TEMPLATE_WORKBENCH_VIEW_TYPE,
        state: { file: null, defaultDraft: true },
        active: true,
      });
      await profile.restoreDefault();
      this.setViewData(await profile.getSource("default"), true);
    });
  }

  /** Customize binds the existing document before enabling any edits. */
  customizeDefault(): Promise<void> {
    if (this.#materializing) return this.#materializing;
    const profile = this.#deps.profile;
    if (!profile || !this.#defaultDraft) return Promise.resolve();
    const controller = this.#controller;
    this.store.setState({ customization: "pending" });
    logger.debug("Opening Default Profile for customization at {path}", {
      path: profile.defaultDocumentPath,
    });
    this.#materializing = (async () => {
      const { file } = await profile.materializeDefault();
      if (
        this.#closed ||
        !this.#defaultDraft ||
        this.#controller !== controller
      )
        return;
      this.#bindingDraft = true;
      try {
        await this.leaf.setViewState({
          type: TEMPLATE_WORKBENCH_VIEW_TYPE,
          state: { ...this.getState(), defaultDraft: false, file: file.path },
          active: true,
        });
        const source = currentProfileSource(this.app, file, this) ?? this.data;
        this.#bindingDraft = false;
        this.#defaultDraft = false;
        controller.setReadOnly(false);
        if (source !== controller.source) this.setViewData(source, true);
        this.allowNoFile = false;
        this.data = this.#controller.source;
      } finally {
        this.#bindingDraft = false;
      }
      this.#mount();
      await openWorkbenchLayout(this.app, this);
    })()
      .catch((error: unknown) => {
        logger.error("Failed to customize Default Profile at {path}", {
          path: profile.defaultDocumentPath,
          error,
        });
        this.store.setState({ customization: "failed" });
      })
      .finally(() => {
        this.#materializing = null;
        if (this.store.getState().customization === "pending")
          this.store.setState({ customization: "idle" });
      });
    return this.#materializing;
  }
  async refreshStyles(): Promise<void> {
    try {
      await this.#deps.zoteroPref.ready;
      if (this.#closed) return;
      const dataDir = this.#deps.zoteroPref.dataDir;
      const styles = dataDir ? await listInstalledStyles(dataDir) : [];
      if (this.#closed) return;
      this.#citationStyles = styles;
      this.#stylesUnavailable = false;
      this.#mount();
    } catch (error) {
      logger.warn("Failed to read Template Workbench citation styles", {
        error,
      });
      this.#stylesUnavailable = true;
      this.#mount();
    }
  }
  async openMarkdown(): Promise<void> {
    if (!this.file) return;
    await this.save();
    await this.leaf.setViewState({
      type: "markdown",
      state: { file: this.file.path },
      active: true,
    });
  }
  chooseItem(): Promise<boolean> {
    if (this.#choosePending) return this.#choosePending;
    const generation = this.#generation;
    const itemGeneration = ++this.#itemGeneration;
    this.#choosePending = chooseWorkbenchItem(
      this.#host,
      {
        app: this.app,
        lookup: this.#deps.itemLookup,
        settings: this.#deps.settings,
      },
      this.store.getState().item ?? undefined,
    )
      .then((choice) => {
        if (
          choice &&
          !this.#closed &&
          generation === this.#generation &&
          itemGeneration === this.#itemGeneration
        ) {
          this.selectItem(choice);
          publishWorkbenchSelection(
            this,
            { kind: "item", item: choice },
            this.leaf,
          );
          return this.store.getState().item?.id === choice.id;
        }
        return false;
      })
      .finally(() => {
        this.#choosePending = null;
      });
    return this.#choosePending;
  }
  /** Resolve an explicit action that requires an Item. */
  async ensureItem(): Promise<boolean> {
    if (this.store.getState().item) return true;
    await this.chooseItem();
    return this.store.getState().item !== null;
  }
  selectItem(item: WorkbenchItemChoice): void {
    if (this.#closed) return;
    this.#itemGeneration++;
    this.#selectKey(item.id);
    // An Item the reader picked is the Citation set they asked to see, so the
    // built-in example that outranks it stands down.
    if (this.store.getState().root === "citation")
      this.preview?.setCitation({ citationExample: null });
  }
  async chooseAnnotation(): Promise<void> {
    const preview = this.preview;
    if (!preview) return;
    const generation = this.#generation;
    const state = preview.state.getState();
    const id = await chooseWorkbenchAnnotation(
      this.#host,
      state.current,
      state.example?.id ?? null,
    );
    if (
      id !== null &&
      !this.#closed &&
      generation === this.#generation &&
      preview === this.preview
    ) {
      preview.select(id);
      publishWorkbenchSelection(
        this,
        { kind: "annotation", annotationId: id },
        this.leaf,
      );
    }
  }
  #selectKey(indexedKey: string): void {
    const sample = getSampleItem(indexedKey);
    if (sample) {
      this.store
        .getState()
        .setItem({ id: indexedKey, title: sample.item.title ?? null });
      return;
    }
    const parsed = parseIndexedKey(indexedKey);
    if (!parsed || this.#deps.db.state !== "ready") return;
    try {
      const libraryID =
        parsed.groupID === null
          ? USER_LIBRARY_ID
          : getLibraries(this.#deps.db.client)?.find(
              (library) => library.groupID === parsed.groupID,
            )?.libraryID;
      if (libraryID === undefined) return;
      const item = getItemsByKey(this.#deps.db.client, libraryID, [
        parsed.key,
      ])[0];
      if (!item || isChildItemFields(item.fields)) return;
      this.store.getState().setItem({
        id: indexedKey,
        title: itemSummary(item, item.fields).formatted,
      });
      rememberTemplateItem(this.app, indexedKey);
    } catch (error) {
      logger.warn("Failed to restore Template Workbench Item {indexedKey}", {
        indexedKey,
        error,
      });
    }
  }
  #subscribe(): void {
    this.#unsubscribe = this.#controller.subscribe(
      ({ docChanged, transaction }) => {
        this.#updateActions();
        if (!docChanged) return;
        // What the scheduler follows on its own, named here so a diagnosis can
        // read the edit that queued or dropped a render.
        logger.trace("Preview source changed", {
          live: this.preview?.state.getState().preview.live ?? true,
        });
        if (this.#insertTarget) {
          const { slice, range } = this.#insertTarget;
          this.#insertTarget = {
            slice,
            range: {
              from: transaction.changes.mapPos(range.from, 1),
              to: transaction.changes.mapPos(range.to, 1),
              ...(range.anchor === undefined
                ? {}
                : {
                    anchor: transaction.changes.mapPos(range.anchor, 1),
                    head: transaction.changes.mapPos(range.head ?? range.to, 1),
                  }),
            },
          };
          this.#publishAuthoringContext();
        }
        this.#sourceRevision++;
        this.data = this.#controller.source;
        if (this.file && !this.#receivingSource)
          this.app.workspace.trigger("quick-preview", this.file, this.data);
        this.#publishAuthoringContext();
        if (transaction.annotation(externalEdit) !== true) {
          if (!this.#defaultDraft) this.requestSave();
        }
      },
    );
  }
  #history(event: KeyboardEvent, redo: boolean): boolean | void {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("input, textarea, [contenteditable], .cm-editor")
    )
      return;
    if (redo ? this.#controller.redo() : this.#controller.undo()) return false;
  }
  provide(content: ReactNode): ReactNode {
    return (
      <WorkbenchThemeProvider theme={templateWorkbenchTheme}>
        <WorkbenchHostProvider host={this.#host}>
          <WorkbenchEditorProvider
            key={this.#generation}
            controller={this.#controller}
            store={this.store}
            scheduler={this.scheduler}
          >
            {content}
          </WorkbenchEditorProvider>
        </WorkbenchHostProvider>
      </WorkbenchThemeProvider>
    );
  }
  #mount(): void {
    this.#updateActions();
    this.#root?.render(
      this.provide(
        <EditorContent
          view={this}
          insertRequest={this.#insertRequest}
          onSelection={(target) => {
            this.#insertTarget = target;
            this.#publishAuthoringContext();
            const root =
              this.#controller.templateRegions.find(
                (region) =>
                  target.range.from >= region.from &&
                  target.range.from <= region.to,
              )?.root ?? this.#defaultRoot;
            if (this.store.getState().root !== root)
              this.store.getState().setRoot(root);
          }}
        />,
      ),
    );
  }
}

/**
 * Ticks whenever the installed templates recompile, which is what a saved or
 * deleted Shared Partial does. An open Partial Placeholder preview reads it,
 * so the box shows the partial as it now stands rather than as it was opened.
 */
function useTemplateRevision(view: TemplateWorkbenchView): number {
  const [revision, setRevision] = useState(0);
  useEffect(
    () => view.onTemplatesCompiled(() => setRevision((count) => count + 1)),
    [view],
  );
  return revision;
}

function EditorContent({
  view,
  insertRequest,
  onSelection,
}: {
  view: TemplateWorkbenchView;
  insertRequest: WorkbenchInsertTarget | null;
  onSelection: (target: WorkbenchInsertTarget) => void;
}) {
  const controller = view.controller;
  const host = useWorkbenchHost();
  useDocumentRevision(controller);
  const { result } = useRenderState();
  const formatProblem = result?.diagnostics.find(
    ({ part }) => part === "annotation",
  );
  // A render reads the selected example, so the inline preview waits on a
  // choice rather than on a render while the reader has made none.
  const annotation = useSelectedAnnotation(view);
  const advanced = useWorkbenchStore((state) => state.advanced);
  const kind = controller.kind;
  const languageCaption =
    controller.plainDocument?.manifest.language === "eta"
      ? m.workbench_name_language_eta()
      : m.workbench_name_language_liquid();
  const customization = useWorkbenchStore((state) => state.customization);
  const presentation = useWorkbenchStore((state) => state.presentation);
  const { selected, reveal, fieldFocus } = presentation;
  const setSelected = (selected: number | null) =>
    view.setPresentation({ selected });
  const setReveal = (reveal: WorkbenchViewState["presentation"]["reveal"]) =>
    view.setPresentation({ reveal });
  const setFieldFocus = (fieldFocus: { field: string } | null) =>
    view.setPresentation({ fieldFocus });
  const previewStatus = view.preview?.state.getState().status;
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
  const manifest = useRef(controller.document?.manifest ?? null);
  if (controller.document) manifest.current = controller.document.manifest;
  const templateRevision = useTemplateRevision(view);
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
    // Bound once: the box renders whatever this session produces, so a later
    // session swap must not be read from inside the render callback.
    const preview = view.preview;
    if (!preview) return undefined;
    return {
      names: view.partialNames,
      missing: missingPartials,
      revision: templateRevision,
      onEdit: (name) => view.openPartial(name),
      onCreate: (name) => void view.createPartial(name),
      onRender: (name) => preview.renderPartial(name, partialContext),
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
  const firstProblem = controller.problems[0] ?? null;
  const problem =
    firstProblem?.slice === "details" && manifest.current === null
      ? { ...firstProblem, slice: "advanced" as const }
      : firstProblem;
  const state = view.store.getState();
  function openProblem(
    problem: Pick<WorkbenchProblem, "slice" | "range" | "params">,
  ) {
    if (problem.slice === "source") {
      // A plain document's every problem is in the one editor it opens with.
      setReveal(problem.range ?? null);
      return;
    }
    const entry = entryPosition(problem.slice);
    state.setAdvanced(problem.slice === "advanced");
    state.setTab(
      entry !== null
        ? "properties"
        : problem.slice === "details" &&
            [
              "name",
              "description",
              "version",
              "author",
              "sampleItemType",
              "language",
            ].includes(problem.params?.field ?? "")
          ? "profile"
          : problem.slice === "filename" || problem.slice === "details"
            ? "name"
            : problem.slice === "annotation"
              ? "annotation"
              : "note",
    );
    state.setRoot(
      problem.slice === "annotation"
        ? "annotation"
        : problem.slice === "filename"
          ? "filename"
          : "note",
    );
    if (entry !== null) setSelected(entry);
    setReveal(problem.range ?? null);
    setFieldFocus(
      problem.slice === "details" && problem.params?.field
        ? { field: problem.params.field }
        : null,
    );
  }
  const revealHandler = useRef(openProblem);
  revealHandler.current = openProblem;
  useEffect(
    () => view.subscribeReveals((target) => revealHandler.current(target)),
    [view],
  );
  const selection =
    (slice: WorkbenchInsertTarget["slice"]) => (range: WorkbenchSliceRange) =>
      onSelection({ slice, range });
  return (
    <div className="zt:flex zt:h-full zt:min-w-0 zt:flex-col zt:text-sm">
      {/* A Citation Template renders an example set, not the note of an Item,
          so its selection is the preview pane's own. */}
      {kind === "profile" && <EditorHeader view={view} />}
      {view.isDefaultDraft && (
        <p
          role="status"
          className="zt:px-3 zt:pb-2 zt:text-xs zt:leading-normal zt:text-muted-foreground"
        >
          {m.template_workbench_default_inspect()}
          <button
            className={templateWorkbenchButton}
            disabled={customization === "pending"}
            onClick={() => void view.customizeDefault()}
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
      {view.unavailableDependencies.map((message) => (
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
            if (tab === "name") void view.refreshStyles();
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
        ) : advanced ? (
          <SliceEditor
            controller={controller}
            slice="advanced"
            label={m.workbench_advanced()}
            reveal={reveal}
            onSelection={selection("advanced")}
          />
        ) : (
          <>
            <TabPanel tab="note">
              <NotePane
                controller={controller}
                preview={result?.annotation ?? null}
                previewHint={
                  annotation ? null : m.workbench_preview_choose_annotation()
                }
                formatProblem={
                  formatProblem ? diagnosticText(m, formatProblem) : null
                }
                annotationSelector={
                  view.preview ? (
                    <PreviewAnnotationSelection session={view.preview} />
                  ) : null
                }
                onOpenAnnotation={() => {
                  state.setTab("annotation");
                  state.setRoot("annotation");
                }}
                partials={partialsFor("note")}
                reveal={reveal}
                onSelection={(range) => {
                  selection("note")(range);
                }}
              />
              {controller.noteRegions.annotationCalls.length === 0 && (
                <AnnotationPointer
                  disabled={controller.readOnly}
                  onInsert={() => {
                    const { repaired, caret } =
                      controller.insertAnnotationLoop();
                    setReveal({ from: caret, to: caret });
                    if (repaired)
                      host.notice(m.workbench_annotation_section_added());
                  }}
                />
              )}
            </TabPanel>
            <TabPanel tab="properties">
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
                  onChooseItem={() => void view.chooseItem()}
                  onRetry={() => view.preview?.refresh()}
                  controller={controller}
                  entries={controller.managedEntries}
                  properties={result?.properties ?? []}
                  fold={result?.fold ?? []}
                  diagnostics={[
                    ...(result?.diagnostics ?? []).flatMap((diagnostic) =>
                      diagnostic.position === undefined
                        ? []
                        : [
                            {
                              position: diagnostic.position,
                              message: diagnosticText(m, diagnostic),
                            },
                          ],
                    ),
                    ...controller.problems.flatMap((problem) => {
                      const position = entryPosition(problem.slice);
                      return position === null
                        ? []
                        : [
                            {
                              position,
                              message: problemText(m, problem).message,
                            },
                          ];
                    }),
                  ]}
                  selected={selected}
                  onSelect={setSelected}
                  onOpenSource={(range) => {
                    state.setAdvanced(true);
                    setReveal(range);
                  }}
                  reveal={reveal}
                  onSelection={selection(
                    selected === null ? "advanced" : `entry:${selected}`,
                  )}
                />
              )}
            </TabPanel>
            <TabPanel tab="match">
              <NativeMatchPane
                onChooseItem={() => void view.chooseItem()}
                controller={controller}
                db={view.matchDatabase}
              />
            </TabPanel>
            <TabPanel tab="annotation">
              <AnnotationPane
                controller={controller}
                problem={
                  formatProblem ? diagnosticText(m, formatProblem) : null
                }
                partials={partialsFor("annotation")}
                reveal={reveal}
                onSelection={selection("annotation")}
              />
            </TabPanel>
            <TabPanel tab="name">
              <NameFolderPane
                onChooseItem={() => void view.chooseItem()}
                onRetry={() => view.preview?.refresh()}
                controller={controller}
                manifest={manifest.current}
                defaults={view.bindingDefaults}
                citationStyles={view.citationStyles}
                focus={fieldFocus}
                filename={result?.filename ?? null}
                onOpenSource={() => state.setAdvanced(true)}
                reveal={reveal}
                onSelection={selection("filename")}
              />
            </TabPanel>
            <TabPanel tab="profile">
              <NameFolderPane
                section="profile"
                controller={controller}
                manifest={manifest.current}
                focus={fieldFocus}
                filename={null}
                onOpenSource={() => state.setAdvanced(true)}
              />
            </TabPanel>
          </>
        )}
      </div>
      <ProblemsFooter
        problem={problem}
        onOpen={openProblem}
        onAction={() => void view.unpackBundledPartials()}
      />
    </div>
  );
}

/**
 * The example the preview session holds, live as the reader chooses another.
 * The pane title carries the file, so the header names the selected data itself.
 */
function useSelectedAnnotation(view: TemplateWorkbenchView) {
  const store = view.preview?.state;
  return useSyncExternalStore(
    useCallback(
      (listener: () => void) => store?.subscribe(listener) ?? (() => {}),
      [store],
    ),
    () => store?.getState().example ?? null,
  );
}

function EditorHeader({ view }: { view: TemplateWorkbenchView }) {
  const root = useWorkbenchStore((state) => state.root);
  const item = useWorkbenchStore((state) => state.item);
  const annotation = useSelectedAnnotation(view);
  const name = selectionName({
    item,
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
            ? void view.chooseAnnotation()
            : void view.chooseItem()
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
