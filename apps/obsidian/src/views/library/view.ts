// The Library View: a main-area tab that hosts the Query View without a file,
// beside the Library Tree. Its Library View Document in plugin data says what
// the tab shows; the tab derives the Query View's text and its Libraries from
// it, and a toolbar change or a tree selection saves back into it. The tab
// reads Zotero's database only, so Zotero does not need to run.
//
// @see apps/obsidian/docs/adr/0071-the-library-view-is-a-fileless-query-view-host-that-saves-to-plugin-data.md
import { debounce, ItemView, Keymap, Scope } from "obsidian";
import type { Component, Modifier, WorkspaceLeaf } from "obsidian";
import { createStore } from "zustand/vanilla";

import { Effect } from "@/lib/effect";
import * as m from "@/lib/i18n/generated/messages";
import { runtime } from "@/lib/i18n/generated/runtime";
import { getLogger } from "@/lib/log";
import { showMenuAtButton } from "@/lib/menu";
import type { QueryViewValue } from "@/services/item-query/query-view";
import type { LibraryScope } from "@/services/library-scope/scope";
import type { LibraryScopeService } from "@/services/library-scope/service";
import { inTextEntry } from "@/services/pdf-annotation-editor/capability-affordance";
import type { SettingsService } from "@/services/settings/service";
import { showItemInAnnotView } from "@/views/annot-view/register";
import { saveAsQueryFile } from "@/views/annot-view/save-query-file";
import { ITEM_ROW_ATTRIBUTE } from "@/views/query-view/item-rows";
import type { ItemRowGestures } from "@/views/query-view/item-rows";
import { holdsPdf } from "@/views/query-view/papers-layout";
import { QueryView } from "@/views/query-view/view";
import type { QueryViewDeps } from "@/views/query-view/view";
import { WelcomeBanner } from "@/views/welcome/banner";
import type { WelcomeBannerDeps } from "@/views/welcome/banner";
import { unavailable } from "@/views/welcome/connection";

import {
  LIBRARY_LAYOUTS,
  libraryViewDefaults,
  libraryViewQuery,
  libraryViewQueryFileLeftOut,
  libraryViewQueryFileText,
  vaultPass,
  withCardDisclosure,
  withFacets,
  withNode,
  withSearch,
  withTags,
} from "./document";
import type {
  LibraryNode,
  LibraryViewLabels,
  LibraryViewQuery,
  ReadingStateFacet,
} from "./document";
import { renderHeading } from "./heading";
import { ZOTLIT_MARK_ICON } from "./icon";
import type { ItemActions } from "./item-actions";
import { createItemDrag, refuseItemDrop } from "./item-drag";
import { FACET_LABELS, LibraryTree } from "./library-tree";
import type { LibraryTreeDeps } from "./library-tree";
import { ZoteroNotFound } from "./not-found";
import { ReadingCard } from "./reading-card";
import { rowMenu } from "./row-menu";
import type { MenuItem } from "./row-menu";
import { LibrarySearch } from "./search-box";
import type { LibrarySearchDeps, SearchFound } from "./search-box";
import { LibraryViewStorage } from "./storage";
import { libraryOf, sameLibrary } from "./tree";
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
  /** The Welcome View banner above the tab, and its setup actions. ADR 0077. */
  welcome: WelcomeBannerDeps;
}

/**
 * The controls in the view that answer Enter and the arrow keys themselves:
 * links, buttons (an icon button, such as the Welcome View banner's dismiss,
 * is a `role="button"`), menus, list boxes, and the Library Tree.
 */
const OWN_KEYS =
  'a, button, [role="button"], [role="menu"], [role="menuitem"], [role="listbox"], [role="combobox"], [role="tree"], [data-library-card]';

/**
 * What Enter does on the selected row, by its modifiers, as in the quick
 * switcher: Mod opens in a new tab.
 */
/**
 * How long a click on a row waits before it opens the Reading Card over a
 * narrow list, so the second click of a double click still lands on the row
 * (ADR 0074): the usual double-click time of macOS and Windows.
 */
const DOUBLE_CLICK_MS = 500;

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
  /** The Reading Card of the selected row. */
  readonly card: ReadingCard;
  /** The Welcome View banner above the tree and the list. ADR 0077. */
  readonly welcome: WelcomeBanner;
  readonly #deps: LibraryViewDeps;
  readonly #storage: LibraryViewStorage;
  /** The not-found state and the Welcome View banner, while the tab is open. */
  readonly #parts: Component[] = [];
  /** What the tab runs: the query of the document as it opened. */
  #shown: LibraryViewQuery | null = null;
  /** What the search last found, which a facet change lists again. */
  #found: SearchFound = { text: "" };
  /**
   * The selected row, by its Item's Indexed Key, and whether the researcher
   * asked for its Reading Card: a click on the row or Space on it does, the
   * arrow keys do not. A narrow pane shows the card over the list only
   * while it is asked for; a wide pane shows it beside the list for every
   * selected row.
   */
  readonly selection = createStore<{ key: string | null; card: boolean }>(
    () => ({ key: null, card: false }),
  );
  /** The Reading Card's pane, once the tab has opened. */
  #cardEl: HTMLElement | null = null;
  /** The click that waits out a double click before it opens the card. */
  #cardTimer: number | null = null;
  /** The write of the search text that the box last asked for. */
  #saving: Promise<void> = Promise.resolve();
  /** Keep the search text once typing pauses. */
  readonly #keep = debounce(
    () => {
      this.#saving = this.#storage.save().catch((error: unknown) => {
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
    this.welcome = new WelcomeBanner(
      deps.welcome,
      // The banner's Search your library is the search box under it.
      { searchLibrary: () => this.search.focus() },
      this.contentEl.createDiv({ cls: "zt:shrink-0" }),
    );
    this.#storage = new LibraryViewStorage(
      deps.settings,
      () => this.query.document.text,
    );
    const drag = createItemDrag({ app: deps.app, actions: deps.items });
    const menuOf = (item: MenuItem) =>
      rowMenu(
        {
          actions: deps.items,
          literatureNotes: deps.literatureNotes,
          workspace: deps.app.workspace,
        },
        item,
      );
    const rows: ItemRowGestures = {
      selection: this.selection,
      click: (key, event) => this.#click(key, event),
      // The keyboard entering the list, or a link or button in the row,
      // selects the row, as the arrow keys do; the Reading Card stays as
      // it was.
      select: (key) =>
        this.selection.setState((now) => ({
          key,
          card: now.key === key && now.card,
        })),
      first: () =>
        this.query.state.getState().results?.records[0]?.row.indexedKey ?? null,
      open: (key, event) => {
        this.#cancelCard();
        void deps.items.openPdf(key, Keymap.isModEvent(event));
      },
      // The menu acts on the row it opens over, which it selects; the
      // Reading Card stays as it was.
      menu: (key, event) => {
        this.#cancelCard();
        this.selection.setState((now) => ({
          key,
          card: now.key === key && now.card,
        }));
        const values = this.#rowValues(key);
        menuOf({
          indexedKey: key,
          pdf: values !== null && holdsPdf(values),
        }).showAtMouseEvent(event);
      },
      drag,
    };
    this.register(() => drag.cancel());
    this.#registerRowKeys();
    // Escape puts away a card that shows over the list, from the list as
    // from the card. Otherwise Obsidian moves focus to the last navigable
    // leaf, which in the main area switches the tab away from this view.
    const onEscape = () => {
      if (this.#cardOverList()) {
        this.#closeCard();
        return false as const;
      }
      const { leftSplit, rightSplit } = deps.app.workspace;
      const root = this.leaf.getRoot();
      if (root === leftSplit || root === rightSplit) return;
      return false as const;
    };
    this.query = new QueryView(deps, {
      scope: this.scope,
      sourcePath: () => "",
      context: () => undefined,
      // The view runs once the tab has set its text, after the query.
      libraries: () => this.#shown!.libraries,
      rank: () => this.#shown!.rank,
      // The document keeps the sort alone, and Papers is the one Layout, so
      // the toolbar shows the result count, Sort and Save as query file.
      displayOnly: true,
      layouts: LIBRARY_LAYOUTS,
      // The selected node's sort and the row limit are the view's own.
      defaults: () => libraryViewDefaults(this.tree.store.getState().node),
      // Has note, and the Literature Note half of Unread, the vault answers.
      rowPass: () =>
        this.#shown && vaultPass(this.#shown.vault, deps.literatureNotes),
      rows,
      // The empty list names the search or the facets, which the derived
      // text holds as filters the researcher never wrote.
      empty: ({ fallback }) => this.search.empty(this.tree.store, fallback),
      // The document took the change from the toolbar's text already.
      save: () => this.#storage.save(),
      // The way to the full Query View: a Query File of the list.
      saveAs: () => void this.#saveAs(),
      // Sort and Save sit in the title block over the list.
      toolbar: "host",
      layout: { onEscape },
    });
    this.card = new ReadingCard(deps, {
      menu: (item, button) => showMenuAtButton(menuOf(item), button),
      openInSidebar: (key) => void showItemInAnnotView(deps.app, key),
      close: () => this.#closeCard(),
      // A disclosure is a view state the document keeps; a failed write
      // leaves it open on screen and says nothing in the toolbar.
      keepDisclosure: (name, open) => {
        this.#storage
          .change((doc) => withCardDisclosure(doc, name, open))
          .catch((error: unknown) => {
            logger.warn("The Library View could not keep the Reading Card", {
              error,
            });
          });
      },
      selectTag: (name) => {
        if (!this.tree.store.getState().tags.includes(name))
          this.tree.toggleTag(name);
      },
      // The card shows the header of an Item it is reading from its row.
      row: (key) => this.#rowValues(key),
      onEscape,
    });
    this.tree = new LibraryTree(deps, {
      select: (node) => this.#select(node),
      filter: (facets) => this.#filter(facets),
      tag: (tags) => this.#tag(tags),
      scope: () => this.#scope(),
    });
    this.search = new LibrarySearch(deps, {
      node: () => this.tree.store.getState().node,
      scope: () => this.#scope(),
      found: (found) => this.#show(found),
      keep: (text) => {
        this.#storage.set((doc) => withSearch(doc, text));
        this.#keep();
      },
      // ZotLit cannot read Zotero's database: the search box asks nothing.
      readable: () => !unavailable(deps.welcome),
    });
  }

  /**
   * The researcher brought the tab forward. Search is the front door: the
   * cursor waits in the box, except under the Welcome View banner, whose
   * focus ring would wrap the box right under it; the banner's "Search your
   * library" puts the cursor there on purpose.
   */
  arrive(): void {
    if (!this.welcome.shown) this.search.focus();
  }

  /** Settles once the list shows the newest search. Never rejects. */
  get searched(): Promise<void> {
    return this.search.settled;
  }

  override getViewType(): string {
    return LIBRARY_VIEW_TYPE;
  }

  /**
   * "Welcome & help" in the tab header toggles the Welcome View banner: it
   * shows the banner with its setup steps and moves focus to it, as "Open
   * welcome view" does, or dismisses it, as its dismiss button does. It
   * reads as pressed while the banner shows, whatever brought it (ADR 0077).
   */
  #addWelcomeAction(): void {
    const action = this.addAction(
      "circle-help",
      m.library_view_help_action(),
      () => {
        if (this.welcome.shown) {
          this.welcome.dismiss();
          return;
        }
        // Over a narrow pane the tree steps aside for the banner.
        this.tree.setOpen(false);
        this.welcome.request();
      },
    );
    this.welcome.register(
      this.welcome.subscribeShown((shown) => {
        action.classList.toggle("is-active", shown);
        action.setAttribute("aria-pressed", String(shown));
      }),
    );
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
    // The Welcome View banner sits above the tree and the list at its full
    // height. Where the tab is too short for both, the list keeps 20rem and
    // the tab scrolls as a whole, with its scrollbar, so no part of the
    // banner is cut off.
    const column = this.contentEl.createDiv({
      cls: "zt:flex zt:h-full zt:flex-col zt:overflow-y-auto",
      attr: { "data-library-column": "" },
    });
    column.append(this.welcome.el);
    const shell = column.createDiv({
      cls: "zt:group zt:@container zt:relative zt:flex zt:min-h-[min(20rem,100%)] zt:flex-1 zt:overflow-hidden",
    });
    const treePane = shell.createDiv({
      cls: "zt:hidden zt:w-56 zt:shrink-0 zt:flex-col zt:border-e-(length:--border-width) zt:border-(--divider-color) zt:bg-(--background-primary) zt:@xl:flex zt:group-data-tree-open:flex zt:@max-xl:absolute zt:@max-xl:inset-y-0 zt:@max-xl:start-0 zt:@max-xl:max-w-[85%] zt:@max-xl:z-(--layer-popover) zt:@max-xl:shadow-(--shadow-s)",
      attr: { "data-library-tree": "" },
    });
    const treeEl = treePane.createDiv({
      cls: "zt:min-h-0 zt:flex-1 zt:overflow-y-auto zt:scroll-gutter",
    });
    const main = shell.createDiv({
      cls: "zt:flex zt:min-w-0 zt:flex-1 zt:flex-col",
    });
    // Where ZotLit cannot read Zotero's database, the tree and the list say
    // so in place of what they hold; the search box and the header's count
    // go with them.
    const hidden = "zt:group-data-zotero-missing:hidden";
    // The Reading Card shows while a row is selected: beside the list on a
    // wide pane, and over it on a narrow one, as the tree does, once the
    // researcher asks for it.
    const cardEl = shell.createDiv({ cls: `zt:contents ${hidden}` }).createDiv({
      cls: "zt:hidden zt:w-96 zt:shrink-0 zt:flex-col zt:min-h-0 zt:border-s-(length:--border-width) zt:border-(--divider-color) zt:bg-(--background-primary) zt:@4xl:[&:not([hidden])]:flex zt:group-data-card-open:[&:not([hidden])]:flex zt:@max-4xl:absolute zt:@max-4xl:inset-y-0 zt:@max-4xl:end-0 zt:@max-4xl:max-w-[85%] zt:@max-4xl:z-(--layer-popover) zt:@max-4xl:shadow-(--shadow-s)",
      attr: { "data-library-card": "", hidden: "" },
    });
    this.#cardEl = cardEl;
    // The tree toggle shares the search box's row, so it never takes a row
    // of its own above the heading. While
    // Zotero is not found the toggle stays, so a narrow pane still opens the
    // tree and its not-found part; a wide pane, with no toggle, drops the row.
    const searchRow = main.createDiv({
      cls: "zt:flex zt:items-center zt:gap-(--size-2-2) zt:ps-(--zt-query-toolbar-inset-start) zt:pe-(--zt-query-toolbar-inset-end) zt:pt-(--size-4-2) zt:@xl:group-data-zotero-missing:hidden",
      attr: { "data-library-search-row": "" },
    });
    const toggleEl = searchRow.createDiv({ cls: "zt:contents" });
    const searchEl = searchRow.createDiv({
      cls: `zt:min-w-0 zt:flex-1 ${hidden}`,
    });
    const note = main.createDiv();
    const header = main.createDiv();
    // The search row, the note and the header stay at their own height above
    // the list, which takes the rest of the column: its rows scroll there,
    // under the toolbar, and an empty or not-found state centres there.
    const list = main.createDiv({
      cls: "zt:flex zt:min-h-0 zt:flex-1 zt:flex-col",
    });
    const shown = "zt:hidden zt:group-data-zotero-missing:block";
    this.#parts.push(
      new ZoteroNotFound(
        this.#deps.welcome,
        {
          shell,
          tree: treeEl.createDiv({ cls: shown }),
          list: list.createDiv({
            cls: "zt:hidden zt:min-h-0 zt:flex-1 zt:flex-col zt:group-data-zotero-missing:flex",
          }),
          note,
        },
        // The search the box holds runs again on the database found.
        () => void this.search.run(),
      ),
      this.welcome,
    );
    for (const part of this.#parts) part.load();
    this.#addWelcomeAction();
    this.tree.load();
    this.tree.render(treeEl.createDiv({ cls: hidden }));
    this.tree.renderToggle(toggleEl);
    const heading = renderHeading(header, {
      tree: this.tree,
      query: this.query,
      search: this.search.header(this.query.state),
      clearFilters: () => this.#clearFilters(),
    });
    this.query.register(() => heading.unmount());
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
    this.query.render(
      list.createDiv({
        cls: `zt:flex zt:min-h-0 zt:flex-1 zt:flex-col ${hidden}`,
      }),
    );
    this.card.load();
    this.card.render(cardEl);
    this.card.register(
      this.selection.subscribe(({ key, card }) => {
        this.card.show(key);
        cardEl.hidden = key === null;
        shell.toggleAttribute("data-card-open", card);
      }),
    );
    // A selected row that leaves the list takes its selection with it, so
    // the Reading Card never shows an Item the list does not hold.
    this.query.register(
      this.query.state.subscribe(({ phase, results }) => {
        const { key } = this.selection.getState();
        if (phase !== "ready" || key === null) return;
        if (!results?.rows.some((row) => row.indexedKey === key))
          this.selection.setState({ key: null, card: false });
      }),
    );
    // A Literature Note added or removed changes what the vault answers.
    this.query.register(
      this.#deps.literatureNotes.on("changed", () => {
        if (this.#shown && this.#shown.vault.length > 0) this.query.refresh();
      }),
    );
    // A tab that the workspace restores on startup can open before plugin
    // data has loaded.
    await this.#deps.settings.loaded;
    this.#storage.load();
    const doc = this.#storage.document();
    this.card.showDisclosures(doc.card);
    this.tree.show(doc.node);
    this.tree.showFacets(doc.facets);
    this.tree.showTags(doc.tags);
    this.tree.refresh();
    await this.search.open(doc.search);
  }

  /** The values of the list's row of the Item `key`, where the list shows it. */
  #rowValues(key: string): Readonly<Record<string, QueryViewValue>> | null {
    return (
      this.query.state
        .getState()
        .results?.rows.find((row) => row.indexedKey === key)?.values ?? null
    );
  }

  /** Whether the Reading Card shows over the list, as on a narrow pane. */
  #cardOverList(): boolean {
    return !!this.#cardEl && !this.#cardEl.hidden && this.#cardIsOverlay();
  }

  /** Whether the Reading Card goes over the list once it shows. */
  #cardIsOverlay(): boolean {
    const el = this.#cardEl;
    return !!el && el.win.getComputedStyle(el).position === "absolute";
  }

  /**
   * A click on the row `key` selects it and asks for its Reading Card. Over
   * a narrow list the card waits out a double click first, as it would
   * cover the row the second click aims at; the second click of a double
   * click asks for no card.
   */
  #click(key: string, event: MouseEvent): void {
    this.#cancelCard();
    if (event.detail <= 1 && !this.#cardIsOverlay()) {
      this.selection.setState({ key, card: true });
      return;
    }
    const now = this.selection.getState();
    this.selection.setState({ key, card: now.key === key && now.card });
    if (event.detail > 1) return;
    this.#cardTimer = this.contentEl.win.setTimeout(() => {
      this.#cardTimer = null;
      if (this.selection.getState().key === key)
        this.selection.setState({ card: true });
    }, DOUBLE_CLICK_MS);
  }

  /** The click that waited out a double click opens no card. */
  #cancelCard(): void {
    if (this.#cardTimer !== null)
      this.contentEl.win.clearTimeout(this.#cardTimer);
    this.#cardTimer = null;
  }

  /**
   * Put the Reading Card away; the row stays selected and takes the focus
   * back.
   */
  #closeCard(): void {
    this.#cancelCard();
    this.selection.setState({ card: false });
    this.#selectedRow()?.focus();
  }

  /**
   * The row keys of the quick switcher (ADR 0074): ↑ and ↓ move the
   * selection; Enter opens the selected row's Literature Note, or writes it,
   * Mod+Enter in a new pane; Shift+Enter opens its PDF. Space opens the
   * selected row's Reading Card, which a narrow pane shows over the list
   * (ADR 0071).
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
    this.scope.register([], " ", (event) => {
      if (!this.#onList(event.target) || !this.#selectedRow()) return;
      this.selection.setState({ card: true });
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
    return key === null ? undefined : this.#rowOf(key);
  }

  /** The row of the Item `key`, while one shows. */
  #rowOf(key: string): HTMLElement | undefined {
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
    this.#cancelCard();
    this.selection.setState({
      key: next.getAttribute(ITEM_ROW_ATTRIBUTE),
      card: false,
    });
    this.#focus(next);
    return true;
  }

  /** Give `row` the focus, in view. */
  #focus(row: HTMLElement): void {
    row.focus();
    row.scrollIntoView({ block: "nearest" });
  }

  /**
   * Show the Item `indexedKey` selected, in its first Collection, or in its
   * Library where it is filed in none. A search, a Reading State facet or a
   * selected tag that may leave the Item out is cleared.
   * @returns `"not-listed"` where the list does not hold the Item, as past
   * its row limit: nothing is selected, and the caller says so.
   */
  async reveal(indexedKey: string): Promise<"listed" | "not-listed"> {
    await this.#deps.settings.loaded;
    const node = await this.#itemNode(indexedKey);
    if (this.tree.store.getState().facets.length > 0) this.#filter([]);
    if (this.tree.store.getState().tags.length > 0) this.#tag([]);
    if (this.search.store.getState().text !== "") this.search.clear();
    if (node) this.#select(node);
    await this.searched;
    await this.query.settled;
    const listed = this.query.state
      .getState()
      .results?.rows.some((row) => row.indexedKey === indexedKey);
    if (!listed) {
      this.selection.setState({ key: null, card: false });
      return "not-listed";
    }
    // Show in Library asks for the Reading Card, as a click does.
    this.selection.setState({ key: indexedKey, card: true });
    const row = this.#rowOf(indexedKey);
    if (row) this.#focus(row);
    return "listed";
  }

  /** The node of the Item's first Collection, or of its Library. */
  async #itemNode(indexedKey: string): Promise<LibraryNode | null> {
    const library = libraryOf(indexedKey);
    if (!library) return null;
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
    // The selected row leaves the list with its node.
    this.selection.setState({ key: null, card: false });
    // The document takes the node at once (Recent writes its sort), and the
    // search runs again over the node.
    this.#storage
      .change((doc) => withNode(doc, node))
      .catch((error: unknown) => {
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
    this.#storage
      .change((doc) => withFacets(doc, facets))
      .catch((error: unknown) => {
        logger.warn("The Library View could not keep the facets", { error });
      });
    this.#show(this.#found);
  }

  /** The researcher selected or let go of a tag: list the Items with every one of `tags`, and keep them. */
  #tag(tags: readonly string[]): void {
    this.tree.showTags(tags);
    this.#storage
      .change((doc) => withTags(doc, tags))
      .catch((error: unknown) => {
        logger.warn("The Library View could not keep the selected tags", {
          error,
        });
      });
    this.#show(this.#found);
  }

  /** The researcher cleared the heading's filter chips: every facet off, every tag let go, in one run. */
  #clearFilters(): void {
    this.tree.showFacets([]);
    this.tree.showTags([]);
    this.#storage
      .change((doc) => withTags(withFacets(doc, []), []))
      .catch((error: unknown) => {
        logger.warn("The Library View could not clear the filters", { error });
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
    this.#shown = libraryViewQuery(withSearch(this.#storage.document(), text), {
      labels: labels(),
      scope: this.#scope(),
      ...(keys && { keys }),
      ...(everywhere && { everywhere }),
    });
    // The tree marks the node the list shows, and none past it.
    this.tree.showListed(this.#shown.node !== null);
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
    const doc = this.#storage.document();
    const leftOut = libraryViewQueryFileLeftOut(doc);
    await saveAsQueryFile(
      this.app,
      libraryViewQueryFileText(doc, { labels: labels() }),
      {
        name: this.tree.name,
        leftOut: [
          ...(leftOut.facets.length === 0
            ? []
            : [
                m.library_view_save_leaves_out_facets({
                  facets: new Intl.ListFormat(runtime.getLocale(), {
                    type: "conjunction",
                  }).format(
                    leftOut.facets.map((facet) => FACET_LABELS[facet]()),
                  ),
                }),
              ]),
          ...(leftOut.search ? [m.library_view_save_leaves_out_search()] : []),
        ],
      },
    );
  }

  protected override async onClose(): Promise<void> {
    this.#cancelCard();
    this.#keep.run();
    await this.#saving;
    this.search.unload();
    await this.query.flush();
    this.query.unload();
    this.card.unload();
    this.tree.unload();
    for (const part of this.#parts.splice(0)) part.unload();
  }
}

function labels(): LibraryViewLabels {
  return {
    papers: m.library_view_papers_view_name(),
  };
}
