// One file-backed authoring session; TextFileView owns vault updates and saves.
import { Menu, Scope, TextFileView } from "obsidian";
import type { ViewStateResult, WorkspaceLeaf } from "obsidian";
import { useRef, useState } from "react";
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
  TabBar,
  TabPanel,
  TABS,
  WorkbenchEditorProvider,
  WorkbenchHostProvider,
  WorkbenchThemeProvider,
  useDocumentRevision,
  useWorkbenchStore,
  m as shared,
} from "@zotlit/workbench/ui";
import type {
  WorkbenchHost,
  WorkbenchInsertTarget,
  NameFolderPaneProps,
} from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { itemSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import { tooltipAttrs } from "@/lib/utils";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import { listInstalledStyles } from "@/services/pandoc/styles";
import {
  lastTemplateItem,
  rememberTemplateItem,
} from "@/views/template-data-explorer/item-memory";
import { pickItem } from "@/views/template-data-explorer/item-picker";
import type { ExplorerViewDeps } from "@/views/template-data-explorer/view";

import { createProfileEditorHost } from "./host";
import { profileEditorTheme } from "./theme";

export const PROFILE_EDITOR_VIEW_TYPE = "zotlit-profile-editor";
const logger = getLogger(["views", "profile-editor"]);
export type ProfileEditorDeps = Omit<ExplorerViewDeps, "pluginVersion"> & {
  render?: WorkbenchHost["render"];
};

export class ProfileEditorView extends TextFileView {
  readonly store = createWorkbenchStore();
  readonly #deps: ProfileEditorDeps;
  readonly #host: ReturnType<typeof createProfileEditorHost>;
  #controller = new WorkbenchDocumentController("", { runtime: "native" });
  #root: Root | null = null;
  #unsubscribe: (() => void) | null = null;
  #insertTarget: WorkbenchInsertTarget | null = null;
  #choosePending: Promise<void> | null = null;
  #prompted = false;
  #closed = false;
  #generation = 0;
  #bindingDefaults = BUILT_IN_BINDING_DEFAULTS;
  #databaseUnavailable = false;
  #stylesUnavailable = false;
  #citationStyles: NameFolderPaneProps["citationStyles"] = [];

  constructor(leaf: WorkspaceLeaf, deps: ProfileEditorDeps) {
    super(leaf);
    this.#deps = deps;
    this.contentEl.addClass("zt-root", "zt-profile-editor");
    this.#host = createProfileEditorHost(
      this.app,
      {
        render:
          deps.render ??
          ((request, deliver) => {
            deliver(
              failedRender(renderIdentity(request), { code: "render-error" }),
            );
            return { terminate() {} };
          }),
        matchData: {
          tags: async () => [],
          collections: async () => [],
          libraries: async () => [],
        },
        insertTarget: () => this.#insertTarget,
      },
      (content) => this.#provide(content),
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

  get bindingDefaults(): typeof BUILT_IN_BINDING_DEFAULTS {
    return this.#bindingDefaults;
  }
  get citationStyles(): NameFolderPaneProps["citationStyles"] {
    return this.#citationStyles;
  }
  get controller(): WorkbenchDocumentController {
    return this.#controller;
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
    if (clear) {
      this.#host[Symbol.dispose]();
      this.#unsubscribe?.();
      this.#generation++;
      this.#controller = new WorkbenchDocumentController(source, {
        runtime: "native",
      });
      this.#insertTarget = null;
      this.#subscribe();
      this.#mount();
    } else this.#controller.applyExternalSource(source);
    this.data = this.#controller.source;
  }
  override clear(): void {
    this.setViewData("", true);
  }

  override getState(): Record<string, unknown> {
    const { tab, item, root, explorer, preview, advanced } =
      this.store.getState();
    return {
      ...super.getState(),
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
    this.#host[Symbol.dispose]();
    this.#root?.unmount();
    this.#root = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }
  override onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    menu.addItem((item) =>
      item
        .setTitle(m.profile_editor_open_markdown())
        .setIcon("file-text")
        .onClick(() => void this.openMarkdown()),
    );
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
    this.#choosePending = pickItem({
      app: this.app,
      lookup: this.#deps.itemLookup,
      settings: this.#deps.settings,
    })
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
        this.data = this.#controller.source;
        if (transaction.annotation(externalEdit) !== true) this.requestSave();
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
  #provide(content: ReactNode): ReactNode {
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
      this.#provide(
        <EditorContent
          view={this}
          onSelection={(target) => {
            this.#insertTarget = target;
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
  onSelection,
}: {
  view: ProfileEditorView;
  onSelection: (target: WorkbenchInsertTarget) => void;
}) {
  const controller = view.controller;
  const host = useWorkbenchHost();
  const noteCaret = useRef<WorkbenchSliceRange | null>(null);
  useDocumentRevision(controller);
  const advanced = useWorkbenchStore((state) => state.advanced);
  const [selected, setSelected] = useState<number | null>(null);
  const [reveal, setReveal] = useState<WorkbenchSliceRange | null>(null);
  const [fieldFocus, setFieldFocus] = useState<{ field: string } | null>(null);
  const manifest = useRef(controller.document?.manifest ?? null);
  if (controller.document) manifest.current = controller.document.manifest;
  const firstProblem = controller.problems[0] ?? null;
  const problem =
    firstProblem?.slice === "details" && manifest.current === null
      ? { ...firstProblem, slice: "advanced" as const }
      : firstProblem;
  const state = view.store.getState();
  function openProblem(problem: WorkbenchProblem) {
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
  const selection =
    (slice: WorkbenchInsertTarget["slice"]) => (range: WorkbenchSliceRange) =>
      onSelection({ slice, range });
  return (
    <div className="zt:flex zt:h-full zt:flex-col">
      <EditorHeader view={view} />
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
            label={shared.workbench_advanced()}
            reveal={reveal}
            onSelection={selection("advanced")}
          />
        ) : (
          <>
            <TabPanel tab="note">
              <NotePane
                controller={controller}
                preview={null}
                formatProblem={null}
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
                      host.notice(shared.workbench_annotation_section_added());
                  }}
                />
              )}
            </TabPanel>
            <TabPanel tab="properties">
              {controller.managedEntries === null ? (
                <p>
                  {m.profile_editor_properties_advanced()}{" "}
                  <button onClick={() => state.setAdvanced(true)}>
                    {shared.workbench_advanced()}
                  </button>
                </p>
              ) : (
                <PropertiesPane
                  controller={controller}
                  entries={controller.managedEntries}
                  properties={[]}
                  fold={[]}
                  diagnostics={controller.problems.flatMap((problem) => {
                    const position = entryPosition(problem.slice);
                    return position === null
                      ? []
                      : [{ position, message: problemText(problem).message }];
                  })}
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
            <TabPanel tab="annotation">
              <AnnotationPane
                controller={controller}
                problem={null}
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
                filename={null}
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
          className="zt:min-w-0 zt:truncate"
          onClick={() => void view.chooseItem()}
        >
          {item?.title ?? m.profile_editor_choose_paper()}
        </button>
      }
    >
      <button onClick={() => void view.openMarkdown()}>
        {m.profile_editor_open_markdown()}
      </button>
      <button
        className="clickable-icon"
        {...tooltipAttrs(shared.workbench_more_actions())}
        onClick={(event) => view.openMenu(event.currentTarget)}
      >
        <Icon name="more-horizontal" />
      </button>
    </EditToolbar>
  );
}
