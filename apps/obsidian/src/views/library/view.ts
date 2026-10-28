// The Library View: a main-area tab that hosts the Query View without a file,
// beside the Library Tree. Its Library View Document in plugin data says what
// the tab shows; the tab derives the Query View's text and its Libraries from
// it, and a toolbar change or a tree selection saves back into it. The tab
// reads Zotero's database only, so Zotero does not need to run.
//
// @see apps/obsidian/docs/adr/0071-the-library-view-is-a-fileless-query-view-host-that-saves-to-plugin-data.md
import { debounce, ItemView, Keymap, Scope } from "obsidian";
import type { Component, Modifier, WorkspaceLeaf } from "obsidian";

import { holdScopeWhileFocused } from "@/lib/focus-scope";
import * as m from "@/lib/i18n/generated/messages";
import { runtime } from "@/lib/i18n/generated/runtime";
import { composing } from "@/lib/ime";
import { getLogger } from "@/lib/log";
import { showMenuAtButton } from "@/lib/menu";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import type { QueryViewValue } from "@/services/item-query/query-view";
import { libraryScopeStateAtom } from "@/services/library-scope/atoms";
import type { LibraryScope } from "@/services/library-scope/scope";
import { notedItemKeysAtom } from "@/services/note-index/atoms";
import { inTextEntry } from "@/services/pdf-annotation-editor/capability-affordance";
import { useLedgerAtom } from "@/services/use-ledger/atoms";
import { showItemInAnnotView } from "@/views/annot-view/register";
import { saveAsQueryFile } from "@/views/annot-view/save-query-file";
import {
  ITEM_ROW_ATTRIBUTE,
  ITEM_ROW_REVEALED_ATTRIBUTE,
} from "@/views/query-view/item-rows";
import type { ItemRowGestures } from "@/views/query-view/item-rows";
import { holdsPdf } from "@/views/query-view/papers-layout";
import { QueryView } from "@/views/query-view/view";
import type { QueryViewDeps } from "@/views/query-view/view";
import { WelcomeBanner } from "@/views/welcome/banner";
import type { WelcomeBannerDeps } from "@/views/welcome/banner";

import { makeItemNodeCommand } from "./atoms";
import { DetailsToggle } from "./details-toggle";
import {
  CARD_WIDTH_DEFAULT,
  CARD_WIDTH_MIN,
  LIBRARY_LAYOUTS,
  TREE_WIDTH_DEFAULT,
  TREE_WIDTH_MIN,
  libraryViewDefaults,
  libraryViewQuery,
  libraryViewQueryFileLeftOut,
  libraryViewQueryFileText,
  pruneExpanded,
  vaultPass,
  withCardClosed,
  withCardDisclosure,
  withCardWidth,
  withExpanded,
  withFacets,
  withNode,
  withSearch,
  withTags,
  withTreeCollapsed,
  withTreeWidth,
} from "./document";
import type {
  LibraryNode,
  LibraryViewDocument,
  LibraryViewLabels,
  LibraryViewQuery,
  ReadingStateFacet,
} from "./document";
import { renderHeading } from "./heading";
import { ZOTLIT_MARK_ICON } from "./icon";
import type { ItemActions } from "./item-actions";
import { createItemDrag, refuseItemDrop } from "./item-drag";
import { FACET_LABELS, LibraryTree } from "./library-tree";
import { makeLibraryModel, patchSelection } from "./model";
import type { LibrarySelection } from "./model";
import { ZoteroNotFound } from "./not-found";
import { PaneWidth } from "./pane-width";
import { ReadingCard } from "./reading-card";
import { recentReason, RECENT_REASON_FIELDS } from "./reason";
import { rowMenu } from "./row-menu";
import type { MenuItem } from "./row-menu";
import { LibrarySearch } from "./search-box";
import type { SearchFound } from "./search-box";
import { LibraryViewStorage } from "./storage";
import { scopeForLibrary } from "./tree-model";
import "./style.css";

const logger = getLogger(["library-view"]);

export const LIBRARY_VIEW_TYPE = "zotlit-library";

export interface LibraryViewDeps extends QueryViewDeps {
  registry: ViewRegistryHandle;
  /** What a row does with its Item. */
  items: ItemActions;
  /** The Welcome View banner above the tab, and its setup actions. ADR 0077. */
  welcome: WelcomeBannerDeps;
}

/**
 * The controls in the view that answer Enter and the arrow keys themselves:
 * links, buttons (an icon button, such as the Welcome View banner's dismiss,
 * is a `role="button"`), list boxes, and the Library Tree. A menu is none of
 * them: it holds a Scope of its own while it stands, so its keys never reach
 * the view's.
 */
const OWN_KEYS =
  'a, button, [role="button"], [role="listbox"], [role="combobox"], [role="tree"], [data-library-card]';

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
  /** The Reading Card of the selected row. */
  readonly card: ReadingCard;
  /** The Welcome View banner above the tree and the list. ADR 0077. */
  readonly welcome: WelcomeBanner;
  readonly #deps: LibraryViewDeps;
  readonly #storage: LibraryViewStorage;
  /** The not-found state and the Welcome View banner, while the tab is open. */
  readonly #parts: Component[] = [];
  #arrival = 0;
  #arrived: Promise<void> = Promise.resolve();
  /** What the tab runs: the query of the document as it opened. */
  #shown: LibraryViewQuery | null = null;
  /** What the search last found, which a facet change lists again. */
  #found: SearchFound = { text: "" };
  /**
   * The selected row, by its Item's Indexed Key, for this tab alone: a new
   * tab opens with none. A click, the arrow keys and "Show in Library" all
   * select a row alone; the item details show the selected row while the
   * researcher keeps them on (the document's `cardClosed` absent), at every
   * pane width.
   */
  readonly model = makeLibraryModel();
  readonly #itemNodeCommand = makeItemNodeCommand();
  #release: (() => void) | null;
  get selected(): LibrarySelection {
    return this.#deps.registry.get(this.model.selection);
  }
  #selectRow(
    patch:
      | Partial<LibrarySelection>
      | ((state: LibrarySelection) => LibrarySelection),
  ): void {
    this.#deps.registry.update(
      this.model.selection,
      typeof patch === "function" ? patch : patchSelection(patch),
    );
  }
  #hold(): () => void {
    const releases = [
      this.#deps.registry.mount(this.model.selection),
      this.#deps.registry.mount(this.#itemNodeCommand),
      this.#deps.registry.mount(useLedgerAtom),
      this.#deps.registry.mount(notedItemKeysAtom),
      this.#deps.registry.mount(libraryScopeStateAtom),
    ];
    return () => {
      for (const release of releases) release();
    };
  }
  /** The Reading Card's pane, once the tab has opened. */
  #cardEl: HTMLElement | null = null;
  /** The Reading Card's resizable inner edge, once the tab has opened. */
  #cardWidth: PaneWidth | null = null;
  /** The Library Tree's resizable inner edge, once the tab has opened. */
  #treeWidth: PaneWidth | null = null;
  /** The Details button, once the tab has opened. */
  #details: DetailsToggle | null = null;
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
    this.#release = this.#hold();
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
      deps.registry,
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
      // Query View owns this interface; its selection is projected from our atom.
      selection: {
        getState: () => this.selected,
        getInitialState: () => ({ key: null }),
        setState: (update) => {
          const now = this.selected;
          const next = typeof update === "function" ? update(now) : update;
          this.#selectRow(next);
        },
        subscribe: (listener) => {
          let previous = this.selected;
          return deps.registry.subscribe(this.model.selection, (state) => {
            const before = previous;
            previous = state;
            listener(state, before);
          });
        },
      },
      // A click, the keyboard entering the list, or a link or button in
      // the row selects the row, as the arrow keys do.
      click: (key) => this.#selectRow({ key }),
      select: (key) => this.#selectRow({ key }),
      first: () =>
        this.query.state.getState().results?.records[0]?.row.indexedKey ?? null,
      open: (key, event) => {
        void deps.items.openPdf(key, Keymap.isModEvent(event));
      },
      // The menu acts on the row it opens over, which it selects.
      menu: (key, event) => {
        this.#selectRow({ key });
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
    // Escape stays in the tab: otherwise Obsidian moves focus to the last
    // navigable leaf, which in the main area switches the tab away from
    // this view.
    const onEscape = () => {
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
      defaults: () => libraryViewDefaults(this.tree.state.node),
      // Has note, and the Literature Note half of Unread, the vault answers.
      rowPass: () =>
        this.#shown &&
        vaultPass(this.#shown.vault, {
          find: (key) =>
            deps.registry.get(notedItemKeysAtom).has(key)
              ? { path: key, basename: key }
              : null,
        }),
      rows,
      fields: (view) =>
        view.type === "papers" && this.tree.state.node.kind === "recent"
          ? RECENT_REASON_FIELDS
          : [],
      reason: (row) => {
        if (this.tree.state.node.kind !== "recent") return null;
        const use = deps.registry.get(useLedgerAtom)[row.indexedKey];
        return recentReason(row.values, use);
      },
      // The empty list names the search or the facets, which the derived
      // text holds as filters the researcher never wrote.
      empty: ({ fallback }) => this.search.empty(this.tree.model, fallback),
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
      close: () => this.#setDetails(false),
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
        if (!this.tree.state.tags.includes(name)) this.tree.toggleTag(name);
      },
      // The card shows the header of an Item it is reading from its row.
      row: (key) => this.#rowValues(key),
      stats: () => this.tree.model.stats,
      onEscape,
    });
    this.tree = new LibraryTree(deps, {
      select: (node) => this.#select(node),
      filter: (facets) => this.#filter(facets),
      tag: (tags) => this.#tag(tags),
      expand: (expanded) => this.#expand((doc) => withExpanded(doc, expanded)),
      prune: (know) => {
        const doc = this.#storage.document();
        if (pruneExpanded(doc, know) !== doc)
          this.#expand((now) => pruneExpanded(now, know));
      },
      collapse: (collapsed) => this.#collapseTree(collapsed),
    });
    this.search = new LibrarySearch(deps, {
      node: () => this.tree.state.node,
      scope: () => this.#scope(),
      found: (found) => this.#show(found),
      keep: (text) => {
        this.#storage.set((doc) => withSearch(doc, text));
        this.#keep();
      },
    });
  }

  /**
   * The researcher brought the tab forward. Search is the front door: the
   * cursor waits in the box, except under the Welcome View banner, whose
   * focus ring would wrap the box right under it; the banner's "Search your
   * library" puts the cursor there on purpose.
   *
   * Whether the banner shows can wait on its connection readout, as on a
   * first launch, while Zotero's database loads: the box then takes the
   * cursor once that is known, unless the researcher moved it meanwhile or
   * brought the tab forward again.
   */
  arrive(): void {
    const arrival = ++this.#arrival;
    if (this.welcome.known) {
      this.#arrived = Promise.resolve();
      if (!this.welcome.shown) this.search.focus();
      return;
    }
    const { doc } = this.contentEl;
    const before = doc.activeElement;
    this.#arrived = this.welcome.decided.then((shown) => {
      if (shown || arrival !== this.#arrival) return;
      if (!this.contentEl.isConnected || doc.activeElement !== before) return;
      this.search.focus();
    });
  }

  /** Settles once the last arrival placed the cursor, or left it. Never rejects. */
  get arrived(): Promise<void> {
    return this.#arrived;
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

  #subscribeSelection(listener: (state: LibrarySelection) => void): () => void {
    return this.#deps.registry.subscribe(this.model.selection, listener);
  }

  protected override async onOpen(): Promise<void> {
    this.#release ??= this.#hold();
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
    // The tree and the list share the top of the shell, and the item
    // details sit beside them on a wide pane, or under both, across the
    // whole pane, on a narrow one. The card is a container of its own, so
    // what sits in it and asks the pane's width names the shell's.
    const shell = column.createDiv({
      cls: "zt:group zt:@container/library zt:relative zt:flex zt:min-h-[min(20rem,100%)] zt:flex-1 zt:overflow-hidden",
      attr: { "data-library-shell": "" },
    });
    // The shell's own width query reaches only what it holds, so a frame
    // inside it turns the row into a column.
    const frame = shell.createDiv({
      cls: "zt:flex zt:min-h-0 zt:min-w-0 zt:flex-1 zt:@max-4xl:flex-col",
    });
    const top = frame.createDiv({
      cls: "zt:relative zt:flex zt:min-h-0 zt:min-w-0 zt:flex-1",
    });
    // Beside a wide list the tree shows unless the researcher collapsed it;
    // over a narrow one it shows while it is open.
    const treePane = top.createDiv({
      cls: "zt:relative zt:hidden zt:w-[var(--zt-library-tree-width,14rem)] zt:shrink-0 zt:flex-col zt:border-e-(length:--border-width) zt:border-(--divider-color) zt:bg-(--background-primary) zt:@xl:flex zt:@xl:group-data-tree-collapsed:hidden zt:@max-xl:group-data-tree-open:flex zt:@max-xl:absolute zt:@max-xl:inset-y-0 zt:@max-xl:start-0 zt:@max-xl:max-w-[85%] zt:@max-xl:z-(--layer-popover) zt:@max-xl:shadow-(--shadow-s)",
      attr: { "data-library-tree": "" },
    });
    const treeEl = treePane.createDiv({
      cls: "zt:min-h-0 zt:flex-1 zt:overflow-y-auto zt:scroll-gutter",
    });
    const main = top.createDiv({
      cls: "zt:flex zt:min-h-0 zt:min-w-0 zt:flex-1 zt:flex-col",
    });
    // Where ZotLit cannot read Zotero's database, the tree and the list say
    // so in place of what they hold; the search box and the header's count
    // go with them.
    const hidden = "zt:group-data-zotero-missing:hidden";
    // The item details show while the researcher keeps them on: the
    // selected paper, or what fills them when none is selected.
    const cardEl = frame.createDiv({ cls: `zt:contents ${hidden}` }).createDiv({
      cls: "zt:@container/card zt:relative zt:hidden zt:w-[var(--zt-library-card-width,24rem)] zt:shrink-0 zt:flex-col zt:min-h-0 zt:border-s-(length:--border-width) zt:border-(--divider-color) zt:bg-(--background-primary) zt:[&:not([hidden])]:flex zt:@max-4xl:w-auto zt:@max-4xl:h-1/2 zt:@max-4xl:border-s-0 zt:@max-4xl:border-t-(length:--border-width)",
      attr: { "data-library-card": "", hidden: "" },
    });
    this.#cardEl = cardEl;
    // Each pane's inner edge sets its width beside the list; under a narrow
    // list the details span the pane, and over a narrow one the tree keeps
    // its own room, so neither has an edge there.
    this.#cardWidth = new PaneWidth(
      cardEl,
      {
        list: main,
        shell,
        side: "start",
        property: "--zt-library-card-width",
        fallback: CARD_WIDTH_DEFAULT,
        min: CARD_WIDTH_MIN,
        cls: "zt:@max-4xl/library:hidden",
        hint: m.library_view_card_resize_hint(),
        attr: "data-library-card-resizer",
      },
      {
        app: this.#deps.app,
        stored: () => this.#storage.document().cardWidth,
        // A drag past the minimum hides the details while the pointer stays
        // there, and turns them off on release.
        collapse: (collapsed) => {
          if (collapsed) cardEl.hidden = true;
          else this.#showCard();
        },
        close: () => this.#setDetails(false),
        keep: (width) => {
          this.#storage
            .change((doc) => withCardWidth(doc, width))
            .catch((error: unknown) => {
              logger.warn("The Library View could not keep the card's width", {
                error,
              });
            });
        },
      },
    );
    this.#treeWidth = new PaneWidth(
      treePane,
      {
        list: main,
        shell,
        side: "end",
        property: "--zt-library-tree-width",
        fallback: TREE_WIDTH_DEFAULT,
        min: TREE_WIDTH_MIN,
        cls: "zt:@max-xl:hidden",
        hint: m.library_view_tree_resize_hint(),
        attr: "data-library-tree-resizer",
      },
      {
        app: this.#deps.app,
        stored: () => this.#storage.document().treeWidth,
        // A drag past the minimum hides the tree while the pointer stays
        // there, and collapses it on release.
        collapse: (collapsed) =>
          shell.toggleAttribute(
            "data-tree-collapsed",
            collapsed || this.tree.state.collapsed,
          ),
        close: () => this.#collapseTree(true),
        keep: (width) => {
          this.#storage
            .change((doc) => withTreeWidth(doc, width))
            .catch((error: unknown) => {
              logger.warn("The Library View could not keep the tree's width", {
                error,
              });
            });
        },
      },
    );
    const cardBody = cardEl.createDiv({
      cls: "zt:flex zt:min-h-0 zt:flex-1 zt:flex-col",
    });
    // The tree toggle and the Details button share the search box's row, so
    // neither takes a row of its own above the heading. While Zotero is not
    // found the tree toggle stays, so the tree's not-found part still shows.
    const searchRow = main.createDiv({
      cls: "zt:flex zt:items-center zt:gap-(--size-2-2) zt:ps-(--zt-query-toolbar-inset-start) zt:pe-(--zt-query-toolbar-inset-end) zt:pt-(--size-4-2)",
      attr: { "data-library-search-row": "" },
    });
    const toggleEl = searchRow.createDiv({ cls: "zt:contents" });
    const searchEl = searchRow.createDiv({
      cls: `zt:min-w-0 zt:flex-1 ${hidden}`,
    });
    this.#details = new DetailsToggle(
      searchRow.createDiv({ cls: `zt:flex ${hidden}` }),
      () => this.#setDetails(this.#storage.document().cardClosed === true),
    );
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
        {
          registry: this.#deps.registry,
          setupActions: this.#deps.welcome.setupActions,
        },
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
    // On a narrow pane the tree shows over the list while it is open, and
    // on a wide one beside it unless collapsed: the list's room changes, so
    // both edges clamp again.
    this.tree.register(
      this.tree.subscribe(({ open, collapsed }) => {
        shell.toggleAttribute("data-tree-open", open);
        shell.toggleAttribute("data-tree-collapsed", collapsed);
        this.#treeWidth?.apply();
        this.#cardWidth?.apply();
      }),
    );
    this.#holdTreeKeys(treePane);
    // A press on the list beside it puts the tree away.
    main.addEventListener("pointerdown", (event) => {
      if (!this.tree.state.open) return;
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
    this.card.render(cardBody);
    this.card.register(
      this.#subscribeSelection(({ key }) => this.card.show(key)),
    );
    // A selected row that leaves the list takes its selection with it, so
    // the Reading Card never shows an Item the list does not hold.
    this.query.register(
      this.query.state.subscribe(({ phase, results }) => {
        const { key } = this.selected;
        if (phase !== "ready" || key === null) return;
        if (!results?.rows.some((row) => row.indexedKey === key))
          this.#selectRow({ key: null });
      }),
    );
    this.query.register(
      this.#deps.registry.subscribe(useLedgerAtom, () => {
        if (this.#shown && this.tree.state.node.kind === "recent")
          this.query.contextChanged();
      }),
    );
    // A Literature Note added or removed changes what the vault answers.
    this.query.register(
      this.#deps.registry.subscribe(notedItemKeysAtom, () => {
        if (this.#shown && this.#shown.vault.length > 0) this.query.refresh();
      }),
    );
    // A tab that the workspace restores on startup can open before plugin
    // data has loaded.

    await this.#storage.load();
    const doc = this.#storage.document();
    this.#cardWidth?.load();
    this.#treeWidth?.load();
    this.tree.showCollapsed(doc.treeCollapsed === true);
    this.#showCard();
    this.card.showDisclosures(doc.card);
    this.tree.show(doc.node);
    this.tree.showExpanded(doc.expanded);
    this.tree.showFacets(doc.facets);
    this.tree.showTags(doc.tags);
    this.tree.refresh();
    await this.search.open(doc.search);
  }

  /** The researcher opened or closed tree nodes: show them, and keep them. */
  #expand(change: (doc: LibraryViewDocument) => LibraryViewDocument): void {
    this.#storage.change(change).catch((error: unknown) => {
      logger.warn("The Library View could not keep the open tree nodes", {
        error,
      });
    });
    this.tree.showExpanded(this.#storage.document().expanded);
  }

  /** The values of the list's row of the Item `key`, where the list shows it. */
  #rowValues(key: string): Readonly<Record<string, QueryViewValue>> | null {
    return (
      this.query.state
        .getState()
        .results?.rows.find((row) => row.indexedKey === key)?.values ?? null
    );
  }

  /**
   * Show the item details as the document has them: on unless the
   * researcher turned them off, with the Details button pressed while they
   * show. The list's room changes, so the tree's edge clamps again.
   */
  #showCard(): void {
    const el = this.#cardEl;
    if (!el) return;
    const on = this.#storage.document().cardClosed !== true;
    el.hidden = !on;
    this.#details?.show(on);
    this.#cardWidth?.apply();
    this.#treeWidth?.apply();
  }

  /**
   * Turn the item details on or off, and keep it. Turned on, they take room
   * from the list, which keeps its selected row in view; turned off, the
   * selected row takes the focus back.
   */
  #setDetails(on: boolean): void {
    this.#storage
      .change((doc) => withCardClosed(doc, !on))
      .catch((error: unknown) => {
        logger.warn("The Library View could not keep the item details", {
          error,
        });
      });
    this.#showCard();
    const row = this.#selectedRow();
    if (on) row?.scrollIntoView({ block: "nearest" });
    else row?.focus();
  }

  /**
   * Collapse the tree beside a wide list, or show it again, and keep it. A
   * tree shown over a narrow list goes with it.
   */
  #collapseTree(collapsed: boolean): void {
    this.#storage
      .change((doc) => withTreeCollapsed(doc, collapsed))
      .catch((error: unknown) => {
        logger.warn("The Library View could not keep the tree collapsed", {
          error,
        });
      });
    this.tree.setOpen(false);
    this.tree.showCollapsed(collapsed);
  }

  /**
   * The row keys of the quick switcher (ADR 0074): ↑ and ↓ move the
   * selection; Enter opens the selected row's Literature Note, or writes it,
   * Mod+Enter in a new pane; Shift+Enter opens its PDF. Space turns the
   * item details on or off (ADR 0071).
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
      this.#setDetails(this.#storage.document().cardClosed === true);
      return false;
    });
  }

  /**
   * The open tree's keys: Escape puts the tree away from anywhere inside it,
   * before the list beneath clears its selection or puts its card away. The
   * view's Scope hears a key before the tree does, so the tree takes Escape
   * on a Scope of its own, on top while it is open and focus stands in it.
   * A filter with text in it keeps Escape, which clears it first.
   */
  #holdTreeKeys(pane: HTMLElement): void {
    const { keymap } = this.#deps.app;
    const scope = new Scope(this.scope);
    scope.register([], "Escape", (event) => {
      if (composing(event)) return;
      // The tag filter, the one field in the tree, clears its text first.
      if (inTextEntry(event.target) && this.tree.state.tagFilter) return;
      this.tree.setOpen(false);
      return false;
    });
    const keys = holdScopeWhileFocused(pane, scope, {
      keymap,
      when: () => this.tree.state.open,
    });
    this.tree.register(
      this.tree.subscribe(({ open }) => {
        if (!open) keys.release();
      }),
    );
    this.register(() => keys[Symbol.dispose]());
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
    const { key } = this.selected;
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
    this.#selectRow({ key: next.getAttribute(ITEM_ROW_ATTRIBUTE) });
    this.#focus(next);
    return true;
  }

  /** Give `row` the focus, in view. */
  #focus(row: HTMLElement): void {
    row.focus();
    row.scrollIntoView({ block: "nearest" });
  }

  /**
   * Flash `row` once, so the eye finds the row Show in Library selected. A
   * flash still running starts over: the style read between the two writes
   * makes the browser see the attribute go and come back.
   */
  #flash(row: HTMLElement): void {
    row.removeAttribute(ITEM_ROW_REVEALED_ATTRIBUTE);
    row.getBoundingClientRect();
    row.setAttribute(ITEM_ROW_REVEALED_ATTRIBUTE, "");
    const ended = (event: AnimationEvent) => {
      if (event.target !== row) return;
      row.removeAttribute(ITEM_ROW_REVEALED_ATTRIBUTE);
      row.removeEventListener("animationend", ended);
    };
    row.addEventListener("animationend", ended);
  }

  /**
   * Show the Item `indexedKey` selected, in its first Collection, or in its
   * Library where it is filed in none. A search, a Reading State facet or a
   * selected tag that may leave the Item out is cleared.
   * @returns `"not-listed"` where the list does not hold the Item, as past
   * its row limit: nothing is selected, and the caller says so.
   */
  async reveal(
    indexedKey: string,
  ): Promise<"listed" | "not-listed" | "not-found" | "closed"> {
    const node = await this.#itemNode(indexedKey);
    if (!this.#release) return "closed";
    // An Item the Library Scope does not hold leaves the list as it was.
    if (!node) return "not-found";
    if (this.tree.state.facets.length > 0) this.#filter([]);
    if (this.tree.state.tags.length > 0) this.#tag([]);
    if (this.search.state.text !== "") this.search.clear();
    this.#select(node);
    await this.searched;
    await this.query.settled;
    const listed = this.query.state
      .getState()
      .results?.rows.some((row) => row.indexedKey === indexedKey);
    if (!listed) {
      this.#selectRow({ key: null });
      return "not-listed";
    }
    // Show in Library selects the row, as a click does: the details show it
    // while they are on.
    this.#selectRow({ key: indexedKey });
    const row = this.#rowOf(indexedKey);
    if (row) {
      this.#focus(row);
      this.#flash(row);
    }
    return "listed";
  }

  /** The node of the Item's first Collection, or of its Library. */
  async #itemNode(indexedKey: string): Promise<LibraryNode | null> {
    const result = Promise.withResolvers<LibraryNode | null>();
    this.#deps.registry.set(this.#itemNodeCommand, { indexedKey, result });
    return result.promise;
  }

  /** The researcher picked `node` in the tree: list it, and keep it. */
  #select(node: LibraryNode): void {
    this.tree.show(node);
    // The document takes the node at once (Recent writes its sort, and the
    // Collections above it open), and the search runs again over the node.
    this.#storage
      .change((doc) => withNode(doc, node))
      .catch((error: unknown) => {
        logger.warn("The Library View could not keep the tree selection", {
          error,
        });
      });
    this.tree.showExpanded(this.#storage.document().expanded);
    // The selected row leaves the list with its node.
    this.#selectRow({ key: null });
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
    return scopeForLibrary(this.#deps.registry.get(libraryScopeStateAtom));
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
    if (!this.#release) return;
    this.#cardWidth?.unload();
    this.#treeWidth?.unload();
    this.#details?.unmount();
    this.#keep.run();
    await this.#saving;
    this.search.unload();
    await this.query.flush();
    this.query.unload();
    this.card.unload();
    this.tree.unload();
    for (const part of this.#parts.splice(0)) part.unload();
    this.#storage.close();
    this.#release?.();
    this.#release = null;
  }
}

function labels(): LibraryViewLabels {
  return {
    papers: m.library_view_papers_view_name(),
  };
}
