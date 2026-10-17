// The Library View: a main-area tab that hosts the Query View without a file.
// Its Library View Document in plugin data says what the tab shows; the tab
// derives the Query View's text and its Libraries from it, and a toolbar
// change saves back into it. The tab reads Zotero's database only, so Zotero
// does not need to run.
//
// @see apps/obsidian/docs/adr/0070-the-library-view-is-a-fileless-query-view-host-that-saves-to-plugin-data.md
import { ItemView, Scope } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import type { SettingsService } from "@/services/settings/service";
import "@/views/query-view/file-view.css";
import { QueryView } from "@/views/query-view/view";
import type { QueryViewDeps } from "@/views/query-view/view";

import { ZOTLIT_MARK_ICON } from "./icon";
import { libraryViewQuery } from "./query-text";
import type { LibraryViewQuery } from "./query-text";
import { libraryViewStorage } from "./storage";

export const LIBRARY_VIEW_TYPE = "zotlit-library";

export interface LibraryViewDeps extends QueryViewDeps {
  settings: Pick<SettingsService, "update" | "flush" | "current" | "loaded">;
}

export class LibraryView extends ItemView {
  override scope: Scope;
  readonly query: QueryView;
  readonly #deps: LibraryViewDeps;
  readonly #storage: ReturnType<typeof libraryViewStorage>;
  /** What the tab runs: the query of the document as it opened. */
  #shown: LibraryViewQuery | null = null;

  constructor(leaf: WorkspaceLeaf, deps: LibraryViewDeps) {
    super(leaf);
    this.#deps = deps;
    this.scope = new Scope(deps.app.scope);
    this.contentEl.addClass("zt-root");
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
    this.query.load();
    this.query.render(this.contentEl);
    // A tab that the workspace restores on startup can open before plugin
    // data has loaded.
    await this.#deps.settings.loaded;
    this.#shown = libraryViewQuery(this.#storage.document(), {
      labels: {
        papers: m.library_view_papers_view_name(),
        creators: m.query_file_creators_property(),
        year: m.query_file_year_property(),
      },
    });
    this.query.setText(this.#shown.text);
  }

  protected override async onClose(): Promise<void> {
    await this.query.flush();
    this.query.unload();
  }
}
