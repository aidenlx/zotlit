// One file-backed authoring session; TextFileView owns vault updates and saves.
import { Menu, Scope, TextFileView } from "obsidian";
import type {
  HoverParent,
  HoverPopover,
  ViewStateResult,
  WorkspaceLeaf,
} from "obsidian";
import { useEffect, useRef, useState } from "react";
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
import { failedRender, renderIdentity } from "@zotlit/workbench/render";
import {
  AnnotationPane,
  diagnosticText,
  AnnotationPointer,
  useWorkbenchHost,
  createWorkbenchStore,
  EditToolbar,
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
  useWorkbenchStore,
} from "@zotlit/workbench/ui";
import type {
  WorkbenchHost,
  WorkbenchInsertTarget,
  NameFolderPaneProps,
} from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import { confirm } from "@/lib/confirm";
import * as m from "@/lib/i18n/generated/messages";
import { itemSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { tooltipAttrs } from "@/lib/utils";
import { pickItem } from "@/services/item-lookup/search-modal";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import { listInstalledStyles } from "@/services/pandoc/styles";
import type { ProfileService } from "@/services/profile/service";
import { PreviewAnnotationSelection } from "@/views/note-preview/annotation-selection";
import { NativeMarkdown } from "@/views/note-preview/markdown";
import type { NativeRenderDeps } from "@/views/note-preview/render";
import { renderNativeProfile } from "@/views/note-preview/render";
import {
  NativePreviewSession,
  useNativePreview,
} from "@/views/note-preview/session";
import { exportTemplateDataFile } from "@/views/template-data-explorer/export-file";
import type { TemplateDataExportTarget } from "@/views/template-data-explorer/export-file";
import {
  lastTemplateItem,
  rememberTemplateItem,
} from "@/views/template-data-explorer/item-memory";
import type { ExplorerViewDeps } from "@/views/template-data-explorer/view";

import { runProfileEditorAction } from "./actions";
import { createProfileEditorHost } from "./host";
import { createMatchData } from "./match-data";
import { NativeMatchPane } from "./match-pane";
import { profileEditorTheme } from "./theme";

export const PROFILE_EDITOR_VIEW_TYPE = "zotlit-profile-editor";
const logger = getLogger(["views", "profile-editor"]);
export type ProfileEditorDeps = Omit<ExplorerViewDeps, "pluginVersion"> & {
  render?: WorkbenchHost["render"];
  nativePreview?: NativeRenderDeps;
  pluginVersion?: string;
  profile?: Pick<
    ProfileService,
    | "getSource"
    | "materializeDefault"
    | "restoreDefault"
    | "defaultDocumentPath"
  >;
};

export class ProfileEditorView extends TextFileView implements HoverParent {
  /** The editor hover popover now open, which the next one replaces. */
  hoverPopover: HoverPopover | null = null;
  readonly store = createWorkbenchStore();
  readonly preview: NativePreviewSession | null;
  readonly #revealListeners = new Set<
    (target: Pick<WorkbenchProblem, "slice" | "range" | "params">) => void
  >();
  get matchDatabase() {
    return this.#deps.db;
  }
  readonly #deps: ProfileEditorDeps;
  readonly #host: ReturnType<typeof createProfileEditorHost>;
  #controller = new WorkbenchDocumentController("", { runtime: "native" });
  #root: Root | null = null;
  #unsubscribe: (() => void) | null = null;
  #insertTarget: WorkbenchInsertTarget | null = null;
  #insertRequest: WorkbenchInsertTarget | null = null;
  readonly #insertListeners = new Set<() => void>();
  #choosePending: Promise<void> | null = null;
  #prompted = false;
  #closed = false;
  #generation = 0;
  #bindingDefaults = BUILT_IN_BINDING_DEFAULTS;
  #databaseUnavailable = false;
  #stylesUnavailable = false;
  #citationStyles: NameFolderPaneProps["citationStyles"] = [];
  #defaultDraft = false;
  #materializing: Promise<void> | null = null;
  #bindingDraft = false;

  constructor(leaf: WorkspaceLeaf, deps: ProfileEditorDeps) {
    super(leaf);
    this.#deps = deps;
    this.contentEl.addClass("zt-root", "zt-profile-editor");
    this.preview = deps.nativePreview
      ? new NativePreviewSession(
          deps.nativePreview,
          this.#controller,
          this.store,
        )
      : null;
    this.#host = createProfileEditorHost(
      this.app,
      {
        render:
          (deps.nativePreview
            ? (request, deliver) => {
                let current = true;
                void renderNativeProfile(deps.nativePreview!, request).then(
                  (result) => {
                    if (current) deliver(result);
                  },
                );
                return {
                  terminate() {
                    current = false;
                  },
                };
              }
            : deps.render) ??
          ((request, deliver) => {
            deliver(
              failedRender(renderIdentity(request), { code: "render-error" }),
            );
            return { terminate() {} };
          }),
        markdown: (props) => (
          <NativeMarkdown
            {...props}
            app={this.app}
            result={this.preview?.state.getState().result ?? null}
          />
        ),
        matchData: createMatchData(deps.db),
        insertTarget: () => this.insertTarget,
        hoverParent: this,
      },
      (content) => this.provide(content),
    );
    this.scope = new Scope(this.app.scope);
    this.scope.register(["Mod"], "z", (event) => this.#history(event, false));
    this.scope.register(["Mod", "Shift"], "z", (event) =>
      this.#history(event, true),
    );
    this.scope.register(["Mod"], "y", (event) => this.#history(event, true));
    this.#subscribe();
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
        this.preview?.changed();
        this.#mount();
      }),
    );
    this.register(
      this.store.subscribe(() => this.app.workspace.requestSaveLayout()),
    );
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
  subscribeInsertion = (listener: () => void): (() => void) => {
    this.#insertListeners.add(listener);
    return () => {
      this.#insertListeners.delete(listener);
    };
  };

  insertField(snippet: string): boolean {
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

  exploreAnnotation(key: string): boolean {
    const preview = this.preview;
    const section = this.#controller.annotationSection;
    const example = preview?.state
      .getState()
      .current.find((example) => example.root.key === key);
    if (!preview || !section || !example) {
      logger.trace("Rejected Explorer annotation navigation", {
        key,
        slice: "annotation",
        reason: !preview
          ? "no-preview"
          : !section
            ? "no-section"
            : "no-example",
      });
      return false;
    }
    logger.debug("Applied Explorer annotation navigation", {
      key,
      slice: "annotation",
    });
    preview.select(example.id);
    this.#focusTarget({
      slice: "annotation",
      range: { from: section.source.from, to: section.source.from },
    });
    return true;
  }

  #focusTarget(target: WorkbenchInsertTarget): void {
    this.#insertRequest = target;
    this.#insertTarget = target;
    for (const listener of this.#insertListeners) listener();
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
  override setViewData(source: string, clear: boolean): void {
    if (this.#bindingDraft) return;
    if (clear) {
      this.#host[Symbol.dispose]();
      this.#unsubscribe?.();
      this.#generation++;
      this.#controller = new WorkbenchDocumentController(source, {
        runtime: "native",
      });
      this.preview?.attach(this.#controller);
      this.#insertTarget = null;
      this.#insertRequest = null;
      for (const listener of this.#insertListeners) listener();
      this.#subscribe();
      this.#mount();
    } else this.#controller.applyExternalSource(source);
    this.data = this.#controller.source;
  }
  override clear(): void {
    if (this.#defaultDraft || this.#bindingDraft) return;
    this.setViewData("", true);
  }

  override getState(): Record<string, unknown> {
    const { tab, item, root, explorer, preview, advanced } =
      this.store.getState();
    return {
      ...super.getState(),
      ...(this.#defaultDraft ? { defaultDraft: true } : {}),
      tab,
      itemIndexedKey: item?.id ?? null,
      root,
      explorer,
      preview,
      advanced,
    };
  }
  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
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
    if (
      state &&
      typeof state === "object" &&
      "defaultDraft" in state &&
      state.defaultDraft === true &&
      !this.#defaultDraft
    ) {
      const profile = this.#deps.profile;
      if (profile) {
        this.allowNoFile = true;
        this.#defaultDraft = true;
        this.setViewData(await profile.getSource("default"), true);
      }
    }
    await super.setState(state, result);
    if (!state || typeof state !== "object") return;
    const value = state as Record<string, unknown>;
    const store = this.store.getState();
    if (TABS.some((tab) => tab === value.tab))
      store.setTab(value.tab as typeof store.tab);
    if (
      value.root === "note" ||
      value.root === "annotation" ||
      value.root === "filename"
    )
      store.setRoot(value.root);
    if (value.explorer === "simple" || value.explorer === "all")
      store.setExplorer(value.explorer);
    if (typeof value.advanced === "boolean") store.setAdvanced(value.advanced);
    if (value.preview && typeof value.preview === "object") {
      const preview = value.preview as Record<string, unknown>;
      if (preview.mode === "create" || preview.mode === "update")
        store.setPreview({ mode: preview.mode });
      if (typeof preview.live === "boolean")
        store.setPreview({ live: preview.live });
    }
    if (typeof value.itemIndexedKey === "string") {
      if (!(await this.#databaseReady())) return;
      if (!this.#closed) this.#selectKey(value.itemIndexedKey);
    }
  }

  protected override async onOpen(): Promise<void> {
    this.#closed = false;
    this.#root = createRoot(this.contentEl);
    this.#mount();
    void this.refreshStyles();
    if (!(await this.#databaseReady())) return;
    if (this.#closed || this.store.getState().item) return;
    const active = this.app.workspace.getActiveFile();
    const key =
      (active &&
        itemKeyFromFrontmatter(this.app.metadataCache.getFileCache(active))) ||
      lastTemplateItem(this.app);
    if (key) this.#selectKey(key);
  }
  protected override async onClose(): Promise<void> {
    this.#closed = true;
    this.preview?.[Symbol.dispose]();
    this.#host[Symbol.dispose]();
    this.#root?.unmount();
    this.#root = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
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

  /** One file creation covers every local edit made while the write is pending. */
  materializeDefault(): Promise<void> {
    if (this.#materializing) {
      logger.trace("Reusing pending Default materialization at {path}", {
        path: this.#deps.profile?.defaultDocumentPath,
      });
      return this.#materializing;
    }
    const profile = this.#deps.profile;
    if (!profile || !this.#defaultDraft) return Promise.resolve();
    const controller = this.#controller;
    logger.debug("Materializing Default Profile at {path}", {
      path: profile.defaultDocumentPath,
    });
    this.#materializing = (async () => {
      const { file, created } = await profile.materializeDefault(
        controller.source,
      );
      if (!created) {
        logger.debug(
          "Retaining draft because Default already exists at {path}",
          { path: file.path },
        );
        new BaseNotice(m.profile_editor_default_conflict());
        return;
      }
      if (
        this.#closed ||
        !this.#defaultDraft ||
        this.#controller !== controller
      ) {
        logger.debug("Saving detached Default draft at {path}", {
          path: file.path,
          closed: this.#closed,
        });
        await this.app.vault.modify(file, controller.source);
        return;
      }
      this.#bindingDraft = true;
      try {
        await this.leaf.setViewState({
          type: PROFILE_EDITOR_VIEW_TYPE,
          state: { ...this.getState(), defaultDraft: false, file: file.path },
          active: true,
        });
        this.#defaultDraft = false;
        this.allowNoFile = false;
        this.data = controller.source;
        logger.debug("Bound Default draft to {path}", { path: file.path });
        this.requestSave();
        this.#mount();
      } finally {
        this.#bindingDraft = false;
      }
    })()
      .catch((error: unknown) => {
        logger.error("Failed to create the edited Default Profile at {path}", {
          path: profile.defaultDocumentPath,
          error,
        });
        new BaseNotice(m.notice_profile_action_failed());
      })
      .finally(() => {
        this.#materializing = null;
      });
    return this.#materializing;
  }
  openMenu(anchor: HTMLElement): void {
    const menu = new Menu();
    this.onPaneMenu(menu, "more-options");
    const bounds = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: bounds.left, y: bounds.bottom });
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
  chooseItem(): Promise<void> {
    if (this.#choosePending) return this.#choosePending;
    this.#choosePending = pickItem(
      {
        app: this.app,
        lookup: this.#deps.itemLookup,
        settings: this.#deps.settings,
      },
      m.template_data_explorer_pick_placeholder(),
    )
      .then((hit) => {
        if (hit && !this.#closed) this.#selectKey(hit.item.indexedKey);
      })
      .finally(() => {
        this.#choosePending = null;
      });
    return this.#choosePending;
  }
  /** Preview and Explorer call this at their first need for an Item. */
  async ensureItem(): Promise<boolean> {
    if (this.store.getState().item) return true;
    if (!this.#prompted) {
      this.#prompted = true;
      await this.chooseItem();
    }
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
        if (!docChanged) return;
        if (this.#insertTarget) {
          const { slice, range } = this.#insertTarget;
          this.#insertTarget = {
            slice,
            range: {
              from: transaction.changes.mapPos(range.from, 1),
              to: transaction.changes.mapPos(range.to, 1),
            },
          };
          for (const listener of this.#insertListeners) listener();
        }
        this.data = this.#controller.source;
        if (transaction.annotation(externalEdit) !== true) {
          if (this.#defaultDraft) void this.materializeDefault();
          else this.requestSave();
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
          >
            {content}
          </WorkbenchEditorProvider>
        </WorkbenchHostProvider>
      </WorkbenchThemeProvider>
    );
  }
  #mount(): void {
    this.#root?.render(
      this.provide(
        <EditorContent
          view={this}
          insertRequest={this.#insertRequest}
          onSelection={(target) => {
            this.#insertTarget = target;
            for (const listener of this.#insertListeners) listener();
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
  const noteCaret = useRef<WorkbenchSliceRange | null>(null);
  useDocumentRevision(controller);
  const preview = useNativePreview(view.preview);
  const result = preview?.result;
  const formatProblem = result?.diagnostics.find(
    ({ part }) => part === "annotation",
  );
  const advanced = useWorkbenchStore((state) => state.advanced);
  const [selected, setSelected] = useState<number | null>(null);
  const [reveal, setReveal] = useState<WorkbenchSliceRange | null>(null);
  const [fieldFocus, setFieldFocus] = useState<{ field: string } | null>(null);
  useEffect(() => {
    if (!insertRequest) return;
    const position = entryPosition(insertRequest.slice);
    if (position !== null) setSelected(position);
    setReveal(insertRequest.range);
  }, [insertRequest]);
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
    <div className="zt:flex zt:h-full zt:flex-col">
      <EditorHeader view={view} />
      <StartHere />
      {view.isDefaultDraft && (
        <p role="status" className="zt:px-3 zt:text-muted">
          {m.profile_editor_default_first_edit()}
        </p>
      )}
      {view.unavailableDependencies.map((message) => (
        <p key={message} role="status" className="zt:px-3 zt:text-muted">
          {message}
        </p>
      ))}
      {!advanced && (
        <TabBar
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
      <div className="zt:min-h-0 zt:flex-1 zt:overflow-auto">
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
                  noteCaret.current = range;
                  selection("note")(range);
                }}
              />
              {controller.noteRegions.annotationCalls.length === 0 && (
                <AnnotationPointer
                  onInsert={() => {
                    const { repaired, caret } = controller.insertAnnotationLoop(
                      noteCaret.current ?? undefined,
                    );
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
    <EditToolbar
      layout="linear"
      leading={
        <button
          className="zt-profile-editor-item zt:min-w-0 zt:truncate"
          {...tooltipAttrs(item?.title ?? m.profile_editor_choose_paper())}
          onClick={() => void view.chooseItem()}
        >
          <span className="zt:min-w-0 zt:truncate">
            {item?.title ?? m.profile_editor_choose_paper()}
          </span>
        </button>
      }
    >
      <button
        className="clickable-icon"
        {...tooltipAttrs(m.profile_editor_open_markdown())}
        disabled={!view.file}
        onClick={() => void view.openMarkdown()}
      >
        <Icon name="file-code" />
      </button>
      <button
        className="clickable-icon"
        {...tooltipAttrs(m.workbench_more_actions())}
        onClick={(event) => view.openMenu(event.currentTarget)}
      >
        <Icon name="more-horizontal" />
      </button>
    </EditToolbar>
  );
}
