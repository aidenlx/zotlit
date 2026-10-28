// A native Explorer owns its data and navigation; workspace values supply its authoring context.
import { Effect } from "effect";
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
  NO_MATCH_DATA,
} from "@zotlit/workbench/ui";
import type { TemplateRoot, WorkbenchItemChoice } from "@zotlit/workbench/ui";

import type { EffectBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import { MENU_SECTION } from "@/lib/menu-section";
import { ViewRegistryProvider } from "@/lib/view-atoms";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import { answerOf, makeViewRunner } from "@/lib/view-runner";
import type { ViewRun } from "@/lib/view-runner";
import { indexedKeyForClipboard } from "@/services/indexed-key/actions";
import type { ItemLookupHandle } from "@/services/item-lookup/handle";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import type { PluginSettings } from "@/services/settings/service";
import {
  activeTemplateWorkbench,
  registerCompanionHistory,
  onCompanionStateRestored,
  subscribeActiveTemplateWorkbench,
} from "@/views/note-preview/register";
import {
  copyToClipboard,
  createTemplateWorkbenchHost,
} from "@/views/template-workbench/host";
import {
  chooseWorkbenchItem,
  searchWorkbenchItem,
  chooseWorkbenchAnnotation,
  publishWorkbenchSelection,
  subscribeWorkbenchSelection,
  selectionViewTitle,
  updateSelectionTitle,
} from "@/views/template-workbench/selection";
import { getSampleItem } from "@/views/template-workbench/selection-data";
import { templateWorkbenchTheme } from "@/views/template-workbench/theme";
import type {
  TemplateAuthoringContext,
  TemplateWorkbenchView,
} from "@/views/template-workbench/view";

import { createExplorerActions, ExplorerActionsContext } from "./actions";
import type { ExplorerActions } from "./actions";
import { makeExportTemplateDataCommand } from "./atoms";
import { Explorer } from "./Explorer";
import { rememberTemplateItem } from "./item-memory";
import {
  annotationIndexedKey,
  ExplorerModelContext,
  holdExplorerModel,
  keepPinnedContext,
  loseEditor,
  makeExplorerModel,
  moveSource,
  readEphemeralExplorer,
  readSavedExplorer,
  refresh,
  setCollapsedSections,
  setContext,
  setTarget,
} from "./model";
import type { ExplorerSession, ExplorerState } from "./model";

export const EXPLORER_VIEW_TYPE = "zotlit-template-data-explorer";
export interface ExplorerViewDeps {
  /** The plugin's view registry: this Explorer's model and its data load. */
  registry: ViewRegistryHandle;
  itemLookup: Pick<ItemLookupHandle, "search" | "openSession">;
  settings: Pick<PluginSettings["Service"], "current" | "changes">;
  bridge: Pick<EffectBridge, "runSync">;
  pluginVersion: string;
}
export class TemplateDataExplorerView extends ItemView {
  readonly #model = makeExplorerModel();
  readonly #exportCommand = makeExportTemplateDataCommand();
  readonly #deps: ExplorerViewDeps;
  #release: (() => void) | null;
  #root: Root | null = null;
  #cleanup: DisposableStack | null = null;
  #editor: TemplateWorkbenchView | null = null;
  #host: ReturnType<typeof createTemplateWorkbenchHost> | null = null;
  /** Forks on this leaf's view services; the close interrupts it. */
  #run: ViewRun | null = null;
  #actions: ExplorerActions | null = null;
  #closed = false;
  #choiceGeneration = 0;
  constructor(leaf: WorkspaceLeaf, deps: ExplorerViewDeps) {
    super(leaf);
    this.contentEl.addClass("zt-root");
    this.#deps = deps;
    // Obsidian sets the layout state before the view opens.
    this.#release = holdExplorerModel(deps.registry, this.#model);
  }
  #state(): ExplorerState {
    return this.#deps.registry.get(this.#model.state);
  }
  #update(transition: (session: ExplorerSession) => ExplorerSession): void {
    this.#deps.registry.update(this.#model.session, transition);
  }
  #setTarget(
    item: WorkbenchItemChoice | null,
    root: TemplateRoot,
    annotationId: string | null = null,
  ): void {
    this.#update(setTarget(item, root, annotationId));
  }
  override getViewType(): string {
    return EXPLORER_VIEW_TYPE;
  }
  override getDisplayText(): string {
    const state = this.#state();
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
        .setSection(MENU_SECTION.action)
        .setTitle(m.workbench_choose_item())
        .setIcon("search")
        .onClick(() => void this.#chooseItem()),
    );
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.action)
        .setTitle(m.workbench_choose_annotation())
        .setIcon("highlighter")
        .onClick(() => void this.#chooseAnnotation()),
    );
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.pane)
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
        .setSection(MENU_SECTION.action)
        .setTitle(m.workbench_refresh_item())
        .setIcon("refresh-cw")
        .onClick(() => this.#update(refresh)),
    );
    this.#actions?.addExportMenuItem(menu);
  }
  override getState(): Record<string, unknown> {
    const { item, annotationId, root, collapsedSections, sourcePath } =
      this.#state();
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
    const { root, data, collapsedSections } = this.#state();
    const shown = visibleSectionIds(data, {
      m: host.messages,
      root,
      locale: host.getLocale(),
    });
    return shown.length > 0 && shown.every((id) => collapsedSections.has(id));
  }
  /** Closes every section, or opens every section once all are closed. */
  #toggleSections(): void {
    const { root } = this.#state();
    this.#update(
      setCollapsedSections(
        this.#allSectionsCollapsed()
          ? new Set()
          : new Set<string>(explorerSectionIds(root)),
      ),
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
          this.#editor = activeTemplateWorkbench(
            this.app,
            this.leaf,
            this.#editor,
          );
          if (this.#editor) this.#apply(this.#editor.authoringContext);
          this.#mount();
        });
    }
  }
  async #restoreState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    const saved = readSavedExplorer(state);
    if (!saved) return;
    const { anchorAnnotationKey: annotationId, root, sourceFile } = saved;
    const item = saved.itemIndexedKey
      ? { id: saved.itemIndexedKey, title: saved.itemIndexedKey }
      : null;
    this.#update((session) =>
      setTarget(
        item,
        root,
        annotationId,
      )({
        ...session,
        collapsedSections: saved.collapsedSections,
        sourcePath: sourceFile,
        context: sourceFile
          ? {
              leaf: this.leaf,
              path: sourceFile,
              item,
              kind: "profile",
              root,
              annotationId,
              tab:
                root === "annotation"
                  ? "annotation"
                  : root === "filename"
                    ? "name"
                    : "note",
              advanced: false,
              // The workspace saves a Profile Explorer alone, which names no
              // Citation set and no Shared Partial; the editor supplies both
              // the moment it arrives.
              citation: null,
              partial: null,
              canInsertField: false,
            }
          : null,
      }),
    );
  }
  #presentationContext(): string {
    const { item, root, annotationId } = this.#state();
    return JSON.stringify([item?.id ?? null, root, annotationId]);
  }
  override getEphemeralState(): Record<string, unknown> {
    const { navigation, presentation } = this.#state();
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
    const saved = readEphemeralExplorer(input);
    if (!saved || saved.context !== this.#presentationContext()) return;
    const { navigation, presentation } = saved;
    const focus = (input as Record<string, unknown>).focus === true;
    this.#update((session) => ({
      ...session,
      navigation,
      presentation,
      restore: { ...presentation, focus },
    }));
  }
  protected override async onOpen(): Promise<void> {
    using cleanup = new DisposableStack();
    const { registry } = this.#deps;
    cleanup.defer(registerCompanionHistory(this));
    this.#release ??= holdExplorerModel(registry, this.#model);
    // A command runs while its atom is held; the view holds the export's.
    cleanup.defer(registry.mount(this.#exportCommand));
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
        if (this.#state().root === "annotation") void this.#chooseAnnotation();
        else void this.#chooseItem();
      },
    );
    cleanup.defer(
      subscribeWorkbenchSelection(this, {
        editor: () => this.#sourceEditor()?.leaf ?? null,
        apply: (selection) => {
          if (selection.kind === "item")
            this.#selectItem(selection.item, false);
          // The Citation set reaches this Explorer with the editor's authoring
          // context, which is the one place its own data reads it from.
          else if (selection.kind === "annotation") {
            const state = this.#state();
            if (state.annotationId !== selection.annotationId)
              this.#setTarget(state.item, state.root, selection.annotationId);
          }
        },
      }),
    );
    let previous = this.#state();
    cleanup.defer(
      registry.subscribe(this.#model.state, (state) => {
        const saved = previous;
        previous = state;
        updateSelectionTitle(this);
        syncSectionsAction();
        chooseAction.setAttribute(
          "aria-label",
          state.root === "annotation"
            ? m.workbench_choose_annotation()
            : m.workbench_choose_item(),
        );
        if (
          state.item?.id !== saved.item?.id ||
          state.root !== saved.root ||
          state.annotationId !== saved.annotationId ||
          state.collapsedSections !== saved.collapsedSections ||
          state.sourcePath !== saved.sourcePath
        )
          this.app.workspace.requestSaveLayout();
      }),
    );
    // Closing the leaf interrupts every host Effect the Explorer still runs.
    const runner = cleanup.use(makeViewRunner(registry));
    this.#run = runner.run;
    this.#host = cleanup.use(
      createTemplateWorkbenchHost(this.app, {
        run: runner.run,
        render: (request) =>
          Effect.succeed(
            failedRender(renderIdentity(request), { code: "render-error" }),
          ),
        // This view shows no Match.
        matchData: NO_MATCH_DATA,
        insertTarget: () => null,
      }),
    );
    this.#actions = createExplorerActions({
      onChooseItem: () => void this.#chooseItem(),
      onBackToNoteRoot: () => {
        this.#setTarget(this.#state().item, "note");
      },
      onToggleSections: () => this.#toggleSections(),
      onRefresh: () => this.#update(refresh),
      canExport: () => this.#exportTarget() !== null,
      onExport: () => void this.#export(),
      exportLabel: () =>
        this.#state().root === "annotation" &&
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
      this.#update(
        moveSource(oldPath, file.path, this.#editor?.authoringContext ?? null),
      );
    });
    cleanup.defer(() => this.app.vault.offref(rename));
    cleanup.defer(
      subscribeActiveTemplateWorkbench(
        this.app,
        (editor) => {
          this.#editor = editor;
          if (editor) this.#apply(editor.authoringContext);
          else this.#update(loseEditor);
        },
        this.leaf,
      ),
    );
    this.#mount();
    this.#cleanup = cleanup.move();
    updateSelectionTitle(this);
    if (this.#closed || this.#state().context) return;
    if (!this.#state().item) {
      const file = this.app.workspace.getActiveFile();
      const key = file
        ? itemKeyFromFrontmatter(this.app.metadataCache.getFileCache(file))
        : null;
      if (key) this.#setTarget({ id: key, title: key }, "note");
    } else this.#update(refresh);
  }
  #apply(context: TemplateAuthoringContext, explicit = false): void {
    if (!explicit && this.leaf.pinned && this.#state().context) {
      this.#update(keepPinnedContext(context));
      return;
    }
    this.#update(setContext(context));
  }
  #mount(): void {
    if (!this.#host || !this.#actions) return;
    this.#root?.render(
      <WorkbenchHostProvider host={this.#host}>
        <WorkbenchThemeProvider theme={templateWorkbenchTheme}>
          <ViewRegistryProvider registry={this.#deps.registry}>
            <ExplorerModelContext value={this.#model}>
              <ExplorerActionsContext value={this.#actions}>
                <Explorer
                  onSelectAnnotation={(id) => this.#selectAnnotation(id)}
                  onChooseAnnotation={() => void this.#chooseAnnotation()}
                  onSelectItem={(item) => this.#selectItem(item)}
                  onSearchItem={() => void this.#chooseItem(true)}
                  lookup={this.#deps.itemLookup}
                  explorer={{
                    copy: copyToClipboard,
                    onInsertNode: (node) => {
                      const editor = activeTemplateWorkbench(
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
            </ExplorerModelContext>
          </ViewRegistryProvider>
        </WorkbenchThemeProvider>
      </WorkbenchHostProvider>,
    );
  }
  #annotationKey(node: DisplayNode): string | null {
    const { item, root } = this.#state();
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
    const { item, root, annotationId, status } = this.#state();
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
      this.#deps.registry.set(this.#exportCommand, {
        ...target,
        pluginVersion: this.#deps.pluginVersion,
      });
  }
  #sourceEditor(): TemplateWorkbenchView | null {
    return this.#editor &&
      this.#state().context?.path === this.#editor.authoringContext.path
      ? this.#editor
      : null;
  }
  async #chooseItem(searchAll = false): Promise<void> {
    const editor = this.#sourceEditor();
    if (editor && !searchAll) {
      if (!this.#run) return;
      // The editor's chooser, on this leaf's runner until ticket 06.
      const selected = await answerOf(this.#run(editor.chooseItem()), false);
      if (selected && !this.#closed && editor === this.#sourceEditor())
        this.#apply(editor.authoringContext, true);
      return;
    }
    const host = this.#host;
    const run = this.#run;
    if (!host || !run) return;
    const generation = ++this.#choiceGeneration;
    const previous = this.#state().item;
    const deps = {
      app: this.app,
      lookup: this.#deps.itemLookup,
      settings: this.#deps.settings,
      bridge: this.#deps.bridge,
    };
    const item = await (searchAll
      ? searchWorkbenchItem(deps)
      : chooseWorkbenchItem({ run, host }, deps, previous ?? undefined));
    if (
      !item ||
      this.#closed ||
      generation !== this.#choiceGeneration ||
      this.#state().item !== previous
    )
      return;
    this.#selectItem(item);
  }
  #selectItem(item: WorkbenchItemChoice, notify = true): void {
    const state = this.#state();
    if (this.#closed) return;
    this.#setTarget(item, state.root, state.annotationId);
    if (!getSampleItem(item.id)) rememberTemplateItem(this.app, item.id);
    if (notify)
      publishWorkbenchSelection(
        this,
        { kind: "item", item },
        this.#sourceEditor()?.leaf ?? null,
      );
  }
  #selectAnnotation(id: string): void {
    const state = this.#state();
    this.#setTarget(state.item, "annotation", id);
    publishWorkbenchSelection(
      this,
      { kind: "annotation", annotationId: id },
      this.#sourceEditor()?.leaf ?? null,
    );
  }
  async #chooseAnnotation(): Promise<void> {
    const host = this.#host;
    if (!host) return;
    const state = this.#state();
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
      state.item === this.#state().item
    )
      this.#selectAnnotation(id);
  }
  protected override async onClose(): Promise<void> {
    this.#closed = true;
    this.#cleanup?.dispose();
    this.#cleanup = null;
    this.#root = null;
    this.#host = null;
    this.#run = null;
    this.#actions = null;
    this.#editor = null;
    this.#release?.();
    this.#release = null;
  }
}
