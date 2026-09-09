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
import { useEffect, useRef } from "react";
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
import {
  externalEdit,
  WorkbenchDocumentController,
  entryPosition,
} from "@zotlit/workbench/document";
import type {
  WorkbenchProblem,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";
import type { DisplayNode } from "@zotlit/workbench/explorer";
import { failedRender, renderIdentity } from "@zotlit/workbench/render";
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
  StartHere,
  TabBar,
  TabPanel,
  TABS,
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
} from "@zotlit/workbench/ui";

import { confirm } from "@/lib/confirm";
import * as m from "@/lib/i18n/generated/messages";
import { itemSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import { tooltipAttrs } from "@/lib/utils";
import { pickItem } from "@/services/item-lookup/search-modal";
import { listInstalledStyles } from "@/services/pandoc/styles";
import type { ProfileService } from "@/services/profile/service";
import { PreviewAnnotationSelection } from "@/views/note-preview/annotation-selection";
import { NativeMarkdown } from "@/views/note-preview/markdown";
import { openProfileWorkbench } from "@/views/note-preview/register";
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

import { runProfileEditorAction } from "./actions";
import { createProfileEditorHost } from "./host";
import { createMatchData } from "./match-data";
import { NativeMatchPane } from "./match-pane";
import { currentProfileSource } from "./source";
import { profileEditorTheme } from "./theme";

export const PROFILE_EDITOR_VIEW_TYPE = "zotlit-profile-editor";
const logger = getLogger(["views", "profile-editor"]);
export type ProfileEditorDeps = Omit<ExplorerViewDeps, "pluginVersion"> & {
  render?: WorkbenchHost["render"];
  openSettings?: (defaultProfile: boolean) => void;
  nativePreview?: NativeRenderDeps;
  pluginVersion?: string;
  profile?: Pick<
    ProfileService,
    | "getSource"
    | "getBuiltInSource"
    | "materializeDefault"
    | "restoreDefault"
    | "defaultDocumentPath"
  >;
};

export interface ProfileAuthoringContext {
  readonly leaf: WorkspaceLeaf;
  readonly path: string | null;
  readonly item: WorkbenchItemChoice | null;
  readonly root: TemplateRoot;
  readonly tab: WorkbenchViewState["tab"];
  readonly advanced: boolean;
  readonly annotationId: string | null;
  readonly canInsertField?: boolean;
}

export class ProfileEditorView extends TextFileView implements HoverParent {
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
  get openSettings() {
    return this.#deps.openSettings;
  }
  get matchDatabase() {
    return this.#deps.db;
  }
  readonly #deps: ProfileEditorDeps;
  readonly #host: ReturnType<typeof createProfileEditorHost>;
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
  #defaultDraft = false;
  #materializing: Promise<void> | null = null;
  #bindingDraft = false;
  #receivingSource = false;
  #sourceRevision = 0;
  #readGeneration = 0;
  #initialRead: number | null = null;
  #pendingSource: string | null = null;
  #clearing = false;

  constructor(leaf: WorkspaceLeaf, deps: ProfileEditorDeps) {
    super(leaf);
    this.#deps = deps;
    this.contentEl.addClass("zt-root", "zt-profile-editor");
    const render: WorkbenchHost["render"] =
      (deps.nativePreview
        ? (request) => renderNativeProfile(deps.nativePreview!, request)
        : deps.render) ??
      ((request) =>
        Promise.resolve(
          failedRender(renderIdentity(request), { code: "render-error" }),
        ));
    this.#host = createProfileEditorHost(
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
    this.preview = deps.nativePreview
      ? new NativePreviewSession(deps.nativePreview, this.scheduler, {
          item: this.store.getState().item,
        })
      : null;
    this.register(
      this.store.subscribe((state, previous) => {
        if (state.item !== previous.item) this.preview?.setItem(state.item);
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
          if (state.example !== previous.example)
            this.#publishAuthoringContext();
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
  get authoringContext(): ProfileAuthoringContext {
    const { item, root, tab, advanced } = this.store.getState();
    return {
      leaf: this.leaf,
      path: this.file?.path ?? null,
      item,
      root,
      tab,
      advanced,
      annotationId: this.preview?.state.getState().example?.id ?? null,
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
        ? [m.profile_editor_database_unavailable()]
        : []),
      ...(this.#stylesUnavailable
        ? [m.profile_editor_styles_unavailable()]
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
    const engine =
      this.#controller.document?.manifest.language === "eta" ? "eta" : "liquid";
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
            : "note",
    );
    state.setRoot(
      this.#controller.templateRegions.find(
        (region) =>
          target.range.from >= region.from && target.range.to <= region.to,
      )?.root ?? "note",
    );
    this.app.workspace.setActiveLeaf(this.leaf, { focus: false });
    this.#mount();
  }

  override getViewType(): string {
    return PROFILE_EDITOR_VIEW_TYPE;
  }
  override getDisplayText(): string {
    return this.file?.basename ?? m.profile_editor_name();
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
      advanced,
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
      zotlitProfileEditor: {
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
    const payload = value.zotlitProfileEditor;
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
    if (typeof value.advanced === "boolean") store.setAdvanced(value.advanced);

    const itemGeneration = ++this.#itemGeneration;
    if (typeof value.itemIndexedKey === "string") {
      store.setItem({ id: value.itemIndexedKey, title: null });
      if (!(await this.#databaseReady())) return;
      if (!this.#closed && itemGeneration === this.#itemGeneration)
        this.#selectKey(value.itemIndexedKey);
    } else if (value.itemIndexedKey === null) store.setItem(null);
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
    const redo = this.addAction("redo-2", m.workbench_redo(), () => {
      this.#controller.redo();
    });
    const undo = this.addAction("undo-2", m.workbench_undo(), () => {
      this.#controller.undo();
    });
    this.#updateActions = () => {
      for (const [action, enabled] of [
        [undo, this.#controller.canUndo],
        [redo, this.#controller.canRedo],
      ] as const) {
        action.setAttribute("aria-disabled", String(!enabled));
        action.classList.toggle("is-disabled", !enabled);
      }
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
    if (!item) return null;
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
        .setTitle(m.profile_editor_open_markdown())
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
  async restoreDefault(): Promise<void> {
    await runProfileEditorAction("restore-default", async () => {
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
        type: PROFILE_EDITOR_VIEW_TYPE,
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
          type: PROFILE_EDITOR_VIEW_TYPE,
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
      await openProfileWorkbench(this.app, this);
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
      logger.warn("Failed to read Profile Editor citation styles", { error });
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
    this.#choosePending = pickItem(
      {
        app: this.app,
        lookup: this.#deps.itemLookup,
        settings: this.#deps.settings,
      },
      m.template_data_explorer_pick_placeholder(),
    )
      .then((hit) => {
        if (
          hit &&
          !this.#closed &&
          generation === this.#generation &&
          itemGeneration === this.#itemGeneration
        ) {
          this.#selectKey(hit.item.indexedKey);
          return this.store.getState().item?.id === hit.item.indexedKey;
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
  #selectKey(indexedKey: string): void {
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
      logger.warn("Failed to restore Profile Editor Item {indexedKey}", {
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
      <WorkbenchThemeProvider theme={profileEditorTheme}>
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
              )?.root ?? "note";
            if (this.store.getState().root !== root)
              this.store.getState().setRoot(root);
          }}
        />,
      ),
    );
  }
}

function EditorContent({
  view,
  insertRequest,
  onSelection,
}: {
  view: ProfileEditorView;
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
  const advanced = useWorkbenchStore((state) => state.advanced);
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
  const firstProblem = controller.problems[0] ?? null;
  const problem =
    firstProblem?.slice === "details" && manifest.current === null
      ? { ...firstProblem, slice: "advanced" as const }
      : firstProblem;
  const state = view.store.getState();
  function openProblem(
    problem: Pick<WorkbenchProblem, "slice" | "range" | "params">,
  ) {
    const entry = entryPosition(problem.slice);
    state.setAdvanced(problem.slice === "advanced");
    state.setTab(
      entry !== null
        ? "properties"
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
      <EditorHeader view={view} />
      {view.isDefaultDraft && (
        <p
          role="status"
          className="zt:px-3 zt:pb-2 zt:text-xs zt:leading-normal zt:text-muted-foreground"
        >
          {m.profile_editor_default_inspect()}
          <button
            disabled={customization === "pending"}
            onClick={() => void view.customizeDefault()}
          >
            {customization === "pending"
              ? m.profile_editor_default_creating()
              : customization === "failed"
                ? m.settings_citation_engine_retry()
                : m.profile_editor_customize()}
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
          defaultProfile={view.isDefaultProfile ? true : undefined}
          onTabChange={(tab) => {
            state.setRoot(
              tab === "annotation"
                ? "annotation"
                : tab === "name"
                  ? "filename"
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
        <StartHere />
        {advanced ? (
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
                  {m.profile_editor_properties_advanced()}{" "}
                  <button onClick={() => state.setAdvanced(true)}>
                    {m.workbench_advanced()}
                  </button>
                </p>
              ) : (
                <PropertiesPane
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
                reveal={reveal}
                onSelection={selection("annotation")}
              />
            </TabPanel>
            <TabPanel tab="name">
              <NameFolderPane
                onOpenSettings={
                  view.openSettings
                    ? () =>
                        view.openSettings?.(
                          view.isDefaultProfile ||
                            manifest.current?.id === "default",
                        )
                    : undefined
                }
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
          </>
        )}
      </div>
      <ProblemsFooter problem={problem} onOpen={openProblem} />
    </div>
  );
}

function EditorHeader({ view }: { view: ProfileEditorView }) {
  const item = useWorkbenchStore((state) => state.item);
  return (
    <div className="zt:flex zt:min-w-0 zt:shrink-0 zt:flex-wrap zt:items-center zt:gap-2 zt:px-3 zt:py-2">
      <button
        className="zt-profile-editor-item zt:max-w-full zt:min-w-0 zt:truncate"
        {...tooltipAttrs(item?.title ?? m.profile_editor_choose_paper())}
        onClick={() => void view.chooseItem()}
      >
        <span className="zt:min-w-0 zt:truncate">
          {item?.title ?? m.profile_editor_choose_paper()}
        </span>
      </button>
      <button
        className="zt:ms-auto"
        onClick={() =>
          void runProfileEditorAction("open-workbench", () =>
            openProfileWorkbench(view.app, view),
          )
        }
      >
        {m.profile_editor_open_workbench()}
      </button>
    </div>
  );
}
