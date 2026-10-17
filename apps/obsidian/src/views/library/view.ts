// The Library View: a main-area tab that hosts the Query View without a file,
// beside the Library Tree. Its Library View Document in plugin data says what
// the tab shows; the tab derives the Query View's text and its Libraries from
// it, and a toolbar change or a tree selection saves back into it. The tab
// reads Zotero's database only, so Zotero does not need to run.
//
// @see apps/obsidian/docs/adr/0070-the-library-view-is-a-fileless-query-view-host-that-saves-to-plugin-data.md
import { ItemView, Keymap, Scope } from "obsidian";
import type { Modifier, WorkspaceLeaf } from "obsidian";
import { createStore } from "zustand/vanilla";

import { parseIndexedKey } from "@zotlit/db";

import { Effect } from "@/lib/effect";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import type { LibrarySelector } from "@/services/library-scope/scope";
import { inTextEntry } from "@/services/pdf-annotation-editor/capability-affordance";
import type { SettingsService } from "@/services/settings/service";
import { ITEM_ROW_ATTRIBUTE } from "@/views/query-view/item-rows";
import type { ItemRowGestures } from "@/views/query-view/item-rows";
import { QueryView } from "@/views/query-view/view";
import type { QueryViewDeps } from "@/views/query-view/view";

import { LIBRARY_LAYOUTS } from "./document";
import type { LibraryNode, LibraryViewDocument } from "./document";
import { ZOTLIT_MARK_ICON } from "./icon";
import type { ItemActions } from "./item-actions";
import { createItemDrag, refuseItemDrop } from "./item-drag";
import { LibraryTree } from "./library-tree";
import type { LibraryTreeDeps } from "./library-tree";
import { libraryViewQuery } from "./query-text";
import type { LibraryViewQuery } from "./query-text";
import { rowMenu } from "./row-menu";
import { libraryViewStorage } from "./storage";
import { sameLibrary } from "./tree";
import "./style.css";

const logger = getLogger(["library-view"]);

export const LIBRARY_VIEW_TYPE = "zotlit-library";

export interface LibraryViewDeps extends QueryViewDeps {
  settings: Pick<SettingsService, "update" | "flush" | "current" | "loaded">;
  libraryScope: QueryViewDeps["libraryScope"] & LibraryTreeDeps["libraryScope"];
  /** What a row does with its Item. */
  items: ItemActions;
}

/**
 * The controls in the view that answer Enter and the arrow keys themselves:
 * links, buttons, menus, list boxes, and the Library Tree.
 */
const OWN_KEYS =
  'a, button, [role="menu"], [role="menuitem"], [role="listbox"], [role="combobox"], [role="tree"]';

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
  readonly #deps: LibraryViewDeps;
  readonly #storage: ReturnType<typeof libraryViewStorage>;
  /** What the tab runs: the query of the document as it opened. */
  #shown: LibraryViewQuery | null = null;
  /** The selected row, by its Item's Indexed Key. */
  readonly selection = createStore<{ key: string | null }>(() => ({
    key: null,
  }));

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
      // The document keeps the sort, the Layout and the Visible Properties.
      displayOnly: true,
      layouts: LIBRARY_LAYOUTS,
      rows,
      save: this.#storage.save,
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
    this.tree = new LibraryTree(deps, { select: (node) => this.#select(node) });
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
    const shell = this.contentEl.createDiv({
      cls: "zt:group zt:@container zt:relative zt:flex zt:h-full zt:min-h-0",
    });
    const treeEl = shell.createDiv({
      cls: "zt:hidden zt:w-56 zt:shrink-0 zt:overflow-y-auto zt:border-e-(length:--border-width) zt:border-(--divider-color) zt:bg-(--background-primary) zt:@xl:block zt:group-data-tree-open:block zt:@max-xl:absolute zt:@max-xl:inset-y-0 zt:@max-xl:start-0 zt:@max-xl:max-w-[85%] zt:@max-xl:z-(--layer-popover) zt:@max-xl:shadow-(--shadow-s)",
      attr: { "data-library-tree": "" },
    });
    const main = shell.createDiv({
      cls: "zt:flex zt:min-w-0 zt:flex-1 zt:flex-col zt:overflow-y-auto zt:pb-[max(var(--safe-area-inset-bottom),var(--size-4-8))]",
    });
    const header = main.createDiv();
    const list = main.createDiv();
    this.tree.load();
    this.tree.render(treeEl);
    this.tree.renderHeader(header);
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
    this.query.render(list);
    // A tab that the workspace restores on startup can open before plugin
    // data has loaded.
    await this.#deps.settings.loaded;
    const doc = this.#storage.document();
    this.tree.show(doc.node);
    this.tree.refresh();
    this.#show(doc);
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
   * Library where it is filed in none. It shows nothing where the list does
   * not hold it.
   */
  async reveal(indexedKey: string): Promise<void> {
    await this.#deps.settings.loaded;
    const node = await this.#itemNode(indexedKey);
    if (node) this.#select(node);
    this.selection.setState({ key: indexedKey });
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
    this.#show({ ...this.#storage.document(), node });
    this.#storage.select(node).catch((error: unknown) => {
      logger.warn("The Library View could not keep the tree selection", {
        error,
      });
    });
  }

  /** Run the query of `doc`; the Libraries change apart from the text. */
  #show(doc: LibraryViewDocument): void {
    this.#shown = libraryViewQuery(doc, {
      labels: {
        papers: m.library_view_papers_view_name(),
        creators: m.query_file_creators_property(),
        year: m.query_file_year_property(),
      },
    });
    this.query.setText(this.#shown.text);
    this.query.contextChanged();
  }

  protected override async onClose(): Promise<void> {
    await this.query.flush();
    this.query.unload();
    this.tree.unload();
  }
}
