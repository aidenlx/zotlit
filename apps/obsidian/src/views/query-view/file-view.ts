// The Query File tab: a `TextFileView` that hands the file's text to the one
// Query View. In its own tab a Query File has no Query Context, so `this` has
// no value and a filter that reads it shows the engine's diagnostic, under a
// hint at where the record gets bound.
import { Scope, TextFileView } from "obsidian";
import type { TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";

import "./file-view.css";
import { QueryView } from "./view";
import type { QueryViewDeps } from "./view";

export const QUERY_FILE_VIEW_TYPE = "zotlit-query-file";

export class QueryFileView extends TextFileView {
  override scope: Scope;
  readonly query: QueryView;
  /** The tab's last write of a toolbar change, which settles once it is done. Never rejects. */
  #writing: Promise<void> = Promise.resolve();

  constructor(leaf: WorkspaceLeaf, deps: QueryViewDeps) {
    super(leaf);
    this.scope = new Scope(deps.app.scope);
    this.contentEl.addClass("zt-root");
    this.query = new QueryView(deps, {
      scope: this.scope,
      sourcePath: () => this.file?.path ?? "",
      context: () => undefined,
      onSelectView: () => this.app.workspace.requestSaveLayout(),
      // Each change writes at once, after the write before it: Obsidian's
      // own save returns early while a write runs, and would not report
      // whether the later text was written.
      save: (text) => {
        const write = this.#writing.then(() => {
          this.data = text;
          return this.save();
        });
        this.#writing = write.catch(() => {});
        return write;
      },
    });
  }

  override getViewType(): string {
    return QUERY_FILE_VIEW_TYPE;
  }

  override getIcon(): string {
    return "list-filter";
  }

  override onload(): void {
    super.onload();
    this.addChild(this.query);
    this.query.render(this.contentEl);
  }

  override getViewData(): string {
    return this.data;
  }

  override setViewData(data: string): void {
    this.data = data;
    this.query.setText(data);
  }

  override async onUnloadFile(file: TFile): Promise<void> {
    // A typed change that waits for its delay belongs to this file, which the
    // tab saves as it lets the file go.
    await this.query.flush();
    await super.onUnloadFile(file);
  }

  override clear(): void {}

  override getState(): Record<string, unknown> {
    const state = super.getState();
    const view = this.query.viewName;
    return view === null ? state : { ...state, view };
  }

  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    const view =
      typeof state === "object" &&
      state !== null &&
      "view" in state &&
      typeof state.view === "string"
        ? state.view
        : null;
    this.query.selectView(view);
    await super.setState(state, result);
  }
}
