// ItemView orchestrator for the Template Data Explorer: picks an item, fetches its note-root context through inert resolvers, and drives the display tree.
import { ItemView } from "obsidian";
import type { Menu, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import {
  CollectionCache,
  fetchNoteContext,
  getZoteroIdentity,
  getItemsByKey,
  getLibraries,
  isChildItemFields,
  parseIndexedKey,
  USER_LIBRARY_ID,
} from "@zotlit/db";
import type { Item, Library, NoteTemplateContext } from "@zotlit/db";
import {
  annotationKeyAtPath,
  findAnnotationRoot,
} from "@zotlit/workbench/explorer";
import { failedRender, renderIdentity } from "@zotlit/workbench/render";
import {
  WorkbenchHostProvider,
  WorkbenchThemeProvider,
} from "@zotlit/workbench/ui";

import * as m from "@/lib/i18n/generated/messages";
import { itemSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import * as toast from "@/lib/toast";
import type { DatabaseService } from "@/services/database/service";
import { indexedKeyForClipboard } from "@/services/indexed-key/actions";
import type { ItemLookup } from "@/services/item-lookup/service";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import type { SettingsService } from "@/services/settings/service";
import type { TemplateDataDeps } from "@/services/template-workbench/data";
import {
  buildObsidianInertNoteResolvers,
  findExistingLitNote,
  resolveObsidianExcerptImageContext,
} from "@/services/template/inert-resolver-host";
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
import { pickItem } from "./item-picker";
import { ProfileExplorer } from "./profile-explorer";
import { createExplorerStore, ExplorerStoreProvider } from "./store";
import type { ExplorerState } from "./store";

export const EXPLORER_VIEW_TYPE = "zotlit-template-data-explorer";

const logger = getLogger(["views", "template-data-explorer"]);

/** Extends the Workbench loader's deps: the export rebuilds its data through it. */
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
  /** Installed plugin version, stamped into the Template Data Export. */
  pluginVersion: string;
}

function resolveLibraryID(
  groupID: number | null,
  libraries: readonly Library[] | null,
): number | null {
  if (groupID === null) return USER_LIBRARY_ID;
  if (!libraries) return null;
  return libraries.find((l) => l.groupID === groupID)?.libraryID ?? null;
}

export class TemplateDataExplorerView extends ItemView {
  readonly #store = createExplorerStore();
  readonly #deps: ExplorerViewDeps;
  #root: Root | null = null;
  #host: ReturnType<typeof createProfileEditorHost> | null = null;
  #actions: ExplorerActions | null = null;
  #activeEditor: ProfileEditorView | null = null;
  #context: NoteTemplateContext | null = null;
  #item: Item | null = null;
  #itemIndexedKey: string | null = null;
  #anchorKey: string | null = null;
  #pendingRestoreKey: string | null = null;
  #pendingRestoreAnchor: string | null = null;
  #didInitialLoad = false;

  constructor(leaf: WorkspaceLeaf, deps: ExplorerViewDeps) {
    super(leaf);
    this.contentEl.addClass("zt-root");
    this.#deps = deps;
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
        .onClick(() => this.#refresh()),
    );
    this.#actions?.addExportMenuItem(menu);
  }

  override getState(): Record<string, unknown> {
    if (!this.#itemIndexedKey) return {};
    return {
      itemIndexedKey: this.#itemIndexedKey,
      ...(this.#anchorKey !== null
        ? { anchorAnnotationKey: this.#anchorKey }
        : {}),
    };
  }

  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    await super.setState(state, result);
    if (!state || typeof state !== "object") return;
    const s = state as Record<string, unknown>;
    if (typeof s.itemIndexedKey !== "string") return;

    const key = s.itemIndexedKey;
    const anchorKey =
      typeof s.anchorAnnotationKey === "string" ? s.anchorAnnotationKey : null;
    if (this.#didInitialLoad && this.#deps.db.state === "ready") {
      // Re-opening the already-shown target keeps the user's exploration;
      // any item or anchor change starts from fresh navigation state.
      const sameTarget =
        key === this.#itemIndexedKey && anchorKey === this.#anchorKey;
      this.#restoreItem(key);
      if (!sameTarget) this.#anchorKey = anchorKey;
      this.#reload();
    } else {
      this.#pendingRestoreKey = key;
      this.#pendingRestoreAnchor = anchorKey;
    }
  }

  protected override async onOpen(): Promise<void> {
    this.#actions = createExplorerActions({
      onChooseItem: () => this.#chooseItem(),
      onBackToNoteRoot: () => this.#setAnchor(null),
      onRefresh: () => this.#refresh(),
      canExport: () =>
        this.#activeEditor
          ? this.#activeEditor.templateDataTarget() !== null
          : this.#context !== null && this.#item !== null,
      onExport: () => void this.#exportTemplateData(),
      exportLabel: () =>
        this.#activeEditor?.templateDataExportLabel() ??
        m.template_data_explorer_menu_export_json(),
      copyTarget: () => {
        const active = this.#activeEditor?.templateDataTarget();
        if (this.#activeEditor)
          return active
            ? {
                indexedKey: active.indexedKey,
                kind: active.root === "annotation" ? "annotation" : "item",
              }
            : null;
        const target = this.#anchoredTarget();
        if (!target) return null;
        return {
          indexedKey: target.indexedKey,
          kind: target.isAnnotation ? "annotation" : "item",
        };
      },
    });

    this.#host = createProfileEditorHost(this.app, {
      render: (request, deliver) => {
        deliver(
          failedRender(renderIdentity(request), { code: "render-error" }),
        );
        return { terminate() {} };
      },
      matchData: {
        tags: async () => [],
        collections: async () => [],
        libraries: async () => [],
      },
      insertTarget: () => null,
    });
    this.#root = createRoot(this.contentEl);
    this.register(
      subscribeActiveProfileEditor(this.app, (editor) => {
        logger.debug("Explorer editor handoff", {
          previousProfile: this.#activeEditor?.file?.path ?? null,
          profile: editor?.file?.path ?? null,
          root: editor?.store.getState().root ?? null,
          mode: editor?.preview ? "profile" : "standalone",
        });
        this.#activeEditor = editor;
        this.#mount();
      }),
    );

    this.register(
      this.#deps.db.on("changed", () => {
        logger.debug("DB changed, refreshing template data explorer");
        this.#reload();
      }),
    );

    this.#syncDbReady();
    await this.#deps.db.ready;
    this.#syncDbReady();
    this.#initialLoad();
  }

  #mount(): void {
    const editor = this.#activeEditor;
    if (editor?.preview) {
      this.#root?.render(
        editor.provide(
          <ProfileExplorer
            editor={editor}
            deps={this.#deps}
            isEtaEnabled={() => this.#deps.templates.javascriptTemplatesEnabled}
          />,
        ),
      );
      return;
    }
    if (!this.#host || !this.#actions) return;
    this.#root?.render(
      <WorkbenchHostProvider host={this.#host}>
        <WorkbenchThemeProvider theme={profileEditorTheme}>
          <ExplorerStoreProvider value={this.#store}>
            <ExplorerActionsContext value={this.#actions}>
              <Explorer
                explorer={{
                  copy: (text) => navigator.clipboard.writeText(text),
                  engines: () =>
                    this.#deps.templates.javascriptTemplatesEnabled
                      ? ["liquid", "eta"]
                      : ["liquid"],
                  canExploreAnnotation: (node) =>
                    this.#anchorKey === null &&
                    this.#context !== null &&
                    annotationKeyAtPath(this.#context, node.path) !== null,
                  onExploreAnnotation: (node) => {
                    if (this.#context)
                      this.#setAnchor(
                        annotationKeyAtPath(this.#context, node.path),
                      );
                  },
                }}
              />
            </ExplorerActionsContext>
          </ExplorerStoreProvider>
        </WorkbenchThemeProvider>
      </WorkbenchHostProvider>,
    );
  }

  protected override async onClose(): Promise<void> {
    this.#root?.unmount();
    this.#root = null;
    this.#host?.[Symbol.dispose]();
    this.#host = null;
    this.#actions = null;
  }

  #syncDbReady(): void {
    this.#store.setState({ dbReady: this.#deps.db.state === "ready" });
  }

  #initialLoad(): void {
    if (this.#didInitialLoad) return;
    if (this.#deps.db.state !== "ready") return;
    this.#didInitialLoad = true;
    if (this.#pendingRestoreKey) {
      this.#restoreItem(this.#pendingRestoreKey);
      this.#pendingRestoreKey = null;
      this.#anchorKey = this.#pendingRestoreAnchor;
      this.#pendingRestoreAnchor = null;
    } else if (this.#item === null) {
      this.#seedFromActiveNote();
    }
    this.#reload();
  }

  #refresh(): void {
    void toast.promise(this.#deps.db.refresh(), {
      loading: m.template_data_explorer_refreshing(),
      success: m.template_data_explorer_refreshed(),
      error: m.template_data_explorer_refresh_failed(),
    });
  }

  /** The object the pane is anchored at: the Item, or the Annotation once re-anchored. */
  #anchoredTarget(): { indexedKey: string; isAnnotation: boolean } | null {
    const item = this.#item;
    if (!item) return null;
    const anchorKey = this.#anchorKey;
    if (anchorKey === null) {
      return { indexedKey: item.indexedKey, isAnnotation: false };
    }
    return {
      indexedKey: indexedKeyForClipboard({
        key: anchorKey,
        groupID: item.groupID,
      }),
      isAnnotation: true,
    };
  }

  async #exportTemplateData(): Promise<void> {
    const active = this.#activeEditor?.templateDataTarget();
    const own = this.#anchoredTarget();
    const target = this.#activeEditor
      ? active
      : own
        ? {
            indexedKey: own.indexedKey,
            root: own.isAnnotation
              ? ("annotation" as const)
              : ("note" as const),
          }
        : null;
    if (target)
      await exportTemplateDataFile(this.#deps, {
        ...target,
        pluginVersion: this.#deps.pluginVersion,
      });
  }

  #reload(): void {
    this.#syncDbReady();
    if (this.#deps.db.state !== "ready") return;
    if (this.#itemIndexedKey === null) {
      this.#clearItem();
      return;
    }

    const refreshed = this.#resolveItem(this.#itemIndexedKey);
    if (!refreshed) {
      logger.debug("Explored item {indexedKey} vanished from library", {
        indexedKey: this.#itemIndexedKey,
      });
      this.#item = null;
      this.#context = null;
      this.#store.setState({
        data: null,
        anchor: null,
        itemVanished: true,
      });
      return;
    }
    this.#item = refreshed;
    this.#store.setState({ itemVanished: false });
    void this.#buildTree();
  }

  async #buildTree(): Promise<void> {
    const item = this.#item;
    if (!item) return;
    if (isChildItemFields(item.fields)) return;

    const settings = await this.#deps.settings.loaded;
    const litNote = findExistingLitNote(this.#deps.noteIndex, {
      indexedKey: item.indexedKey,
    });
    const excerptImages = await resolveObsidianExcerptImageContext({
      app: this.#deps.app,
      settings,
      litNotePath: litNote?.path ?? null,
    });

    // Stale guard: another #buildTree may have run (and won) while we awaited.
    if (this.#item !== item) return;

    const resolvers = buildObsidianInertNoteResolvers({
      noteIndex: this.#deps.noteIndex,
      fileManager: this.#deps.app.fileManager,
      vault: this.#deps.app.vault,
      zoteroPref: this.#deps.zoteroPref,
      sourcePath: litNote?.path ?? "",
      excerptImages,
    });

    try {
      this.#context = fetchNoteContext(this.#deps.db.client, item, {
        resolvers,
        collectionCache: new CollectionCache(),
        username: getZoteroIdentity(this.#deps.db.client).username,
      });
    } catch (err) {
      logger.warn("Failed to build note context for {key}", {
        key: item.key,
        error: err,
      });
      this.#clearItem();
      return;
    }
    const summary = itemSummary(item, item.fields);
    this.#store.setState({
      itemLabel: summary.formatted,
      ...this.#render(),
    });
  }

  #clearItem(): void {
    this.#item = null;
    this.#itemIndexedKey = null;
    this.#context = null;
    this.#resetNavigationState();
    this.#store.setState({
      itemLabel: null,
      data: null,
      itemVanished: false,
    });
  }

  #resetNavigationState(): void {
    this.#anchorKey = null;
    this.#store.setState({ anchor: null });
  }

  #render(): Pick<ExplorerState, "data" | "anchor"> {
    const root = this.#resolveRoot();
    return {
      data: (root?.object as Record<string, unknown>) ?? null,
      anchor: root?.anchor ?? null,
    };
  }

  #resolveRoot(): {
    object: object;
    anchor: ExplorerState["anchor"];
  } | null {
    if (!this.#context) return null;

    if (this.#anchorKey !== null) {
      const anchorKey = this.#anchorKey;
      const annotation = findAnnotationRoot(this.#context, anchorKey);
      if (annotation !== null) {
        return {
          object: annotation,
          anchor: {
            key: anchorKey,
            label: this.#formatAnnotationLabel(annotation),
          },
        };
      }
      logger.debug(
        "Anchored annotation {key} vanished; falling back to note root",
        { key: anchorKey },
      );
      this.#anchorKey = null;
      this.#deps.app.workspace.requestSaveLayout();
    }

    return { object: this.#context, anchor: null };
  }

  #formatAnnotationLabel(annotation: {
    text: string | null;
    type: string;
  }): string {
    const text = annotation.text?.trim();
    if (text) return text.length > 40 ? `${text.slice(0, 40)}…` : text;
    return annotation.type;
  }

  #setAnchor(key: string | null): void {
    this.#anchorKey = key;
    this.#store.setState(this.#render());
    this.#deps.app.workspace.requestSaveLayout();
  }

  #chooseItem(): void {
    void pickItem({
      app: this.#deps.app,
      lookup: this.#deps.itemLookup,
      settings: this.#deps.settings,
    }).then((hit) => {
      if (!hit) return;
      this.#item = hit.item;
      this.#itemIndexedKey = hit.item.indexedKey;
      rememberTemplateItem(this.#deps.app, hit.item.indexedKey);
      this.#resetNavigationState();
      this.#store.setState({ itemVanished: false });
      this.#reload();
      this.#deps.app.workspace.requestSaveLayout();
    });
  }

  #seedFromActiveNote(): void {
    const activeFile = this.#deps.app.workspace.getActiveFile();
    if (!activeFile) return;
    const cache = this.#deps.app.metadataCache.getFileCache(activeFile);
    const indexedKey = itemKeyFromFrontmatter(cache);
    if (!indexedKey) return;
    const item = this.#resolveItem(indexedKey);
    if (item) {
      this.#item = item;
      this.#itemIndexedKey = indexedKey;
      rememberTemplateItem(this.#deps.app, indexedKey);
    }
  }

  #restoreItem(indexedKey: string): void {
    this.#itemIndexedKey = indexedKey;
    this.#item = this.#resolveItem(indexedKey);
    if (this.#item) rememberTemplateItem(this.#deps.app, indexedKey);
  }

  #resolveItem(indexedKey: string): Item | null {
    const parsed = parseIndexedKey(indexedKey);
    if (!parsed) return null;
    try {
      const libraryID = resolveLibraryID(
        parsed.groupID,
        getLibraries(this.#deps.db.client),
      );
      if (libraryID === null) return null;
      return (
        getItemsByKey(this.#deps.db.client, libraryID, [parsed.key])[0] ?? null
      );
    } catch (err) {
      logger.warn("Failed to resolve item for {indexedKey}", {
        indexedKey,
        error: err,
      });
      return null;
    }
  }
}
