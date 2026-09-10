// A native Explorer owns its data and navigation; workspace values supply its authoring context.
import { ItemView, setIcon } from "obsidian";
import type { Menu, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { parseIndexedKey } from "@zotlit/db";
import type { DisplayNode } from "@zotlit/workbench/explorer";
import {
  failedRender,
  renderIdentity,
  SAMPLE_ANNOTATIONS,
} from "@zotlit/workbench/render";
import {
  explorerSectionIds,
  visibleSectionIds,
  WorkbenchHostProvider,
  WorkbenchThemeProvider,
} from "@zotlit/workbench/ui";
import type { WorkbenchItemChoice } from "@zotlit/workbench/ui";

import * as m from "@/lib/i18n/generated/messages";
import type { DatabaseService } from "@/services/database/service";
import { indexedKeyForClipboard } from "@/services/indexed-key/actions";
import type { ItemLookup } from "@/services/item-lookup/service";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import type { SettingsService } from "@/services/settings/service";
import type { TemplateDataDeps } from "@/services/template-workbench/data";
import type { TemplateService } from "@/services/template/service";
import {
  activeProfileEditor,
  registerCompanionHistory,
  onCompanionStateRestored,
  subscribeActiveProfileEditor,
} from "@/views/note-preview/register";
import { createProfileEditorHost } from "@/views/profile-editor/host";
import {
  chooseWorkbenchItem,
  searchWorkbenchItem,
  chooseWorkbenchAnnotation,
  publishWorkbenchSelection,
  subscribeWorkbenchSelection,
  selectionViewTitle,
  updateSelectionTitle,
} from "@/views/profile-editor/selection";
import { getSampleItem } from "@/views/profile-editor/selection-data";
import { profileEditorTheme } from "@/views/profile-editor/theme";
import type {
  ProfileAuthoringContext,
  ProfileEditorView,
} from "@/views/profile-editor/view";

import { createExplorerActions, ExplorerActionsContext } from "./actions";
import type { ExplorerActions } from "./actions";
import { Explorer } from "./Explorer";
import { exportTemplateDataFile } from "./export-file";
import { rememberTemplateItem } from "./item-memory";
import {
  annotationIndexedKey,
  NativeExplorerSession,
  ExplorerStoreProvider,
} from "./store";

export const EXPLORER_VIEW_TYPE = "zotlit-template-data-explorer";
export interface ExplorerViewDeps extends TemplateDataDeps {
  db: Pick<
    DatabaseService,
    "state" | "client" | "ready" | "on" | "refresh" | "acquireRead"
  >;
  itemLookup: Pick<ItemLookup, "search">;
  settings: SettingsService;
  templates: Pick<
    TemplateService,
    "javascriptTemplatesEnabled" | "ready" | "render"
  >;
  pluginVersion: string;
}
export class TemplateDataExplorerView extends ItemView {
  readonly #session: NativeExplorerSession;
  readonly #deps: ExplorerViewDeps;
  #root: Root | null = null;
  #cleanup: DisposableStack | null = null;
  #editor: ProfileEditorView | null = null;
  #host: ReturnType<typeof createProfileEditorHost> | null = null;
  #actions: ExplorerActions | null = null;
  #closed = false;
  #choiceGeneration = 0;
  constructor(leaf: WorkspaceLeaf, deps: ExplorerViewDeps) {
    super(leaf);
    this.contentEl.addClass("zt-root");
    this.#deps = deps;
    this.#session = new NativeExplorerSession(deps);
  }
  override getViewType(): string {
    return EXPLORER_VIEW_TYPE;
  }
  override getDisplayText(): string {
    const state = this.#session.state.getState();
    const title =
      state.root === "note" && typeof state.data?.title === "string"
        ? state.data.title
        : state.item?.title;
    return selectionViewTitle({
      item: state.item && { ...state.item, title: title ?? null },
      annotation:
        state.root === "annotation" && state.data && state.annotationId
          ? { id: state.annotationId, root: state.data }
          : null,
      annotationMode: state.root === "annotation",
      view: "fields",
    });
  }
  override getIcon(): string {
    return "braces";
  }
  override onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    menu.addItem((item) =>
      item
        .setSection("zotlit")
        .setTitle(m.workbench_choose_item())
        .setIcon("search")
        .onClick(() => void this.#chooseItem()),
    );
    menu.addItem((item) =>
      item
        .setSection("zotlit")
        .setTitle(m.workbench_choose_annotation())
        .setIcon("highlighter")
        .onClick(() => void this.#chooseAnnotation()),
    );
    menu.addItem((item) =>
      item
        .setSection("zotlit")
        .setTitle(
          this.#allSectionsCollapsed()
            ? m.workbench_explorer_expand_all()
            : m.workbench_explorer_collapse_all(),
        )
        .setIcon(
          this.#allSectionsCollapsed()
            ? "chevrons-up-down"
            : "chevrons-down-up",
        )
        .onClick(() => this.#toggleSections()),
    );
    this.#actions?.addCopyKeyMenuItem(menu);
    menu.addItem((item) =>
      item
        .setSection("zotlit")
        .setTitle(m.workbench_refresh_item())
        .setIcon("refresh-cw")
        .onClick(() => this.#session.refresh()),
    );
    this.#actions?.addExportMenuItem(menu);
  }
  override getState(): Record<string, unknown> {
    const { item, annotationId, root, collapsedSections, sourcePath } =
      this.#session.state.getState();
    return {
      itemIndexedKey: item?.id ?? null,
      anchorAnnotationKey: annotationId,
      root,
      collapsedSections: [...collapsedSections],
      sourceFile: sourcePath,
    };
  }
  /** Judged on the sections the reader can see, so the action's label matches the pane. */
  #allSectionsCollapsed(): boolean {
    const host = this.#host;
    if (!host) return false;
    const { root, data, collapsedSections } = this.#session.state.getState();
    const shown = visibleSectionIds(data, {
      m: host.messages,
      root,
      locale: host.getLocale(),
    });
    return shown.length > 0 && shown.every((id) => collapsedSections.has(id));
  }
  /** Closes every section, or opens every section once all are closed. */
  #toggleSections(): void {
    const { root, setCollapsedSections } = this.#session.state.getState();
    setCollapsedSections(
      this.#allSectionsCollapsed()
        ? new Set()
        : new Set<string>(explorerSectionIds(root)),
    );
  }
  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    const previous = JSON.stringify(this.getState());
    const launch =
      !!state &&
      typeof state === "object" &&
      "zotlitLaunch" in state &&
      state.zotlitLaunch === true;
    try {
      await this.#restoreState(state, result);
    } finally {
      if (previous !== JSON.stringify(this.getState())) result.history = true;
      if (!launch)
        onCompanionStateRestored(this.app, result, () => {
          if (!this.#cleanup) return;
          this.#editor = activeProfileEditor(this.app, this.leaf, this.#editor);
          if (this.#editor) this.#apply(this.#editor.authoringContext);
          this.#mount();
        });
    }
  }
  async #restoreState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (!state || typeof state !== "object") return;
    const value = state as Record<string, unknown>;
    if (!Object.hasOwn(value, "itemIndexedKey")) return;
    const annotationId =
      typeof value.anchorAnnotationKey === "string"
        ? value.anchorAnnotationKey
        : null;
    const root =
      value.root === "filename" ||
      value.root === "annotation" ||
      value.root === "note"
        ? value.root
        : annotationId
          ? "annotation"
          : "note";
    this.#session.state.setState({
      collapsedSections: new Set(
        Array.isArray(value.collapsedSections)
          ? value.collapsedSections.filter(
              (id): id is string => typeof id === "string",
            )
          : [],
      ),
      sourcePath:
        typeof value.sourceFile === "string" ? value.sourceFile : null,
    });
    const item =
      typeof value.itemIndexedKey === "string"
        ? { id: value.itemIndexedKey, title: value.itemIndexedKey }
        : null;
    this.#session.state.setState({
      context:
        typeof value.sourceFile === "string"
          ? {
              leaf: this.leaf,
              path: value.sourceFile,
              item,
              root,
              annotationId,
              tab:
                root === "annotation"
                  ? "annotation"
                  : root === "filename"
                    ? "name"
                    : "note",
              advanced: false,
              canInsertField: false,
            }
          : null,
    });
    this.#session.setTarget(
      typeof value.itemIndexedKey === "string"
        ? { id: value.itemIndexedKey, title: value.itemIndexedKey }
        : null,
      root,
      annotationId,
    );
  }
  #presentationContext(): string {
    const { item, root, annotationId } = this.#session.state.getState();
    return JSON.stringify([item?.id ?? null, root, annotationId]);
  }
  override getEphemeralState(): Record<string, unknown> {
    const { navigation, presentation } = this.#session.state.getState();
    return {
      zotlitDataExplorer: {
        context: this.#presentationContext(),
        navigation: {
          ...navigation,
          expanded: [...navigation.expanded],
          filterCollapsed: [...navigation.filterCollapsed],
          noteRootExpanded: navigation.noteRootExpanded && [
            ...navigation.noteRootExpanded,
          ],
          preFilterExpanded: navigation.preFilterExpanded && [
            ...navigation.preFilterExpanded,
          ],
        },
        presentation,
      },
    };
  }
  override setEphemeralState(input: unknown): void {
    if (!input || typeof input !== "object") return;
    const value = input as Record<string, unknown>;
    const payload = value.zotlitDataExplorer;
    if (!payload || typeof payload !== "object") return;
    const state = payload as Record<string, unknown>;
    if (state.context !== this.#presentationContext()) return;
    const raw = state.navigation;
    if (!raw || typeof raw !== "object") return;
    const navigation = raw as Record<string, unknown>;
    const strings = (input: unknown): ReadonlySet<string> =>
      new Set(
        Array.isArray(input)
          ? input.filter((entry): entry is string => typeof entry === "string")
          : [],
      );
    const rawPresentation = state.presentation as Record<
      string,
      unknown
    > | null;
    const presentation = {
      top:
        typeof rawPresentation?.top === "number" &&
        Number.isFinite(rawPresentation.top)
          ? Math.max(0, rawPresentation.top)
          : 0,
      left:
        typeof rawPresentation?.left === "number" &&
        Number.isFinite(rawPresentation.left)
          ? Math.max(0, rawPresentation.left)
          : 0,
      field:
        typeof rawPresentation?.field === "string"
          ? rawPresentation.field
          : null,
    };
    this.#session.state.setState({
      navigation: {
        anchorKey:
          typeof navigation.anchorKey === "string"
            ? navigation.anchorKey
            : null,
        filterQuery:
          typeof navigation.filterQuery === "string"
            ? navigation.filterQuery
            : "",
        expanded: strings(navigation.expanded),
        filterCollapsed: strings(navigation.filterCollapsed),
        noteRootExpanded:
          navigation.noteRootExpanded === null
            ? null
            : strings(navigation.noteRootExpanded),
        preFilterExpanded:
          navigation.preFilterExpanded === null
            ? null
            : strings(navigation.preFilterExpanded),
      },
      presentation,
      restore: { ...presentation, focus: value.focus === true },
    });
  }
  protected override async onOpen(): Promise<void> {
    using cleanup = new DisposableStack();
    cleanup.defer(registerCompanionHistory(this));
    cleanup.use(this.#session);
    // Swaps icon and label like the file explorer's collapse action: each
    // names what the next press does.
    const sectionsAction = this.addAction(
      "chevrons-down-up",
      m.workbench_explorer_collapse_all(),
      () => this.#toggleSections(),
    );
    let syncedSections: boolean | null = null;
    const syncSectionsAction = () => {
      const collapsed = this.#allSectionsCollapsed();
      if (collapsed === syncedSections) return;
      syncedSections = collapsed;
      setIcon(
        sectionsAction,
        collapsed ? "chevrons-up-down" : "chevrons-down-up",
      );
      sectionsAction.setAttribute(
        "aria-label",
        collapsed
          ? m.workbench_explorer_expand_all()
          : m.workbench_explorer_collapse_all(),
      );
    };
    syncSectionsAction();
    const chooseAction = this.addAction(
      "search",
      m.workbench_choose_item(),
      () => {
        if (this.#session.state.getState().root === "annotation")
          void this.#chooseAnnotation();
        else void this.#chooseItem();
      },
    );
    cleanup.defer(
      subscribeWorkbenchSelection(this, {
        editor: () => this.#sourceEditor()?.leaf ?? null,
        apply: (selection) => {
          if (selection.kind === "item")
            this.#selectItem(selection.item, false);
          else {
            const state = this.#session.state.getState();
            if (state.annotationId !== selection.annotationId)
              this.#session.setTarget(
                state.item,
                state.root,
                selection.annotationId,
              );
          }
        },
      }),
    );
    cleanup.defer(
      this.#session.state.subscribe((state, previous) => {
        updateSelectionTitle(this);
        syncSectionsAction();
        chooseAction.setAttribute(
          "aria-label",
          state.root === "annotation"
            ? m.workbench_choose_annotation()
            : m.workbench_choose_item(),
        );
        if (
          state.item?.id !== previous.item?.id ||
          state.root !== previous.root ||
          state.annotationId !== previous.annotationId ||
          state.collapsedSections !== previous.collapsedSections ||
          state.sourcePath !== previous.sourcePath
        )
          this.app.workspace.requestSaveLayout();
      }),
    );
    this.#host = cleanup.use(
      createProfileEditorHost(this.app, {
        render: (request) =>
          Promise.resolve(
            failedRender(renderIdentity(request), { code: "render-error" }),
          ),
        matchData: {
          tags: async () => [],
          collections: async () => [],
          libraries: async () => [],
        },
        insertTarget: () => null,
      }),
    );
    this.#actions = createExplorerActions({
      onChooseItem: () => void this.#chooseItem(),
      onBackToNoteRoot: () => {
        this.#session.setTarget(this.#session.state.getState().item, "note");
      },
      onToggleSections: () => this.#toggleSections(),
      onRefresh: () => this.#session.refresh(),
      canExport: () => this.#exportTarget() !== null,
      onExport: () => void this.#export(),
      exportLabel: () =>
        this.#session.state.getState().root === "annotation" &&
        this.#exportTarget()?.root === "note"
          ? m.template_data_explorer_export_selected_paper()
          : m.template_data_explorer_menu_export_json(),
      copyTarget: () => {
        const target = this.#exportTarget();
        return target
          ? {
              indexedKey: target.indexedKey,
              kind: target.root === "annotation" ? "annotation" : "item",
            }
          : null;
      },
    });
    this.#root = cleanup.adopt(createRoot(this.contentEl), (root) =>
      root.unmount(),
    );
    const event = this.app.workspace.on(
      "zotlit:authoring-context",
      (context) => {
        if (context.leaf === this.#editor?.leaf) this.#apply(context);
      },
    );
    cleanup.defer(() => this.app.workspace.offref(event));
    const rename = this.app.vault.on("rename", (file, oldPath) => {
      const { context, sourcePath } = this.#session.state.getState();
      if (sourcePath !== oldPath) return;
      const editorContext = this.#editor?.authoringContext;
      this.#session.state.setState({
        sourcePath: file.path,
        ...(context?.path === oldPath
          ? {
              context: {
                ...context,
                path: file.path,
                canInsertField:
                  editorContext?.path === file.path &&
                  editorContext.canInsertField,
              },
            }
          : {}),
      });
    });
    cleanup.defer(() => this.app.vault.offref(rename));
    cleanup.defer(
      subscribeActiveProfileEditor(
        this.app,
        (editor) => {
          this.#editor = editor;
          if (editor) this.#apply(editor.authoringContext);
          else {
            const context = this.#session.state.getState().context;
            if (context)
              this.#session.state.setState({
                context: { ...context, canInsertField: false },
              });
          }
        },
        this.leaf,
      ),
    );
    cleanup.defer(this.#deps.db.on("changed", () => this.#session.refresh()));
    this.#mount();
    this.#cleanup = cleanup.move();
    updateSelectionTitle(this);
    await this.#deps.db.ready;
    if (this.#closed || this.#session.state.getState().context) return;
    if (!this.#session.state.getState().item) {
      const file = this.app.workspace.getActiveFile();
      const key = file
        ? itemKeyFromFrontmatter(this.app.metadataCache.getFileCache(file))
        : null;
      if (key) this.#session.setTarget({ id: key, title: key }, "note");
    } else this.#session.refresh();
  }
  #apply(context: ProfileAuthoringContext, explicit = false): void {
    const previous = this.#session.state.getState().context;
    if (!explicit && this.leaf.pinned && previous) {
      this.#session.state.setState({
        context: {
          ...previous,
          canInsertField:
            previous.path === context.path && context.canInsertField,
        },
      });
      return;
    }
    this.#session.setContext(context);
  }
  #mount(): void {
    if (!this.#host || !this.#actions) return;
    this.#root?.render(
      <WorkbenchHostProvider host={this.#host}>
        <WorkbenchThemeProvider theme={profileEditorTheme}>
          <ExplorerStoreProvider value={this.#session.state}>
            <ExplorerActionsContext value={this.#actions}>
              <Explorer
                onSelectAnnotation={(id) => this.#selectAnnotation(id)}
                onChooseAnnotation={() => void this.#chooseAnnotation()}
                onSelectItem={(item) => this.#selectItem(item)}
                onSearchItem={() => void this.#chooseItem(true)}
                lookup={this.#deps.itemLookup}
                explorer={{
                  copy: (text) => navigator.clipboard.writeText(text),
                  engines: () =>
                    this.#deps.templates.javascriptTemplatesEnabled
                      ? ["liquid", "eta"]
                      : ["liquid"],
                  onInsertNode: (node) => {
                    const editor = activeProfileEditor(
                      this.app,
                      this.leaf,
                      this.#editor,
                    );
                    if (editor && editor === this.#sourceEditor())
                      this.app.workspace.trigger(
                        "zotlit:insert-template-field",
                        { leaf: editor.leaf, node },
                      );
                  },
                  canExploreAnnotation: (node) =>
                    this.#annotationKey(node) !== null,
                  onExploreAnnotation: (node) => {
                    const key = this.#annotationKey(node);
                    if (key) {
                      this.#selectAnnotation(key);
                    }
                  },
                }}
              />
            </ExplorerActionsContext>
          </ExplorerStoreProvider>
        </WorkbenchThemeProvider>
      </WorkbenchHostProvider>,
    );
  }
  #annotationKey(node: DisplayNode): string | null {
    const { item, root } = this.#session.state.getState();
    if (
      !item ||
      root !== "note" ||
      node.path.length !== 2 ||
      node.path[0] !== "annotations" ||
      typeof node.path[1] !== "number" ||
      node.kind !== "value" ||
      !node.value ||
      typeof node.value !== "object" ||
      !("key" in node.value) ||
      typeof node.value.key !== "string"
    )
      return null;
    const parsed = parseIndexedKey(item.id);
    if (getSampleItem(item.id)) return node.value.key;
    return parsed
      ? indexedKeyForClipboard({ key: node.value.key, groupID: parsed.groupID })
      : null;
  }
  #exportTarget() {
    const { item, root, annotationId, status } = this.#session.state.getState();
    if (
      !item ||
      getSampleItem(item.id) ||
      (status !== "ready" && status !== "empty")
    )
      return null;
    if (root !== "annotation") return { indexedKey: item.id, root };
    if (
      !annotationId ||
      SAMPLE_ANNOTATIONS.some(({ id }) => id === annotationId)
    )
      return { indexedKey: item.id, root: "note" as const };
    const key = annotationIndexedKey(item.id, annotationId);
    return key ? { indexedKey: key, root } : null;
  }
  async #export(): Promise<void> {
    const target = this.#exportTarget();
    if (target)
      await exportTemplateDataFile(this.#deps, {
        ...target,
        pluginVersion: this.#deps.pluginVersion,
      });
  }
  #sourceEditor(): ProfileEditorView | null {
    return this.#editor &&
      this.#session.state.getState().context?.path ===
        this.#editor.authoringContext.path
      ? this.#editor
      : null;
  }
  async #chooseItem(searchAll = false): Promise<void> {
    const editor = this.#sourceEditor();
    if (editor && !searchAll) {
      const selected = await editor.chooseItem();
      if (selected && !this.#closed && editor === this.#sourceEditor())
        this.#apply(editor.authoringContext, true);
      return;
    }
    const host = this.#host;
    if (!host) return;
    const generation = ++this.#choiceGeneration;
    const previous = this.#session.state.getState().item;
    const deps = {
      app: this.app,
      lookup: this.#deps.itemLookup,
      settings: this.#deps.settings,
    };
    const item = await (searchAll
      ? searchWorkbenchItem(deps)
      : chooseWorkbenchItem(host, deps, previous ?? undefined));
    if (
      !item ||
      this.#closed ||
      generation !== this.#choiceGeneration ||
      this.#session.state.getState().item !== previous
    )
      return;
    this.#selectItem(item);
  }
  #selectItem(item: WorkbenchItemChoice, notify = true): void {
    const state = this.#session.state.getState();
    if (this.#closed) return;
    this.#session.setTarget(item, state.root, state.annotationId);
    if (!getSampleItem(item.id)) rememberTemplateItem(this.app, item.id);
    if (notify)
      publishWorkbenchSelection(
        this,
        { kind: "item", item },
        this.#sourceEditor()?.leaf ?? null,
      );
  }
  #selectAnnotation(id: string): void {
    const state = this.#session.state.getState();
    this.#session.setTarget(state.item, "annotation", id);
    publishWorkbenchSelection(
      this,
      { kind: "annotation", annotationId: id },
      this.#sourceEditor()?.leaf ?? null,
    );
  }
  async #chooseAnnotation(): Promise<void> {
    const host = this.#host;
    if (!host) return;
    const state = this.#session.state.getState();
    const generation = ++this.#choiceGeneration;
    const id = await chooseWorkbenchAnnotation(
      host,
      state.annotations ?? [],
      state.item
        ? (annotationIndexedKey(state.item.id, state.annotationId) ??
            state.annotationId)
        : state.annotationId,
    );
    if (
      id !== null &&
      !this.#closed &&
      generation === this.#choiceGeneration &&
      state.item === this.#session.state.getState().item
    )
      this.#selectAnnotation(id);
  }
  protected override async onClose(): Promise<void> {
    this.#closed = true;
    this.#cleanup?.dispose();
    this.#cleanup = null;
    this.#root = null;
    this.#host = null;
    this.#actions = null;
    this.#editor = null;
  }
}
