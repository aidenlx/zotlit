// ItemView orchestrator for the Template Data Explorer: picks an item, fetches its note-root context through inert resolvers, and drives the display tree.
import { ItemView } from "obsidian";
import type { App, Menu, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import {
  CollectionCache,
  fetchNoteContext,
  getCurrentUsername,
  getItemsByKey,
  getLibraries,
  isChildItemFields,
  parseIndexedKey,
  USER_LIBRARY_ID,
} from "@zotlit/db";
import type { Item, Library, NoteTemplateContext } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { itemSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import * as toast from "@/lib/toast";
import type { DatabaseService } from "@/services/database/service";
import { indexedKeyForClipboard } from "@/services/indexed-key/actions";
import type { ItemLookup } from "@/services/item-lookup/service";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import type { NoteIndex } from "@/services/note-index/service";
import type { SettingsService } from "@/services/settings/service";
import {
  buildInertNoteResolvers,
  findExistingLitNote,
  resolveExcerptImageContext,
} from "@/services/template/inert-resolvers";
import type { TemplateService } from "@/services/template/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { createExplorerActions, ExplorerActionsContext } from "./actions";
import type { ExplorerActions } from "./actions";
import {
  annotationKeyAtPath,
  buildDisplayTree,
  buildFilteredDisplayTree,
  findAnnotationRoot,
} from "./display-tree";
import { Explorer } from "./Explorer";
import { pickItem } from "./item-picker";
import { createExplorerStore, ExplorerStoreProvider } from "./store";
import type { ExplorerState } from "./store";
import {
  initialTreeState,
  setAnchor,
  setFilter,
  toggleNode,
} from "./tree-state";
import type { TreeState } from "./tree-state";

export const EXPLORER_VIEW_TYPE = "zotlit-template-data-explorer";

const logger = getLogger(["views", "template-data-explorer"]);

export interface ExplorerViewDeps {
  app: App;
  db: Pick<DatabaseService, "state" | "client" | "ready" | "on" | "refresh">;
  noteIndex: Pick<NoteIndex, "getNotesByItemKey" | "getImportedNoteByNoteKey">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir" | "baseAttachmentPath">;
  itemLookup: Pick<ItemLookup, "search">;
  settings: SettingsService;
  templates: Pick<TemplateService, "javascriptTemplatesEnabled">;
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
  #actions: ExplorerActions | null = null;
  #context: NoteTemplateContext | null = null;
  #item: Item | null = null;
  #itemIndexedKey: string | null = null;
  #treeState: TreeState = initialTreeState();
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
  }

  override getState(): Record<string, unknown> {
    if (!this.#itemIndexedKey) return {};
    return {
      itemIndexedKey: this.#itemIndexedKey,
      ...(this.#treeState.anchorKey !== null
        ? { anchorAnnotationKey: this.#treeState.anchorKey }
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
        key === this.#itemIndexedKey && anchorKey === this.#treeState.anchorKey;
      this.#restoreItem(key);
      if (!sameTarget) this.#treeState = initialTreeState(anchorKey);
      this.#reload();
    } else {
      this.#pendingRestoreKey = key;
      this.#pendingRestoreAnchor = anchorKey;
    }
  }

  protected override async onOpen(): Promise<void> {
    this.#actions = createExplorerActions({
      onChooseItem: () => this.#chooseItem(),
      onToggle: (key) => this.#toggle(key),
      onFilter: (query) => this.#setFilter(query),
      annotationKeyAt: (node) => {
        if (this.#treeState.anchorKey !== null || !this.#context) return null;
        return annotationKeyAtPath(this.#context, node.path);
      },
      onAnchorAnnotation: (key) => this.#setAnchor(key),
      onBackToNoteRoot: () => this.#setAnchor(null),
      onRefresh: () => this.#refresh(),
      isEtaEnabled: () => this.#deps.templates.javascriptTemplatesEnabled,
      copyTarget: () => {
        const item = this.#item;
        if (!item) return null;
        const annotationKey = this.#treeState.anchorKey;
        if (annotationKey === null) {
          return { indexedKey: item.indexedKey, kind: "item" };
        }
        return {
          indexedKey: indexedKeyForClipboard({
            key: annotationKey,
            groupID: item.groupID,
          }),
          kind: "annotation",
        };
      },
    });

    this.#root = createRoot(this.contentEl);
    this.#root.render(
      <ExplorerStoreProvider value={this.#store}>
        <ExplorerActionsContext value={this.#actions}>
          <Explorer />
        </ExplorerActionsContext>
      </ExplorerStoreProvider>,
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

  protected override async onClose(): Promise<void> {
    this.#root?.unmount();
    this.#root = null;
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
      this.#treeState = initialTreeState(this.#pendingRestoreAnchor);
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
        nodes: null,
        anchor: null,
        matchedKeys: null,
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
    const excerptImages = await resolveExcerptImageContext({
      app: this.#deps.app,
      settings,
      litNotePath: litNote?.path ?? null,
    });

    // Stale guard: another #buildTree may have run (and won) while we awaited.
    if (this.#item !== item) return;

    const resolvers = buildInertNoteResolvers({
      noteIndex: this.#deps.noteIndex,
      fileManager: this.#deps.app.fileManager,
      vault: this.#deps.app.vault,
      zoteroPref: this.#deps.zoteroPref,
      Turndown: TurndownService,
      sourcePath: litNote?.path ?? "",
      excerptImages,
    });

    try {
      this.#context = fetchNoteContext(this.#deps.db.client, item, {
        resolvers,
        collectionCache: new CollectionCache(),
        username: getCurrentUsername(this.#deps.db.client),
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

  #toggle(key: string): void {
    this.#treeState = toggleNode(this.#treeState, key);
    if (!this.#context) return;
    this.#store.setState(this.#render());
  }

  #clearItem(): void {
    this.#item = null;
    this.#itemIndexedKey = null;
    this.#context = null;
    this.#resetNavigationState();
    this.#store.setState({
      itemLabel: null,
      nodes: null,
      itemVanished: false,
    });
  }

  #resetNavigationState(): void {
    this.#treeState = initialTreeState();
    this.#store.setState({ anchor: null, filterQuery: "", matchedKeys: null });
  }

  /** Resolves `#treeState.anchorKey` exactly once: builds the anchored (or note-root) tree, and falls back to the note root when the anchored annotation has vanished. */
  #render(): Pick<
    ExplorerState,
    "nodes" | "anchor" | "matchedKeys" | "filterQuery"
  > {
    if (!this.#context) {
      return { nodes: [], anchor: null, matchedKeys: null, filterQuery: "" };
    }

    const root = this.#resolveRoot();
    // Read after resolving: the vanish-fallback inside #resolveRoot may have
    // reset #treeState (including filterQuery) via setAnchor.
    const filterQuery = this.#treeState.filterQuery;
    if (root === null) {
      return { nodes: [], anchor: null, matchedKeys: null, filterQuery };
    }

    if (filterQuery) {
      const { nodes, matchedKeys } = buildFilteredDisplayTree(
        root.object,
        filterQuery,
        { collapsed: this.#treeState.filterCollapsed },
      );
      return { nodes, anchor: root.anchor, matchedKeys, filterQuery };
    }

    return {
      nodes: buildDisplayTree(root.object, {
        expanded: this.#treeState.expanded,
      }),
      anchor: root.anchor,
      matchedKeys: null,
      filterQuery,
    };
  }

  #resolveRoot(): {
    object: object;
    anchor: ExplorerState["anchor"];
  } | null {
    if (!this.#context) return null;

    if (this.#treeState.anchorKey !== null) {
      const anchorKey = this.#treeState.anchorKey;
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
      this.#treeState = setAnchor(this.#treeState, null);
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
    this.#treeState = setAnchor(this.#treeState, key);
    this.#store.setState(this.#render());
    this.#deps.app.workspace.requestSaveLayout();
  }

  #setFilter(query: string): void {
    this.#treeState = setFilter(this.#treeState, query);
    this.#store.setState(this.#render());
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
    }
  }

  #restoreItem(indexedKey: string): void {
    this.#itemIndexedKey = indexedKey;
    this.#item = this.#resolveItem(indexedKey);
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
