// The one Query View: a Query File's text, one of its views, and the rows
// ZotLit Query gives for it, drawn by the view's Layout. It is host-neutral:
// the Query File tab mounts it today, and the embed, the Query Block and the
// sidebar mount the same part, each with its own Query Context.
//
// @see apps/obsidian/docs/adr/0068-query-files-are-a-zotlit-file-type-embedded-through-the-private-embed-registry.md
// @see apps/obsidian/docs/adr/0069-the-annotation-view-is-the-annotations-layout-of-the-query-view.md
import { Component } from "obsidian";
import type { Scope } from "obsidian";
import { useMemo } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type { QueryContext } from "@zotlit/item-query";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import type { HistorySurface } from "@/services/annotation-repository/actions";
import type {
  AnnotationRepository,
  HistoryDirection,
} from "@/services/annotation-repository/service";
import type { Diagnostic } from "@/services/item-query/contract";
import type {
  QueryViewOutcome,
  QueryViewRequest,
  QueryViewRow,
} from "@/services/item-query/query-view";
import type { QueryService } from "@/services/item-query/service";
import type { LibraryScopeService } from "@/services/library-scope/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";
import { AnnotList } from "@/views/annot-view/AnnotView";
import { CardDisplayContext } from "@/views/annot-view/card-display";
import type { CardDisplay } from "@/views/annot-view/card-display";
import { AnnotationsLayout } from "@/views/annot-view/layout";
import type { AnnotationsLayoutDeps } from "@/views/annot-view/layout";
import { useAnnotStore } from "@/views/annot-view/store";

import type { QueryCardFocus } from "./card-focus";
import { GroupEditor } from "./group-control";
import { annotationsLayoutOptions } from "./layouts";
import { groupOptions, sortOptions } from "./properties";
import { PropertiesMenu } from "./properties-menu";
import {
  editView,
  parseQueryFile,
  serializeQueryFile,
  viewFilter,
} from "./query-file";
import type {
  QueryFile,
  QueryFileProblem,
  QueryFileView,
  QueryFileViewEdit,
} from "./query-file";
import { ResultsMenu } from "./results-menu";
import { LAYOUT_FIELDS, LAYOUT_GROUP_PATHS, layoutRows } from "./rows";
import type { LayoutGroup } from "./rows";
import { SearchControl } from "./search-control";
import { SortEditor } from "./sort-control";
import { resultTable } from "./table";
import type { ResultTable } from "./table";
import { ToolbarPopover } from "./toolbar-popover";
import * as edits from "./view-edits";
import { ViewMenu } from "./view-menu";
import { visibleProperties } from "./visible-properties";

const logger = getLogger(["views", "query-view"]);

/** The services a Query View reads through. */
export interface QueryViewDeps extends AnnotationsLayoutDeps {
  annotations: AnnotationsLayoutDeps["annotations"] &
    Pick<AnnotationRepository, "hold">;
  query: Pick<QueryService, "run">;
  reads: AnnotationsLayoutDeps["reads"] & Pick<ZoteroReadsService, "on">;
  libraryScope: Pick<LibraryScopeService, "on">;
  /** The keyboard of a view that a note holds, which the embed and the block share. */
  cardFocus: Pick<QueryCardFocus, "hold">;
}

/** What the host gives the Query View, beside the services. */
export interface QueryViewHost {
  /** The Scope the card keys go on, as for the Annotations Layout. */
  scope: Scope;
  /** The note that links in a card's comment resolve against. */
  sourcePath: () => string;
  /**
   * The Query Context: the Item and Attachment `this` reads. `undefined` in a
   * Query File's own tab, where `this` has no value.
   */
  context: () => QueryContext | undefined;
  /** The user chose another view of the file; the host may remember it. */
  onSelectView?: (name: string) => void;
  /**
   * Write the file's new text after a toolbar change. Absent where the host
   * cannot save; the change then shows until the file is read again.
   */
  save?: (text: string) => void;
  /**
   * Whether a change in the view stays. Where it is `false`, the toolbar says
   * that a change is not saved.
   */
  canSave?: () => boolean;
  /** Open the Query File; the toolbar shows a link button when the host gives it. */
  openFile?: (event: MouseEvent) => void;
}

/** What the view shows now, as the toolbar and the host read it. */
export interface QueryViewState {
  file: QueryFile | null;
  /** The view shown; `null` while the file has none. */
  view: QueryFileView | null;
  /** What keeps the view from running, for the file and for the view. */
  problems: readonly string[];
  phase: "idle" | "loading" | "ready" | "failed";
  /** Why the last run gave no rows, while `phase` is `failed`. */
  diagnostic:
    | (Pick<Diagnostic, "message" | "hint" | "report"> & { code: string })
    | null;
  /** The rows shown, each once however many groups it stands in. */
  count: number;
  /** The records that match the view, before its limit. */
  matched: number;
  /** Every group the rows hold, the shown ones first; empty when ungrouped. */
  groups: readonly LayoutGroup[];
  /** Whether the view's limit cut the rows short. */
  truncated: boolean;
}

const INITIAL_STATE: QueryViewState = {
  file: null,
  view: null,
  problems: [],
  phase: "idle",
  diagnostic: null,
  count: 0,
  matched: 0,
  groups: [],
  truncated: false,
};

function problemText(problem: QueryFileProblem): string {
  switch (problem.code) {
    case "invalid-yaml":
      return m.query_view_problem_invalid_yaml({ message: problem.message });
    case "not-a-map":
      return m.query_view_problem_not_a_map();
    case "no-views":
      return m.query_view_problem_no_views();
    case "missing-key":
      return m.query_view_problem_missing_key({ key: problem.key });
    case "invalid-value":
      return m.query_view_problem_invalid_value({
        key: problem.key,
        value: JSON.stringify(problem.value) ?? String(problem.value),
      });
    default:
      problem satisfies never;
      return "";
  }
}

/** What keeps the Annotations Layout from showing a view, beside the parser's own problems. */
function layoutProblems(view: QueryFileView): string[] {
  const problems: string[] = [];
  if (view.type !== "" && view.type !== "annotations")
    problems.push(m.query_view_problem_layout({ type: view.type }));
  else if (view.from !== undefined && view.from !== "annotations")
    problems.push(m.query_view_problem_dataset());
  if (
    view.groupBy &&
    !(LAYOUT_GROUP_PATHS as readonly string[]).includes(view.groupBy.property)
  )
    problems.push(
      m.query_view_problem_group({ property: view.groupBy.property }),
    );
  return problems;
}

export class QueryView extends Component implements HistorySurface {
  readonly state = createStore<QueryViewState>()(() => INITIAL_STATE);
  readonly #deps: QueryViewDeps;
  readonly #host: QueryViewHost;
  readonly #layout: AnnotationsLayout;
  /** The view the host asked for by name; the first view where `null`. */
  #wanted: string | null = null;
  #run: AbortController | null = null;
  /** The lists the cards on screen come from, held while they show. */
  #hold: Disposable | null = null;
  /**
   * The request whose rows are on screen, which a failed refresh keeps. An
   * edit that leaves the request as it is, such as a new view name or a card
   * option, keeps the rows and runs nothing.
   */
  #shownRequest: string | null = null;
  /** The request of the last run the view started. */
  #runRequest: string | null = null;
  #settled: Promise<void> = Promise.resolve();
  /** The rows on screen, each once, in the order they show. */
  #rows: readonly QueryViewRow[] = [];
  #subscriptions: DisposableStack | null = null;

  constructor(deps: QueryViewDeps, host: QueryViewHost) {
    super();
    this.#deps = deps;
    this.#host = host;
    this.#layout = new AnnotationsLayout(deps, {
      scope: host.scope,
      sourcePath: host.sourcePath,
    });
  }

  /** The cards, their store and their actions. */
  get layout(): AnnotationsLayout {
    return this.#layout;
  }

  /**
   * The Attachment whose Annotation History the palette steps: the one of the
   * card the Card Selection is on, as for the card's own undo key.
   */
  get historyAttachment(): string | null {
    return this.#layout.historyAttachment;
  }

  /** Step one confirmed edit of the Annotation History, from the palette. */
  stepHistory(direction: HistoryDirection): void {
    const attachmentKey = this.historyAttachment;
    if (attachmentKey !== null)
      this.#layout.stepHistory(direction, attachmentKey);
  }

  /** Settles once the cards show the last run the view started. Never rejects. */
  get settled(): Promise<void> {
    return this.#settled.then(() => this.#layout.read);
  }

  override onload(): void {
    this.addChild(this.#layout);
    const rerun = () => this.refresh();
    const { reads, libraryScope } = this.#deps;
    const subscriptions = new DisposableStack();
    this.#subscriptions = subscriptions;
    // A new database connection, a database that cannot be read, and another
    // Library Scope each change what the query gives. A change to one
    // Attachment's Annotations reaches the cards through the layout, which
    // reads the live records again; the rows stand until the query runs.
    subscriptions.defer(reads.on("changed", rerun));
    subscriptions.defer(reads.on("degraded", rerun));
    subscriptions.defer(reads.on("db-file-missing", rerun));
    subscriptions.defer(libraryScope.on("libraries-changed", rerun));
  }

  override onunload(): void {
    this.#subscriptions?.dispose();
    this.#subscriptions = null;
    this.#run?.abort();
    this.#run = null;
    this.#hold?.[Symbol.dispose]();
    this.#hold = null;
    this.#shownRequest = null;
    this.#runRequest = null;
  }

  /** Draw the toolbar and the cards into `el`. Call it once the view has loaded. */
  render(el: HTMLElement): void {
    el.addClass("zt-query-view");
    this.#layout.render(el, <QueryViewBody view={this} />);
  }

  /** Read a Query File's text, and show the view the host asked for. */
  setText(text: string): void {
    this.state.setState({ file: parseQueryFile(text) });
    this.#choose();
  }

  /** Whether a change in the view stays. */
  get canSave(): boolean {
    return this.#host.canSave?.() ?? true;
  }

  /**
   * A toolbar change: show `file` at once, and hand its text to the host to
   * save.
   */
  commit(file: QueryFile): void {
    const text = serializeQueryFile(file);
    this.setText(text);
    this.#host.save?.(text);
  }

  /** The host's link to the Query File, for the toolbar. */
  get openFile(): QueryViewHost["openFile"] {
    return this.#host.openFile;
  }

  /** Show the view named `name`, or the file's first view for `null`. */
  selectView(name: string | null): void {
    if (name === this.#wanted && this.state.getState().view?.name === name)
      return;
    this.#wanted = name;
    this.#choose();
  }

  /** The name of the view shown, as the host remembers it. */
  get viewName(): string | null {
    return this.state.getState().view?.name ?? this.#wanted;
  }

  /** The user picked a view from the view menu. */
  pickView(name: string): void {
    this.selectView(name);
    this.#host.onSelectView?.(name);
  }

  /**
   * Change the view shown, as a toolbar control asks, and save the file's new
   * text through the host.
   */
  editView(edit: QueryFileViewEdit): void {
    const { file, view } = this.state.getState();
    if (!file || !view) return;
    this.commit(editView(file, view, edit));
  }

  #choose(): void {
    const { file } = this.state.getState();
    if (!file) return;
    const wanted = this.#wanted;
    const view =
      (wanted === null
        ? file.views[0]
        : file.views.find((candidate) => candidate.name === wanted)) ?? null;
    const problems = file.problems.map(problemText);
    if (view) {
      problems.push(...view.problems.map(problemText), ...layoutProblems(view));
    } else if (wanted !== null && file.views.length > 0) {
      problems.push(m.query_view_problem_no_view({ name: wanted }));
    }
    this.state.setState({ view, problems });
    if (
      view &&
      problems.length === 0 &&
      this.#runKey(file, view) === this.#runRequest
    )
      return;
    this.refresh();
  }

  /**
   * The rows on screen as a table, one column for each visible property in
   * the view's order: what "Copy to clipboard" and "Export CSV..." write.
   */
  table(): ResultTable {
    const { view } = this.state.getState();
    return resultTable(
      this.#rows,
      view ? visibleProperties(view, { fallback: true }) : [],
    );
  }

  /** What tells one run from another: the request, and the grouping the rows are gathered by. */
  #runKey(file: QueryFile, view: QueryFileView): string {
    return JSON.stringify([
      this.#request(file, view),
      view.groupBy ?? null,
      view.groupOrder ?? null,
    ]);
  }

  /** What ZotLit Query runs for one view of the file. */
  #request(file: QueryFile, view: QueryFileView): QueryViewRequest {
    const filter = viewFilter(file, view);
    const context = this.#host.context();
    return {
      from: view.from ?? "annotations",
      ...(filter === undefined ? {} : { filter }),
      ...(view.sort && {
        sort: view.sort.map(({ property, direction }) => ({
          field: property,
          direction: direction === "DESC" ? "desc" : "asc",
        })),
      }),
      fields: [
        ...new Set([
          ...LAYOUT_FIELDS,
          ...visibleProperties(view, { fallback: true }),
        ]),
      ],
      limit: view.limit ?? null,
      ...(context && { context }),
    };
  }

  /**
   * Write an edited file: the host saves its text, and the view named `show`
   * stays on screen.
   */
  #apply(next: QueryFile, show: string | null): void {
    const text = serializeQueryFile(next);
    this.#host.save?.(text);
    this.state.setState({ file: parseQueryFile(text) });
    this.#wanted = show;
    if (show !== null) this.#host.onSelectView?.(show);
    this.#choose();
  }

  /** The place of the view on screen in the file's list. */
  #shownIndex(): number {
    const { file, view } = this.state.getState();
    return file && view ? file.views.indexOf(view) : -1;
  }

  /** The name of the view at `index` in `file`, or `null` where it has none. */
  #nameAt(file: QueryFile, index: number): string | null {
    return file.views[index]?.name ?? null;
  }

  /** Add a view at the end of the list, and show it. Returns its name. */
  addView(base: string = m.query_view_new_view_name()): string {
    const { file } = this.state.getState();
    if (!file) return base;
    const edit = edits.addView(file, base);
    this.#apply(edit.file, edit.name);
    return edit.name;
  }

  renameView(index: number, name: string): void {
    const { file } = this.state.getState();
    if (!file) return;
    const shown = this.#shownIndex();
    const next = edits.renameView(file, index, name);
    this.#apply(next, this.#nameAt(next, shown));
  }

  /** Copy a view after itself, and show the copy. */
  duplicateView(index: number): void {
    const { file } = this.state.getState();
    if (!file) return;
    const edit = edits.duplicateView(file, index);
    this.#apply(edit.file, edit.name);
  }

  /** Delete a view; where it was on screen, the view before it shows. */
  deleteView(index: number): void {
    const { file } = this.state.getState();
    if (!file || file.views.length <= 1) return;
    const shown = this.#shownIndex();
    const edit = edits.deleteView(file, index);
    this.#apply(
      edit.file,
      shown === index
        ? edit.name
        : this.#nameAt(file, shown === -1 ? 0 : shown),
    );
  }

  /** Move a view to `to`; a move to `0` makes it the default view. */
  moveView(from: number, to: number): void {
    const { file } = this.state.getState();
    if (!file || from === to) return;
    const shown = this.#shownIndex();
    this.#apply(
      edits.moveView(file, from, to),
      this.#nameAt(file, shown === -1 ? 0 : shown),
    );
  }

  /** Set a layout option of a view, or remove it for `undefined`. */
  setViewOption(index: number, key: string, value: unknown): void {
    const { file } = this.state.getState();
    if (!file) return;
    this.#apply(
      edits.setViewOption(file, index, { key, value }),
      this.#nameAt(file, this.#shownIndex()),
    );
  }

  setViewLayout(index: number, type: string): void {
    const { file } = this.state.getState();
    if (!file) return;
    this.#apply(
      edits.setViewLayout(file, index, type),
      this.#nameAt(file, this.#shownIndex()),
    );
  }

  /** Run the view's query again, and show its rows. */
  refresh(): void {
    this.#run?.abort();
    this.#run = null;
    const { file, view, problems } = this.state.getState();
    if (!file || !view || problems.length > 0) {
      this.#runRequest = null;
      void this.#show(null);
      this.state.setState({
        phase: "idle",
        diagnostic: null,
        count: 0,
        matched: 0,
        groups: [],
        truncated: false,
      });
      return;
    }
    const controller = new AbortController();
    this.#run = controller;
    const request = this.#request(file, view);
    const key = this.#runKey(file, view);
    this.#runRequest = key;
    if (this.#shownRequest !== key) this.state.setState({ phase: "loading" });
    this.#settled = this.#deps.query.run(request, controller.signal).then(
      (outcome) => {
        if (this.#run !== controller) return;
        this.#run = null;
        return this.#land(key, view, outcome);
      },
      (error: unknown) => {
        if (this.#run !== controller) return;
        this.#run = null;
        logger.warn("A Query View could not run its query", { error });
        this.#fail(key, {
          code: "query-failed",
          message: error instanceof Error ? error.message : String(error),
          hint: "",
          report: [],
        });
      },
    );
  }

  async #land(
    key: string,
    view: QueryFileView,
    outcome: QueryViewOutcome,
  ): Promise<void> {
    switch (outcome.kind) {
      case "cancelled":
        return;
      case "failed":
        this.#fail(key, outcome.diagnostic);
        return;
      case "result": {
        const { result } = outcome;
        const shown = layoutRows(
          result.rows ?? [],
          view.groupBy,
          view.groupOrder,
        );
        const byKey = new Map(
          (result.rows ?? []).map((row) => [row.indexedKey, row]),
        );
        this.#rows = [
          ...new Set(shown.rows.map((row) => row.annotationKey)),
        ].map((key) => byKey.get(key)!);
        this.state.setState({
          phase: "ready",
          diagnostic: null,
          count: shown.count,
          matched: result.matchedCount,
          groups: shown.groups,
          truncated: result.truncated,
        });
        await this.#show(key, shown.rows);
        return;
      }
      default:
        outcome satisfies never;
    }
  }

  /**
   * A run that gives no rows says why. A refresh of the view on screen keeps
   * its last rows under the message; another view shows none.
   */
  #fail(key: string, diagnostic: QueryViewState["diagnostic"]): void {
    if (this.#shownRequest !== key) void this.#show(null);
    this.state.setState({ phase: "failed", diagnostic });
  }

  /** Put these rows on screen, holding their lists before the old ones go. */
  async #show(
    key: string | null,
    rows: Parameters<AnnotationsLayout["showRows"]>[0] = [],
  ): Promise<void> {
    const previous = this.#hold;
    this.#shownRequest = key;
    if (key === null) {
      this.#rows = [];
      this.#hold = null;
      this.#layout.clear();
      previous?.[Symbol.dispose]();
      return;
    }
    this.#hold = this.#deps.annotations.hold(
      rows.map((row) => row.attachmentKey),
    );
    await this.#layout.showRows(rows);
    previous?.[Symbol.dispose]();
  }
}

function useQueryViewState<T>(
  view: QueryView,
  selector: (state: QueryViewState) => T,
): T {
  return useStore(view.state, selector);
}

function Problems({ view }: { view: QueryView }) {
  const problems = useQueryViewState(view, (s) => s.problems);
  const phase = useQueryViewState(view, (s) => s.phase);
  const diagnostic = useQueryViewState(view, (s) => s.diagnostic);
  const unresolved = useAnnotStore((s) => s.unresolved);
  return (
    <>
      {problems.length > 0 && (
        <div
          className="zt:rounded zt:mx-3 zt:mt-2 zt:border zt:border-(--background-modifier-error) zt:p-2 zt:text-sm"
          role="alert"
          data-query-problems=""
        >
          {problems.map((problem) => (
            <p key={problem} className="zt:m-0">
              {problem}
            </p>
          ))}
        </div>
      )}
      {phase === "failed" && diagnostic && (
        <div
          className="zt:rounded zt:mx-3 zt:mt-2 zt:border zt:border-(--background-modifier-error) zt:p-2 zt:text-sm"
          role="alert"
          data-query-diagnostic={diagnostic.code}
        >
          <p className="zt:m-0 zt:font-semibold">{m.query_view_failed()}</p>
          {diagnostic.report.length > 0 ? (
            <pre className="zt:m-0 zt:mt-1 zt:overflow-auto zt:text-xs zt:whitespace-pre-wrap">
              {diagnostic.report.join("\n")}
            </pre>
          ) : (
            <p className="zt:m-0 zt:mt-1">
              {diagnostic.message} {diagnostic.hint}
            </p>
          )}
        </div>
      )}
      {unresolved.length > 0 && (
        <p
          className="zt:mx-3 zt:mt-2 zt:mb-0 zt:text-sm zt:text-(--text-warning)"
          data-query-unresolved={unresolved.length}
        >
          {m.query_view_unresolved({
            count: unresolved.length,
            keys: unresolved.join(", "),
          })}
        </p>
      )}
    </>
  );
}

function NoResults({ view }: { view: QueryView }) {
  const phase = useQueryViewState(view, (s) => s.phase);
  const count = useQueryViewState(view, (s) => s.count);
  if (phase !== "ready" || count > 0) return null;
  return (
    <div className="pane-empty zt:p-2" data-query-empty="">
      {m.query_view_no_results()}
    </div>
  );
}

function ReadOnlyNote({ view }: { view: QueryView }) {
  // A host can tell where it stands only once it is on the page, which is
  // before a run lands; each run asks again.
  useQueryViewState(view, (s) => s.phase);
  if (view.canSave) return null;
  return (
    <p
      className="zt:mx-3 zt:mt-1 zt:mb-0 zt:text-xs zt:text-(--text-faint)"
      data-query-read-only=""
    >
      {m.query_view_read_only()}
    </p>
  );
}

/** The cards, drawn with the shown view's Annotations layout options. */
function AnnotationsCards({ view }: { view: QueryView }) {
  const shown = useQueryViewState(view, (s) => s.view);
  const options = annotationsLayoutOptions(shown);
  const display = useMemo<CardDisplay>(
    () => ({
      comment: options.showComment,
      tags: options.showTags,
      page: options.showPage,
    }),
    [options.showComment, options.showTags, options.showPage],
  );
  return (
    <CardDisplayContext value={display}>
      <AnnotList collapsed cardWidth={options.cardWidth} />
    </CardDisplayContext>
  );
}

function OpenFileButton({ view }: { view: QueryView }) {
  const { openFile } = view;
  if (!openFile) return null;
  return (
    <button
      type="button"
      className="clickable-icon"
      aria-label={m.query_view_open_file()}
      data-query-open-file=""
      onClick={(event) => openFile(event.nativeEvent)}
    >
      <Icon name="external-link" size={14} />
    </button>
  );
}

function SortButton({ view }: { view: QueryView }) {
  const current = useQueryViewState(view, (s) => s.view);
  if (!current) return null;
  const sort = current.sort ?? [];
  return (
    <ToolbarPopover
      icon="arrow-up-down"
      label={m.query_view_sort()}
      active={sort.length > 0}
      hook="sort"
    >
      <SortEditor
        value={sort}
        options={sortOptions(current.from)}
        onChange={(next) =>
          view.editView({ sort: next.length > 0 ? next : undefined })
        }
      />
    </ToolbarPopover>
  );
}

function GroupButton({ view }: { view: QueryView }) {
  const current = useQueryViewState(view, (s) => s.view);
  const groups = useQueryViewState(view, (s) => s.groups);
  if (!current) return null;
  return (
    <ToolbarPopover
      icon="layout-list"
      label={m.query_view_group()}
      active={current.groupBy !== undefined}
      hook="group"
    >
      <GroupEditor
        value={{ groupBy: current.groupBy, groupOrder: current.groupOrder }}
        options={groupOptions()}
        groups={groups}
        onChange={(next) =>
          view.editView({
            groupBy: next.groupBy,
            groupOrder: next.groupOrder,
          })
        }
      />
    </ToolbarPopover>
  );
}

function QueryViewBody({ view }: { view: QueryView }) {
  return (
    <div className="zt:flex zt:h-full zt:flex-col">
      <div
        className="zt:flex zt:items-center zt:gap-2 zt:border-b zt:border-(--background-modifier-border) zt:px-3 zt:py-1 zt:text-sm"
        role="toolbar"
      >
        <ViewMenu view={view} />
        <ResultsMenu view={view} />
        <SortButton view={view} />
        <GroupButton view={view} />
        <PropertiesMenu view={view} />
        <span className="zt:flex-1" />
        <SearchControl />
        <OpenFileButton view={view} />
      </div>
      <ReadOnlyNote view={view} />
      <Problems view={view} />
      <NoResults view={view} />
      <AnnotationsCards view={view} />
    </div>
  );
}
