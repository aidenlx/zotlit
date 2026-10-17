// The Library View: a main-area tab that hosts the Query View without a file,
// beside the Library Tree. Its Library View Document in plugin data says what
// the tab shows; the tab derives the Query View's text and its Libraries from
// it, and a toolbar change or a tree selection saves back into it. The tab
// reads Zotero's database only, so Zotero does not need to run.
//
// @see apps/obsidian/docs/adr/0070-the-library-view-is-a-fileless-query-view-host-that-saves-to-plugin-data.md
import { debounce, ItemView, Keymap, Scope } from "obsidian";
import type { Component, Modifier, WorkspaceLeaf } from "obsidian";
import { createStore } from "zustand/vanilla";

import { parseIndexedKey } from "@zotlit/db";

import { Effect } from "@/lib/effect";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import type {
  LibraryScope,
  LibrarySelector,
} from "@/services/library-scope/scope";
import type { LibraryScopeService } from "@/services/library-scope/service";
import { inTextEntry } from "@/services/pdf-annotation-editor/capability-affordance";
import type { SettingsService } from "@/services/settings/service";
import { saveAsQueryFile } from "@/views/annot-view/save-query-file";
import { ITEM_ROW_ATTRIBUTE } from "@/views/query-view/item-rows";
import type { ItemRowGestures } from "@/views/query-view/item-rows";
import { QueryView } from "@/views/query-view/view";
import type { QueryViewDeps } from "@/views/query-view/view";
import { WelcomeBanner } from "@/views/welcome/banner";
import type { WelcomeBannerDeps } from "@/views/welcome/banner";
import { unavailable } from "@/views/welcome/connection";

import { LIBRARY_LAYOUTS } from "./document";
import type { LibraryNode, ReadingStateFacet } from "./document";
import { ZOTLIT_MARK_ICON } from "./icon";
import type { ItemActions } from "./item-actions";
import { createItemDrag, refuseItemDrop } from "./item-drag";
import { LibraryTree } from "./library-tree";
import type { LibraryTreeDeps } from "./library-tree";
import { ZoteroNotFound } from "./not-found";
import {
  libraryViewQuery,
  libraryViewQueryFileText,
  vaultPass,
} from "./query-text";
import type { LibraryViewLabels, LibraryViewQuery } from "./query-text";
import { rowMenu } from "./row-menu";
import { LibrarySearch } from "./search-box";
import type { LibrarySearchDeps, SearchFound } from "./search-box";
import { libraryViewStorage } from "./storage";
import { sameLibrary } from "./tree";
import "./style.css";

const logger = getLogger(["library-view"]);

export const LIBRARY_VIEW_TYPE = "zotlit-library";

export interface LibraryViewDeps extends QueryViewDeps {
  settings: Pick<SettingsService, "update" | "flush" | "current" | "loaded">;
  libraryScope: QueryViewDeps["libraryScope"] &
    LibraryTreeDeps["libraryScope"] &
    Pick<LibraryScopeService, "effective">;
  lookup: LibrarySearchDeps["lookup"];
  /** What a row does with its Item. */
  items: ItemActions;
  /** The Welcome View banner above the tab, and its setup actions. ADR 0076. */
  welcome: WelcomeBannerDeps;
}

/**
 * The controls in the view that answer Enter and the arrow keys themselves:
 * links, buttons (an icon button, such as the Welcome View banner's dismiss,
 * is a `role="button"`), menus, list boxes, and the Library Tree.
 */
const OWN_KEYS =
  'a, button, [role="button"], [role="menu"], [role="menuitem"], [role="listbox"], [role="combobox"], [role="tree"]';

/**
 * What Enter does on the selected row, by its modifiers, as in the quick
 * switcher: Mod opens in a new tab.
 */
const ENTER_ACTIONS: readonly (readonly [
  Modifier[],
  (items: ItemActions, key: string) => unknown,
])[] = [
  [[], (items, key) => items.openNote(key, false)],
  [["Mod"], (items, key) => items.openNote(key, "tab")],
  [["Shift"], (items, key) => items.openPdf(key, false)],
  [["Mod", "Shift"], (items, key) => items.openPdf(key, "tab")],
];

export class LibraryView extends ItemView {
  override scope: Scope;
  readonly query: QueryView;
  readonly tree: LibraryTree;
  readonly search: LibrarySearch;
  readonly #deps: LibraryViewDeps;
  readonly #storage: ReturnType<typeof libraryViewStorage>;
  /** The not-found state and the Welcome View banner, while the tab is open. */
  readonly #parts: Component[] = [];
  /** What the tab runs: the query of the document as it opened. */
  #shown: LibraryViewQuery | null = null;
  /** What the search last found, which a facet change lists again. */
  #found: SearchFound = { text: "" };
  /** The selected row, by its Item's Indexed Key. */
  readonly selection = createStore<{ key: string | null }>(() => ({
    key: null,
  }));
  /** The write of the search text that the box last asked for. */
  #saving: Promise<void> = Promise.resolve();
  /** Keep the search text once typing pauses. */
  readonly #keep = debounce(
    (text: string) => {
      this.#saving = this.#storage.search(text).catch((error: unknown) => {
        logger.warn("The Library View could not keep the search", { error });
      });
    },
    500,
    true,
  );

  constructor(leaf: WorkspaceLeaf, deps: LibraryViewDeps) {
    super(leaf);
    this.#deps = deps;
    this.scope = new Scope(deps.app.scope);
    this.contentEl.addClass("zt-root", "zt-library-view");
    this.contentEl.dataset.libraryView = "";
    this.#storage = libraryViewStorage(deps.settings);
    const drag = createItemDrag({ app: deps.app, actions: deps.items });
    const rows: ItemRowGestures = {
      selection: this.selection,
      select: (key) => this.selection.setState({ key }),
      open: (key, event) =>
        void deps.items.openPdf(key, Keymap.isModEvent(event)),
      menu: (key, event) =>
        rowMenu(
          {
            actions: deps.items,
            literatureNotes: deps.literatureNotes,
            workspace: deps.app.workspace,
          },
          key,
        ).showAtMouseEvent(event),
      drag,
    };
    this.register(() => drag.cancel());
    this.#registerRowKeys();
    this.query = new QueryView(deps, {
      scope: this.scope,
      sourcePath: () => "",
      context: () => undefined,
      // The view runs once the tab has set its text, after the query.
      libraries: () => this.#shown!.libraries,
      rank: () => this.#shown!.rank,
      // The document keeps the sort, the Layout and the Visible Properties.
      displayOnly: true,
      layouts: LIBRARY_LAYOUTS,
      // Has note, and the Literature Note half of Unread, the vault answers.
      rowPass: () =>
        this.#shown && vaultPass(this.#shown.vault, deps.literatureNotes),
      rows,
      // Recent says why each row is there; the query runs once the tab set it.
      reason: () => this.#shown!.reason,
      save: this.#storage.save,
      saveAs: () => void this.#saveAs(),
      layout: {
        // Otherwise Obsidian moves focus to the last navigable leaf, which in
        // the main area switches the tab away from this view.
        onEscape: () => {
          const { leftSplit, rightSplit } = deps.app.workspace;
          const root = this.leaf.getRoot();
          if (root === leftSplit || root === rightSplit) return;
          return false;
        },
      },
    });
    this.tree = new LibraryTree(deps, {
      select: (node) => this.#select(node),
      filter: (facets) => this.#filter(facets),
    });
    this.search = new LibrarySearch(deps, {
      node: () => this.tree.store.getState().node,
      found: (found) => this.#show(found),
      keep: (text) => this.#keep(text),
      // ZotLit cannot read Zotero's database: the search box asks nothing.
      readable: () => !unavailable(deps.welcome),
    });
  }

  /** Settles once the list shows the newest search. Never rejects. */
  get searched(): Promise<void> {
    return this.search.settled;
  }

  override getViewType(): string {
    return LIBRARY_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return m.library_view_name();
  }

  override getIcon(): string {
    return ZOTLIT_MARK_ICON;
  }

  protected override async onOpen(): Promise<void> {
    // An Item dragged from a row lands in a note, never back in the view.
    this.registerDomEvent(this.contentEl, "dragover", refuseItemDrop);
    // The Welcome View banner sits above the tree and the list, and takes
    // at most half the tab.
    const column = this.contentEl.createDiv({
      cls: "zt:flex zt:h-full zt:flex-col",
    });
    const banner = column.createDiv({
      cls: "zt:max-h-1/2 zt:shrink-0 zt:overflow-y-auto",
    });
    const shell = column.createDiv({
      cls: "zt:group zt:@container zt:relative zt:flex zt:min-h-0 zt:flex-1",
    });
    const treeEl = shell.createDiv({
      cls: "zt:hidden zt:w-56 zt:shrink-0 zt:overflow-y-auto zt:border-e-(length:--border-width) zt:border-(--divider-color) zt:bg-(--background-primary) zt:@xl:block zt:group-data-tree-open:block zt:@max-xl:absolute zt:@max-xl:inset-y-0 zt:@max-xl:start-0 zt:@max-xl:max-w-[85%] zt:@max-xl:z-(--layer-popover) zt:@max-xl:shadow-(--shadow-s)",
      attr: { "data-library-tree": "" },
    });
    const main = shell.createDiv({
      cls: "zt:flex zt:min-w-0 zt:flex-1 zt:flex-col zt:overflow-y-auto zt:pb-[max(var(--safe-area-inset-bottom),var(--size-4-8))]",
    });
    // Where ZotLit cannot read Zotero's database, the tree and the list say
    // so in place of what they hold; the search box and the header's count
    // go with them.
    const hidden = "zt:group-data-zotero-missing:hidden";
    const searchEl = main.createDiv({ cls: hidden });
    const header = main.createDiv({ cls: hidden });
    const list = main.createDiv();
    const shown = "zt:hidden zt:group-data-zotero-missing:block";
    this.#parts.push(
      new ZoteroNotFound(
        this.#deps.welcome,
        {
          shell,
          tree: treeEl.createDiv({ cls: shown }),
          list: list.createDiv({ cls: shown }),
        },
        // The search the box holds runs again on the database found.
        () => void this.search.run(),
      ),
      new WelcomeBanner(this.#deps.welcome, banner),
    );
    for (const part of this.#parts) part.load();
    this.tree.load();
    this.tree.render(treeEl.createDiv({ cls: hidden }));
    this.tree.renderHeader(header, (text) =>
      this.search.summary(this.query.state, text),
    );
    this.search.load();
    this.search.render(searchEl);
    // On a narrow pane the tree shows over the list while it is open.
    this.tree.register(
      this.tree.store.subscribe(({ open }) =>
        shell.toggleAttribute("data-tree-open", open),
      ),
    );
    // A press on the list beside it puts the tree away.
    main.addEventListener("pointerdown", (event) => {
      if (!this.tree.store.getState().open) return;
      const target = event.target as Node;
      if (
        target.instanceOf(HTMLElement) &&
        target.closest("[data-library-tree-toggle]")
      )
        return;
      this.tree.setOpen(false);
    });
    this.query.load();
    this.query.render(list.createDiv({ cls: hidden }));
    // A Literature Note added or removed changes what the vault answers.
    this.query.register(
      this.#deps.literatureNotes.on("changed", () => {
        if (this.#shown && this.#shown.vault.length > 0) this.query.refresh();
      }),
    );
    // A tab that the workspace restores on startup can open before plugin
    // data has loaded.
    await this.#deps.settings.loaded;
    const doc = this.#storage.document();
    this.tree.show(doc.node);
    this.tree.showFacets(doc.facets);
    this.tree.refresh();
    await this.search.open(doc.search);
  }

  /**
   * The row keys of the quick switcher (ADR 0073): ↑ and ↓ move the
   * selection; Enter opens the selected row's Literature Note, or writes it,
   * Mod+Enter in a new pane; Shift+Enter opens its PDF.
   */
  #registerRowKeys(): void {
    for (const [key, step] of [
      ["ArrowUp", -1],
      ["ArrowDown", 1],
    ] as const)
      this.scope.register([], key, (event) => {
        if (!this.#onList(event.target)) return;
        if (this.#move(step)) return false;
      });
    for (const [modifiers, act] of ENTER_ACTIONS)
      this.scope.register(modifiers, "Enter", (event) => {
        if (!this.#onList(event.target)) return;
        const key = this.#selectedRow()?.getAttribute(ITEM_ROW_ATTRIBUTE);
        if (!key) return;
        void act(this.#deps.items, key);
        return false;
      });
  }

  /** Whether a key landed on the list, and not on a control that takes it. */
  #onList(target: EventTarget | null): boolean {
    if (inTextEntry(target)) return false;
    const node = target as Node | null;
    return !(node?.instanceOf(Element) && node.closest(OWN_KEYS) !== null);
  }

  /** The Item rows on screen, in the order they show. */
  #rows(): HTMLElement[] {
    return [
      ...this.contentEl.querySelectorAll<HTMLElement>(
        `[${ITEM_ROW_ATTRIBUTE}]`,
      ),
    ];
  }

  /** The row of the selected Item, while one shows. */
  #selectedRow(): HTMLElement | undefined {
    const { key } = this.selection.getState();
    return this.#rows().find(
      (row) => row.getAttribute(ITEM_ROW_ATTRIBUTE) === key,
    );
  }

  /** Move the selection `step` rows on; the first row where none shows. */
  #move(step: -1 | 1): boolean {
    const rows = this.#rows();
    if (rows.length === 0) return false;
    const at = rows.indexOf(this.#selectedRow()!);
    const next =
      at === -1
        ? rows[0]!
        : rows[Math.min(Math.max(at + step, 0), rows.length - 1)]!;
    this.#focus(next);
    return true;
  }

  #focus(row: HTMLElement): void {
    this.selection.setState({ key: row.getAttribute(ITEM_ROW_ATTRIBUTE) });
    row.focus();
    row.scrollIntoView({ block: "nearest" });
  }

  /**
   * Show the Item `indexedKey` selected, in its first Collection, or in its
   * Library where it is filed in none. A search or a Reading State facet
   * that may leave the Item out is cleared. It shows nothing where the list
   * does not hold it.
   */
  async reveal(indexedKey: string): Promise<void> {
    await this.#deps.settings.loaded;
    const node = await this.#itemNode(indexedKey);
    if (this.tree.store.getState().facets.length > 0) this.#filter([]);
    if (this.search.store.getState().text !== "") this.search.clear();
    if (node) this.#select(node);
    this.selection.setState({ key: indexedKey });
    await this.searched;
    await this.query.settled;
    const row = this.#selectedRow();
    if (row) this.#focus(row);
  }

  /** The node of the Item's first Collection, or of its Library. */
  async #itemNode(indexedKey: string): Promise<LibraryNode | null> {
    const parsed = parseIndexedKey(indexedKey);
    if (!parsed) return null;
    const library: LibrarySelector =
      parsed.groupID === null
        ? { type: "personal" }
        : { type: "group", groupID: parsed.groupID };
    const { libraryID } =
      this.#deps.libraryScope.libraries?.find(({ selector }) =>
        sameLibrary(selector, library),
      ) ?? {};
    if (libraryID === undefined) return null;
    try {
      const outcome = await this.#deps.query.run(
        {
          from: "items",
          filter: `${JSON.stringify([indexedKey])}.contains(indexedKey)`,
          fields: ["collections"],
          limit: 1,
          libraries: { mode: "selected", libraries: [library] },
        },
        new AbortController().signal,
      );
      const filed =
        outcome.kind === "result"
          ? outcome.result.rows?.[0]?.values.collections
          : undefined;
      const first = Array.isArray(filed) ? filed[0] : undefined;
      if (typeof first !== "string") return { kind: "library", library };
      await using lease = await this.#deps.reads.acquireRead();
      const paths = await Effect.runPromise(
        lease.reads.CollectionPaths({ libraryIDs: [libraryID] }),
      );
      const path = paths.find((names) => names.join("/") === first);
      return path
        ? { kind: "collection", library, path }
        : { kind: "library", library };
    } catch (error) {
      logger.warn("The Library View could not find an Item's Collection", {
        indexedKey,
        error,
      });
      return null;
    }
  }

  /** The researcher picked `node` in the tree: list it, and keep it. */
  #select(node: LibraryNode): void {
    this.tree.show(node);
    // The document takes the node at once (Recent writes its sort), and the
    // search runs again over the node.
    this.#storage.select(node).catch((error: unknown) => {
      logger.warn("The Library View could not keep the tree selection", {
        error,
      });
    });
    this.search.narrow();
    void this.search.run();
  }

  /** The researcher turned a facet on or off: list the Items `facets` hold, and keep them. */
  #filter(facets: readonly ReadingStateFacet[]): void {
    this.tree.showFacets(facets);
    // The document takes the facets at once; the search found what it found.
    this.#storage.setFacets(facets).catch((error: unknown) => {
      logger.warn("The Library View could not keep the facets", { error });
    });
    this.#show(this.#found);
  }

  /**
   * Run the query of the tree node and of what the search `found`; the
   * Libraries change apart from the text.
   */
  #show(found: SearchFound): void {
    this.#found = found;
    const { text, keys, everywhere } = found;
    const doc = {
      ...this.#storage.document(),
      node: this.tree.store.getState().node,
      search: text,
    };
    this.#shown = libraryViewQuery(doc, {
      labels: labels(),
      scope: this.#scope(),
      ...(keys && { keys }),
      ...(everywhere && { everywhere }),
    });
    this.query.setText(this.#shown.text);
    this.query.contextChanged();
  }

  /**
   * The Libraries of the Library Scope that the database holds, which Recent
   * reads: a saved scope can name a group the database no longer has, and a
   * request that names it fails. Where the database holds none of them, the
   * saved scope itself, so the view says which Library is missing.
   */
  #scope(): LibraryScope {
    const { current, effective } = this.#deps.libraryScope;
    if (!current || current.available.length === 0) return effective;
    return {
      mode: "selected",
      libraries: current.available.map(({ selector }) => selector),
    };
  }

  /** "Save as query file": the document as it stands, once the toolbar's last change is in. */
  async #saveAs(): Promise<void> {
    await this.query.flush();
    await saveAsQueryFile(
      this.app,
      libraryViewQueryFileText(this.#storage.document(), { labels: labels() }),
    );
  }

  protected override async onClose(): Promise<void> {
    this.#keep.run();
    await this.#saving;
    this.search.unload();
    await this.query.flush();
    this.query.unload();
    this.tree.unload();
    for (const part of this.#parts.splice(0)) part.unload();
  }
}

function labels(): LibraryViewLabels {
  return {
    papers: m.library_view_papers_view_name(),
    creators: m.query_file_creators_property(),
    year: m.query_file_year_property(),
    editedInZotero: m.library_view_recent_edited_in_zotero(),
  };
}
