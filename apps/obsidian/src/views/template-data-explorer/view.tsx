// A native Explorer owns its data and navigation; workspace values supply its authoring context.
import { ItemView } from "obsidian";
import type { Menu, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { isChildItemFields, parseIndexedKey } from "@zotlit/db";
import type { DisplayNode } from "@zotlit/workbench/explorer";
import {
  failedRender,
  renderIdentity,
  SAMPLE_ANNOTATIONS,
} from "@zotlit/workbench/render";
import {
  WorkbenchHostProvider,
  WorkbenchThemeProvider,
} from "@zotlit/workbench/ui";

import * as m from "@/lib/i18n/generated/messages";
import { itemSummary } from "@/lib/item-summary";
import type { DatabaseService } from "@/services/database/service";
import { indexedKeyForClipboard } from "@/services/indexed-key/actions";
import { pickItem } from "@/services/item-lookup/search-modal";
import type { ItemLookup } from "@/services/item-lookup/service";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import type { SettingsService } from "@/services/settings/service";
import type { TemplateDataDeps } from "@/services/template-workbench/data";
import type { TemplateService } from "@/services/template/service";
import { subscribeActiveProfileEditor } from "@/views/note-preview/register";
import { createProfileEditorHost } from "@/views/profile-editor/host";
import { profileEditorTheme } from "@/views/profile-editor/theme";
import type { ProfileEditorView } from "@/views/profile-editor/view";

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
    return m.template_data_explorer_view_name();
  }
  override getIcon(): string {
    return "braces";
  }
  override onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    this.#actions?.addCopyKeyMenuItem(menu);
    menu.addItem((item) =>
      item
        .setSection("zotlit")
        .setTitle(m.template_data_explorer_refresh_tooltip())
        .setIcon("refresh-cw")
        .onClick(() => this.#session.refresh()),
    );
    this.#actions?.addExportMenuItem(menu);
  }
  override getState(): Record<string, unknown> {
    const { item, annotationId } = this.#session.state.getState();
    return item
      ? {
          itemIndexedKey: item.id,
          ...(annotationId ? { anchorAnnotationKey: annotationId } : {}),
        }
      : {};
  }
  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    await super.setState(state, result);
    if (!state || typeof state !== "object") return;
    const value = state as Record<string, unknown>;
    if (typeof value.itemIndexedKey !== "string") return;
    const annotationId =
      typeof value.anchorAnnotationKey === "string"
        ? value.anchorAnnotationKey
        : null;
    this.#session.setTarget(
      { id: value.itemIndexedKey, title: value.itemIndexedKey },
      annotationId ? "annotation" : "note",
      annotationId,
    );
  }
  protected override async onOpen(): Promise<void> {
    using cleanup = new DisposableStack();
    cleanup.use(this.#session);
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
        this.app.workspace.requestSaveLayout();
      },
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
        if (context.leaf === this.#editor?.leaf)
          this.#session.setContext(context);
      },
    );
    cleanup.defer(() => this.app.workspace.offref(event));
    cleanup.defer(
      subscribeActiveProfileEditor(
        this.app,
        (editor) => {
          this.#editor = editor;
          if (editor) this.#session.setContext(editor.authoringContext);
          else this.#session.state.setState({ context: null });
        },
        this.leaf,
      ),
    );
    cleanup.defer(this.#deps.db.on("changed", () => this.#session.refresh()));
    this.#mount();
    this.#cleanup = cleanup.move();
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
  #mount(): void {
    if (!this.#host || !this.#actions) return;
    this.#root?.render(
      <WorkbenchHostProvider host={this.#host}>
        <WorkbenchThemeProvider theme={profileEditorTheme}>
          <ExplorerStoreProvider value={this.#session.state}>
            <ExplorerActionsContext value={this.#actions}>
              <Explorer
                explorer={{
                  copy: (text) => navigator.clipboard.writeText(text),
                  engines: () =>
                    this.#deps.templates.javascriptTemplatesEnabled
                      ? ["liquid", "eta"]
                      : ["liquid"],
                  onInsertNode: (node) => {
                    const leaf = this.#session.state.getState().context?.leaf;
                    if (leaf)
                      this.app.workspace.trigger(
                        "zotlit:insert-template-field",
                        { leaf, node },
                      );
                  },
                  canExploreAnnotation: (node) =>
                    this.#annotationKey(node) !== null,
                  onExploreAnnotation: (node) => {
                    const key = this.#annotationKey(node);
                    if (key) {
                      this.#session.setTarget(
                        this.#session.state.getState().item,
                        "annotation",
                        key,
                      );
                      this.app.workspace.requestSaveLayout();
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
    return parsed
      ? indexedKeyForClipboard({ key: node.value.key, groupID: parsed.groupID })
      : null;
  }
  #exportTarget() {
    const { item, root, annotationId, status } = this.#session.state.getState();
    if (!item || (status !== "ready" && status !== "empty")) return null;
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
  async #chooseItem(): Promise<void> {
    if (this.#editor) {
      await this.#editor.chooseItem();
      return;
    }
    const hit = await pickItem(
      {
        app: this.app,
        lookup: this.#deps.itemLookup,
        settings: this.#deps.settings,
      },
      m.template_data_explorer_pick_placeholder(),
    );
    if (
      !hit ||
      this.#closed ||
      this.#editor ||
      isChildItemFields(hit.item.fields)
    )
      return;
    this.#session.setTarget(
      {
        id: hit.item.indexedKey,
        title: itemSummary(hit.item, hit.item.fields).formatted,
      },
      "note",
    );
    rememberTemplateItem(this.app, hit.item.indexedKey);
    this.app.workspace.requestSaveLayout();
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
