// The Library View: a main-area tab that hosts the Query View without a file,
// beside the Library Tree. Its Library View Document in plugin data says what
// the tab shows; the tab derives the Query View's text and its Libraries from
// it, and a toolbar change or a tree selection saves back into it. The tab
// reads Zotero's database only, so Zotero does not need to run.
//
// @see apps/obsidian/docs/adr/0070-the-library-view-is-a-fileless-query-view-host-that-saves-to-plugin-data.md
import { ItemView, Scope } from "obsidian";
import type { Component, WorkspaceLeaf } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import type { SettingsService } from "@/services/settings/service";
import { saveAsQueryFile } from "@/views/annot-view/save-query-file";
import { QueryView } from "@/views/query-view/view";
import type { QueryViewDeps } from "@/views/query-view/view";
import { WelcomeBanner } from "@/views/welcome/banner";
import type { WelcomeBannerDeps } from "@/views/welcome/banner";

import { LIBRARY_LAYOUTS } from "./document";
import type { LibraryNode, LibraryViewDocument } from "./document";
import { ZOTLIT_MARK_ICON } from "./icon";
import { LibraryTree } from "./library-tree";
import type { LibraryTreeDeps } from "./library-tree";
import { ZoteroNotFound } from "./not-found";
import { libraryViewQuery, libraryViewQueryFileText } from "./query-text";
import type { LibraryViewLabels, LibraryViewQuery } from "./query-text";
import { libraryViewStorage } from "./storage";
import "./style.css";

const logger = getLogger(["library-view"]);

export const LIBRARY_VIEW_TYPE = "zotlit-library";

export interface LibraryViewDeps extends QueryViewDeps {
  settings: Pick<SettingsService, "update" | "flush" | "current" | "loaded">;
  libraryScope: QueryViewDeps["libraryScope"] & LibraryTreeDeps["libraryScope"];
  /** The Welcome View banner above the tab, and its setup actions. ADR 0076. */
  welcome: WelcomeBannerDeps;
}

export class LibraryView extends ItemView {
  override scope: Scope;
  readonly query: QueryView;
  readonly tree: LibraryTree;
  readonly #deps: LibraryViewDeps;
  readonly #storage: ReturnType<typeof libraryViewStorage>;
  /** The not-found state and the Welcome View banner, while the tab is open. */
  readonly #parts: Component[] = [];
  /** What the tab runs: the query of the document as it opened. */
  #shown: LibraryViewQuery | null = null;

  constructor(leaf: WorkspaceLeaf, deps: LibraryViewDeps) {
    super(leaf);
    this.#deps = deps;
    this.scope = new Scope(deps.app.scope);
    this.contentEl.addClass("zt-root", "zt-library-view");
    this.contentEl.dataset.libraryView = "";
    this.#storage = libraryViewStorage(deps.settings);
    this.query = new QueryView(deps, {
      scope: this.scope,
      sourcePath: () => "",
      context: () => undefined,
      // The view runs once the tab has set its text, after the query.
      libraries: () => this.#shown!.libraries,
      // The document keeps the sort, the Layout and the Visible Properties.
      displayOnly: true,
      layouts: LIBRARY_LAYOUTS,
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
    // so in place of what they hold, and the header's count goes with them.
    const hidden = "zt:group-data-zotero-missing:hidden";
    const header = main.createDiv({ cls: hidden });
    const list = main.createDiv();
    const shown = "zt:hidden zt:group-data-zotero-missing:block";
    this.#parts.push(
      new ZoteroNotFound(this.#deps.welcome, {
        shell,
        tree: treeEl.createDiv({ cls: shown }),
        list: list.createDiv({ cls: shown }),
      }),
      new WelcomeBanner(this.#deps.welcome, banner),
    );
    for (const part of this.#parts) part.load();
    this.tree.load();
    this.tree.render(treeEl.createDiv({ cls: hidden }));
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
    this.query.render(list.createDiv({ cls: hidden }));
    // A tab that the workspace restores on startup can open before plugin
    // data has loaded.
    await this.#deps.settings.loaded;
    const doc = this.#storage.document();
    this.tree.show(doc.node);
    this.tree.refresh();
    this.#show(doc);
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
    this.#shown = libraryViewQuery(doc, { labels: labels() });
    this.query.setText(this.#shown.text);
    this.query.contextChanged();
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
  };
}
