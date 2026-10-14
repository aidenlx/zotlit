// The Query File tab: a `TextFileView` that hands the file's text to the one
// Query View. In its own tab a Query File has no Query Context, so `this` has
// no value and a filter that reads it shows the engine's diagnostic.
import { Scope, TextFileView } from "obsidian";
import type { ViewStateResult, WorkspaceLeaf } from "obsidian";

import { QueryView } from "./view";
import type { QueryViewDeps } from "./view";

export const QUERY_FILE_VIEW_TYPE = "zotlit-query-file";

export class QueryFileView extends TextFileView {
  override scope: Scope;
  readonly query: QueryView;

  constructor(leaf: WorkspaceLeaf, deps: QueryViewDeps) {
    super(leaf);
    this.scope = new Scope(deps.app.scope);
    this.contentEl.addClass("zt-root");
    this.query = new QueryView(deps, {
      scope: this.scope,
      sourcePath: () => this.file?.path ?? "",
      context: () => undefined,
      onSelectView: () => this.app.workspace.requestSaveLayout(),
      save: (text) => {
        this.data = text;
        this.requestSave();
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

  override setViewData(data: string, _clear: boolean): void {
    this.data = data;
    this.query.setText(data);
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
