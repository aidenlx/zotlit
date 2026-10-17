// The one Query View: a Query File's text, one of its views, and the rows
// ZotLit Query gives for it, drawn by the view's Layout. It is host-neutral:
// the Query File tab mounts it today, and the embed, the Query Block and the
// sidebar mount the same part, each with its own Query Context.
//
// @see apps/obsidian/docs/adr/0068-query-files-are-a-zotlit-file-type-embedded-through-the-private-embed-registry.md
// @see apps/obsidian/docs/adr/0069-the-annotation-view-is-the-annotations-layout-of-the-query-view.md
import { Component } from "obsidian";
import type { Scope } from "obsidian";
import { useLayoutEffect, useMemo } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { nameDictionary } from "@zotlit/item-query";
import type { NameDictionary, QueryContext } from "@zotlit/item-query";

import { Effect } from "@/lib/effect";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import type { HistorySurface } from "@/services/annotation-repository/actions";
import type { HistoryDirection } from "@/services/annotation-repository/service";
import type { Diagnostic } from "@/services/item-query/contract";
import type {
  QueryViewOutcome,
  QueryViewRequest,
  QueryViewRow,
} from "@/services/item-query/query-view";
import type { QueryService } from "@/services/item-query/service";
import { selectorKey } from "@/services/library-scope/scope";
import type { LibraryScope } from "@/services/library-scope/scope";
import type { LibraryScopeService } from "@/services/library-scope/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";
import { AnnotList } from "@/views/annot-view/AnnotView";
import { CardDisplayContext } from "@/views/annot-view/card-display";
import type { CardDisplay } from "@/views/annot-view/card-display";
import { AnnotationsLayout } from "@/views/annot-view/layout";
import type {
  AnnotationsLayoutDeps,
  AnnotationsLayoutHost,
} from "@/views/annot-view/layout";
import { useAnnotStore } from "@/views/annot-view/store";
import type { AnnotState } from "@/views/annot-view/store";

import type { QueryCardFocus } from "./card-focus";
import { CardsLayout } from "./cards-layout";
import { contextHint } from "./context-hint";
import type { ContextSource } from "./context-hint";
import { datasetSpec, grouping } from "./datasets";
import { FilterButton } from "./filter-popover";
import type { FilterValues } from "./filter-popover";
import { GroupEditor } from "./group-control";
import type { ItemRowGestures } from "./item-rows";
import { annotationsLayoutOptions, layoutOf } from "./layouts";
import { ListLayout } from "./list-layout";
import { PAPERS_FIELDS, PapersLayout } from "./papers-layout";
import { groupOptions, sortOptions } from "./properties";
import { PropertiesMenu } from "./properties-menu";
import { locateFilterFault, viewFilter } from "./query-file";
import type {
  QueryFile,
  QueryFileDataset,
  QueryFileProblem,
  QueryFileSort,
  QueryFileView,
} from "./query-file";
import { QueryFileDocument } from "./query-file-document";
import {
  correctionsText,
  readerDiagnostic,
  readerText,
} from "./reader-diagnostic";
import { NO_RESULTS } from "./results";
import type {
  QueryViewFailure,
  QueryViewWarning,
  ResultSnapshot,
} from "./results";
import { ResultsMenu } from "./results-menu";
import { layoutRows } from "./rows";
import { SearchButton, SearchRow, useSearchBar } from "./search-control";
import { SortEditor } from "./sort-control";
import { resultTable } from "./table";
import type { ResultTable } from "./table";
import { TABLE_FIELDS, TableLayout } from "./table-layout";
import type { LiteratureNotes } from "./table-notes";
import type { TableReaders } from "./table-readers";
import { ToolbarButton } from "./toolbar-button";
import { ToolbarPopover } from "./toolbar-popover";
import { ViewMenu } from "./view-menu";
import {
  unusedSettings,
  useViewProperties,
  viewProperties,
} from "./view-properties";

const logger = getLogger(["views", "query-view"]);

/** The services a Query View reads through. */
export interface QueryViewDeps extends AnnotationsLayoutDeps {
  query: Pick<QueryService, "run">;
  reads: AnnotationsLayoutDeps["reads"] &
    Pick<ZoteroReadsService, "on" | "acquireRead">;
  libraryScope: Pick<LibraryScopeService, "on" | "current">;
  /** The keyboard of a view that a note holds, which the embed and the block share. */
  cardFocus: Pick<QueryCardFocus, "hold">;
  /** What the Table's Literature Note Property reads and does. */
  literatureNotes: LiteratureNotes;
  /** The Table's Attachment and Annotation links. */
  readers: TableReaders;
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
  /**
   * The surface the host is, by what it binds to `this`; a filter that reads
   * a record with none bound shows where to get one. Absent in a Query
   * File's own tab, which binds nothing.
   */
  contextSource?: ContextSource;
  /** The user chose another view of the file; the host may remember it. */
  onSelectView?: (name: string) => void;
  /**
   * Write the file's new text after a toolbar change, at once. It rejects
   * where the text was not saved; the change then stays on screen and the
   * toolbar says that it is not saved. The text comes back through
   * {@link QueryView.setText} as the host reads it again. A host without a
   * file saves to plugin data through `pluginDataStorage`.
   */
  save: (text: string) => void | Promise<void>;
  /**
   * Whether a change in the view can stay. Where it is `false`, the view
   * saves nothing, and the toolbar says that a change is not saved.
   */
  canSave?: () => boolean;
  /** Open the Query File; the toolbar shows a link button when the host gives it. */
  openFile?: (event: MouseEvent) => void;
  /**
   * What the host gives the Annotations Layout beside the Scope and the
   * source path: the sidebar's own gestures and its list frame.
   */
  layout?: Pick<
    AnnotationsLayoutHost,
    "gestures" | "onList" | "onEscape" | "showNewRecords"
  >;
  /**
   * The Attachments whose live lists the cards read beside those the rows
   * name: the sidebar's own, so its first new Annotation shows at once.
   */
  attachments?: () => readonly string[];
  /**
   * The Libraries the query reads: the Library View's selected Library.
   * Absent: the Library Scope in force. A change runs again through
   * {@link QueryView.contextChanged}.
   *
   * @see apps/obsidian/docs/adr/0071-the-library-tree-writes-filters.md
   */
  libraries?: () => LibraryScope;
  /**
   * Whether the host keeps only the shown view's sort, Layout and Visible
   * Properties, as the Library View Document does. The view then offers no
   * other change: no other view, grouping, filter, limit, column width,
   * Display Name or Formula, which would show and then be gone on reopen.
   *
   * @see apps/obsidian/docs/adr/0070-the-library-view-is-a-fileless-query-view-host-that-saves-to-plugin-data.md
   */
  displayOnly?: boolean;
  /**
   * The Layout types the host offers, in the order its view menu lists them.
   * Absent: every Layout of the view's dataset.
   *
   * @see apps/obsidian/docs/adr/0074-the-papers-layout-is-a-query-view-layout-the-library-view-offers-with-the-table.md
   */
  layouts?: readonly string[];
  /**
   * What a click, a double click, the context menu and a drag do on an Item
   * row of the Papers and Table Layouts. Absent: the rows take no gesture.
   *
   * @see apps/obsidian/docs/adr/0073-library-view-rows-act-as-quick-switcher-results.md
   */
  rows?: ItemRowGestures;
  /**
   * Why `row` is in the list, such as "edited in Zotero" on the Library
   * View's Recent; the Papers reading-state line ends with it. `null`: no
   * reason. Absent: no row gives one.
   *
   * @see apps/obsidian/docs/adr/0075-recent-is-a-library-tree-node-that-writes-a-sort.md
   */
  reason?: (row: QueryViewRow) => string | null;
  /**
   * Writes what the view shows as a new Query File. Present: the view menu
   * of a host without views (`displayOnly`) offers "Save as query file".
   */
  saveAs?: () => void;
  /**
   * The Indexed Keys in the order the rows show in, in place of the sort: the
   * Library View's ranked search. `null` or absent: the order of the query.
   *
   * @see apps/obsidian/docs/adr/0072-search-enters-the-library-view-as-an-ordered-key-set.md
   */
  rank?: () => readonly string[] | null;
}

/**
 * The changes the toolbar offers. A host that keeps only the shown view's
 * sort, Layout and Visible Properties (`displayOnly`) takes away every other
 * one, so no control shows a change that would be gone on reopen. Each
 * control reads its own flag here.
 *
 * @see apps/obsidian/docs/adr/0070-the-library-view-is-a-fileless-query-view-host-that-saves-to-plugin-data.md
 */
export interface QueryViewCapabilities {
  /**
   * Add, configure, reorder and switch the file's views. Without it the view
   * menu switches only the Layout of the view on screen (ADR 0074).
   */
  readonly views: boolean;
  readonly group: boolean;
  readonly filter: boolean;
  /** Set and clear the row limit. */
  readonly limit: boolean;
  /** Resize a Table column and reset its width. */
  readonly columnWidth: boolean;
  /** Open a property's page: its Display Name, its Formula, "Add formula". */
  readonly propertyPages: boolean;
}

const EVERY_CHANGE: QueryViewCapabilities = Object.freeze({
  views: true,
  group: true,
  filter: true,
  limit: true,
  columnWidth: true,
  propertyPages: true,
});

const DISPLAY_CHANGES: QueryViewCapabilities = Object.freeze({
  views: false,
  group: false,
  filter: false,
  limit: false,
  columnWidth: false,
  propertyPages: false,
});

/** What the view shows now, as the toolbar and the host read it. */
export interface QueryViewState {
  file: QueryFile | null;
  /** The view shown; `null` while the file has none. */
  view: QueryFileView | null;
  /** What keeps the view from running, for the file and for the view. */
  problems: readonly string[];
  phase: "idle" | "loading" | "ready" | "failed";
  /**
   * The rows of the last run that gave rows, with what that run says about
   * them; `null` while no rows are on screen. A failed run keeps them whole
   * or clears them.
   */
  results: ResultSnapshot | null;
  /** Why the last run gave no rows; `null` once a run gives rows. */
  failure: QueryViewFailure | null;
  /** Whether the host could not save the last toolbar change. */
  saveFailed: boolean;
}

const INITIAL_STATE: QueryViewState = {
  file: null,
  view: null,
  problems: [],
  phase: "idle",
  results: null,
  failure: null,
  saveFailed: false,
};

/** The text of a warning: the researcher's words where ZotLit has them. */
function warningText(warning: QueryViewWarning): string {
  return warning.code === "key-outside-target-libraries"
    ? m.query_view_warning_outside_library_scope()
    : warning.message;
}

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
    case "duplicate-view-name":
      return m.query_view_problem_duplicate_view({ name: problem.name });
    default:
      problem satisfies never;
      return "";
  }
}

/** What keeps the view's Layout from showing it, beside the parser's own problems. */
function layoutProblems(view: QueryFileView): string[] {
  const problems: string[] = [];
  // The Layout gathers the rows into groups itself, by the groupings of the
  // view's dataset; a grouping of no dataset, such as a Formula, it cannot do.
  const group = usedGroupBy(view)?.property;
  if (group !== undefined && grouping(view.from, group) === undefined)
    problems.push(m.query_view_problem_group({ property: group }));
  const layout = layoutOf(view);
  if (!layout) problems.push(m.query_view_problem_layout({ type: view.type }));
  else if (!layout.datasets.includes(view.from ?? "annotations"))
    problems.push(
      layout.type === "annotations"
        ? m.query_view_problem_dataset()
        : m.query_view_problem_layout_dataset({
            layout: layout.name(),
            datasets: layout.datasets.join(", "),
          }),
    );
  return problems;
}

/** The view's grouping, where its dataset has the group path. */
function usedGroupBy(view: QueryFileView): QueryFileSort | undefined {
  return unusedSettings(view).groupBy === null ? view.groupBy : undefined;
}

/**
 * How long the view waits after an Attachment it shows gains or loses an
 * Annotation before it runs again, so a burst of changes runs it once.
 */
export const RERUN_DELAY_MS = 300;

/** One run of a view: its request key, and the file and view it ran for. */
interface ViewRun {
  key: string;
  file: QueryFile;
  view: QueryFileView;
}

/** The faults of a filter that reads a Formula it cannot have. */
const FORMULA_READ_FAULTS: ReadonlySet<string> = new Set([
  "reads-faulted-formula",
  "unknown-formula",
]);

/** The reason of each Formula that the run left out, by name. */
function formulaIssues(outcome: QueryViewOutcome): NameDictionary<string> {
  const faults =
    outcome.kind === "result"
      ? outcome.result.formulaDiagnostics
      : outcome.kind === "failed"
        ? outcome.formulaDiagnostics
        : undefined;
  return nameDictionary(
    Object.entries(faults ?? {}).map(([name, diagnostic]) => [
      name,
      readerText(diagnostic),
    ]),
  );
}

export class QueryView extends Component implements HistorySurface {
  readonly state = createStore<QueryViewState>()(() => INITIAL_STATE);
  readonly #deps: QueryViewDeps;
  readonly #host: QueryViewHost;
  readonly #layout: AnnotationsLayout;
  /** The file's text, the view on screen, the edits and their saves. */
  readonly #document: QueryFileDocument;
  #run: AbortController | null = null;
  /** Whether the rows on screen are drawn as Annotation Cards. */
  #cardsShown = false;
  /**
   * The request whose rows are on screen, which a failed refresh keeps. An
   * edit that leaves the request as it is, such as a new view name or a card
   * option, keeps the rows and runs nothing.
   */
  #shownRequest: string | null = null;
  /** The request of the last run the view started. */
  #runRequest: string | null = null;
  /** The name of the view whose rows are on screen. */
  #shownViewName: string | null = null;
  /** The dataset of the rows on screen. */
  #shownDataset: QueryFileDataset | null = null;
  #settled: Promise<void> = Promise.resolve();
  #subscriptions: DisposableStack | null = null;
  /** Whether the view draws into an element; until then no card waits to show. */
  #rendered = false;
  /** The cards the list last drew, as the layout's store held them. */
  #drawnCards: AnnotState["annotations"] | undefined = undefined;
  /** What waits for the list to draw the cards the store holds now. */
  #drawWaiters: (() => void)[] = [];
  #rerunTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(deps: QueryViewDeps, host: QueryViewHost) {
    super();
    this.#deps = deps;
    this.#host = host;
    this.#document = new QueryFileDocument(host, {
      show: () => this.#choose(),
      saveFailed: (saveFailed) => this.state.setState({ saveFailed }),
    });
    this.#layout = new AnnotationsLayout(deps, {
      ...host.layout,
      scope: host.scope,
      sourcePath: host.sourcePath,
      onListChanged: () => this.#listChanged(),
    });
  }

  /**
   * The Query File on screen: its text, the view on screen, and every edit,
   * which saves through the host.
   */
  get document(): QueryFileDocument {
    return this.#document;
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

  /**
   * What the Table reads beside the rows: the queries of its child rows, its
   * notes, and the readers its links open.
   */
  get tableDeps(): Pick<
    QueryViewDeps,
    "query" | "literatureNotes" | "readers"
  > {
    return this.#deps;
  }

  /** Settles once the cards show the last run the view started. Never rejects. */
  get settled(): Promise<void> {
    return this.#settled.then(() => this.#layout.read);
  }

  /**
   * Settles once the cards of the last run are drawn on the page in `el`, as
   * Export to PDF needs before it prints: a print renders under `.print`.
   * Elsewhere it settles as {@link settled}. Never rejects.
   */
  async shownIn(el: HTMLElement): Promise<void> {
    await this.settled;
    // A List or Cards layout draws its rows from the state, with no list of
    // cards to wait for.
    if (el.closest(".print") !== null && this.#cardsShown)
      await this.#cardsDrawn();
  }

  /**
   * The list drew these cards. Preact subscribes a list to its store only
   * after a paint, so a hidden print window can draw a store change later
   * than the read that made it.
   */
  drewCards(cards: AnnotState["annotations"]): void {
    this.#drawnCards = cards;
    if (cards !== this.#layout.store.getState().annotations) return;
    const waiters = this.#drawWaiters;
    this.#drawWaiters = [];
    for (const resolve of waiters) resolve();
  }

  #cardsDrawn(): Promise<void> {
    if (
      !this.#rendered ||
      this.#drawnCards === this.#layout.store.getState().annotations
    )
      return Promise.resolve();
    return new Promise((resolve) => this.#drawWaiters.push(resolve));
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
    // reads the live records again; an Annotation added to or removed from an
    // Attachment the cards show runs the query again, so it takes its place.
    subscriptions.defer(reads.on("changed", rerun));
    subscriptions.defer(reads.on("degraded", rerun));
    subscriptions.defer(reads.on("db-file-missing", rerun));
    subscriptions.defer(libraryScope.on("libraries-changed", rerun));
    subscriptions.defer(() => this.#cancelRerun());
  }

  /** Run again, after a short wait, once a shown Attachment gains or loses an Annotation. */
  #listChanged(): void {
    this.#cancelRerun();
    this.#rerunTimer = setTimeout(() => {
      this.#rerunTimer = null;
      this.#refresh(true);
    }, RERUN_DELAY_MS);
  }

  #cancelRerun(): void {
    if (this.#rerunTimer !== null) clearTimeout(this.#rerunTimer);
    this.#rerunTimer = null;
  }

  override onunload(): void {
    void this.flush();
    this.#subscriptions?.dispose();
    this.#subscriptions = null;
    this.#run?.abort();
    this.#run = null;
    this.#shownRequest = null;
    this.#runRequest = null;
    this.#rendered = false;
    const waiters = this.#drawWaiters;
    this.#drawWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /** Draw the toolbar and the cards into `el`. Call it once the view has loaded. */
  render(el: HTMLElement): void {
    el.addClass("zt-query-view");
    this.#rendered = true;
    this.#layout.render(el, <QueryViewBody view={this} />);
  }

  /**
   * Read a Query File's text, and show the view the host asked for. The text
   * the file on screen was read from changes nothing, so the host gives the
   * view's own save back as it reads it. A new Query Context comes through
   * {@link contextChanged}.
   */
  setText(text: string): void {
    this.#document.setText(text);
  }

  /**
   * The host's Query Context may have changed: run again where the view's
   * query reads another one.
   */
  contextChanged(): void {
    const { file, view, problems } = this.state.getState();
    if (!file || !view || problems.length > 0) return;
    if (this.#runKey(file, view) !== this.#runRequest) this.refresh();
  }

  /**
   * Show nothing and run nothing until the next {@link setText}: the host has
   * no Query Context to run the file with.
   */
  clear(): void {
    this.#document.clear();
    this.state.setState({ file: null });
    this.#runRequest = null;
    this.refresh();
  }

  /** Whether a change in the view can stay. */
  get canSave(): boolean {
    return this.#document.canSave;
  }

  /** Save typed text that waits for its delay now. Settles once the host wrote it. Never rejects. */
  flush(): Promise<void> {
    return this.#document.flush();
  }

  /** The values a filter condition offers, from the Libraries the view reads. */
  async filterValues(): Promise<FilterValues> {
    const libraries = this.#deps.libraryScope.current?.available ?? [];
    await using lease = await this.#deps.reads.acquireRead();
    const tags = new Set<string>();
    for (const { libraryID } of libraries)
      for (const tag of await Effect.runPromise(
        lease.reads.TagNames({ libraryID }),
      ))
        tags.add(tag);
    const collections = await Effect.runPromise(
      lease.reads.CollectionPaths({
        libraryIDs: libraries.map(({ libraryID }) => libraryID),
      }),
    );
    return {
      tags: [...tags].sort(),
      collections: collections.map((path) => path.join("/")),
      libraries: libraries.map(({ selector, name }) => ({
        id: selectorKey(selector),
        name,
      })),
    };
  }

  /** The surface the host is, by what it binds to `this`. */
  get contextSource(): ContextSource | undefined {
    return this.#host.contextSource;
  }

  /** The changes the toolbar offers, as the host keeps them. */
  get can(): QueryViewCapabilities {
    return this.#host.displayOnly === true ? DISPLAY_CHANGES : EVERY_CHANGE;
  }

  /** The Layout types the host offers; `undefined` for every one. */
  get layouts(): readonly string[] | undefined {
    return this.#host.layouts;
  }

  /** What the host does on the gestures over an Item row. */
  get rows(): ItemRowGestures | undefined {
    return this.#host.rows;
  }

  /** Why `row` is in the list, as the host says; `null` for no reason. */
  reason(row: QueryViewRow): string | null {
    return this.#host.reason?.(row) ?? null;
  }

  /** The host's "Save as query file", for the view menu. */
  get saveAs(): QueryViewHost["saveAs"] {
    return this.#host.saveAs;
  }

  /** The host's link to the Query File, for the toolbar. */
  get openFile(): QueryViewHost["openFile"] {
    return this.#host.openFile;
  }

  /** Show the view named `name`, or the file's first view for `null`. */
  selectView(name: string | null): void {
    this.#document.selectView(name);
  }

  /** The name of the view shown, as the host remembers it. */
  get viewName(): string | null {
    return this.#document.viewName;
  }

  /** The user picked a view from the view menu. */
  pickView(name: string): void {
    this.#document.pickView(name);
  }

  /** The document shows another file or view: say what keeps it from running, and run it. */
  #choose(): void {
    const { file, view, wanted } = this.#document;
    if (!file) return;
    const problems = file.problems.map(problemText);
    if (view) {
      problems.push(...view.problems.map(problemText), ...layoutProblems(view));
    } else if (wanted !== null && file.views.length > 0) {
      problems.push(m.query_view_problem_no_view({ name: wanted }));
    }
    this.state.setState({ file, view, problems });
    if (
      view &&
      problems.length === 0 &&
      this.#runKey(file, view) === this.#runRequest
    ) {
      // Another Layout of the same query draws the rows on screen as they are.
      if (this.#shownRequest === this.#runRequest) this.#redraw(view);
      return;
    }
    this.refresh();
  }

  /** Draw the rows on screen as Annotation Cards, or let the cards go, as the view's Layout asks. */
  #redraw(view: QueryFileView): void {
    const cards = drawsCards(view);
    if (cards === this.#cardsShown) return;
    const records = this.state.getState().results?.records ?? [];
    const rows = records.map(({ row, group }) => ({
      annotationKey: row.indexedKey,
      attachmentKey: row.attachmentIndexedKey ?? row.indexedKey,
      ...(group && { group }),
    }));
    this.#settled = this.#show(this.#shownRequest, cards ? rows : null);
  }

  /**
   * The rows on screen as a table, one column for each visible property in
   * the view's order: what "Copy to clipboard" and "Export CSV…" write. The
   * Literature Note Property is no value of a row, so it writes no column.
   */
  table(): ResultTable {
    const { file, view } = this.state.getState();
    return resultTable(
      this.state.getState().results?.rows ?? [],
      view ? viewProperties(file, view).queried : [],
    );
  }

  /** What tells one run from another: the request, and the grouping the rows are gathered by. */
  #runKey(file: QueryFile, view: QueryFileView): string {
    return JSON.stringify([
      this.#request(file, view),
      usedGroupBy(view) ?? null,
      view.groupOrder ?? null,
    ]);
  }

  /**
   * What ZotLit Query runs for one view of the file. It sends every Formula
   * of the file: ZotLit Query plans only those that the view reads.
   */
  #request(file: QueryFile, view: QueryFileView): QueryViewRequest {
    const filter = viewFilter(file, view);
    const context = this.#host.context();
    const libraries = this.#host.libraries?.();
    const unused = new Set(unusedSettings(view).sort);
    const sort = view.sort?.filter(({ property }) => !unused.has(property));
    const grouped = view.groupBy && grouping(view.from, view.groupBy.property);
    const fields = [
      ...new Set([
        ...(grouped?.fields ?? []),
        ...layoutFields(view),
        ...viewProperties(file, view).queried.map(({ path }) => path),
      ]),
    ];
    const formulas = file.formulas ?? {};
    return {
      from: view.from ?? "annotations",
      ...(filter === undefined ? {} : { filter }),
      ...(sort &&
        sort.length > 0 && {
          sort: sort.map(({ property, direction }) => ({
            field: property,
            direction: direction === "DESC" ? "desc" : "asc",
          })),
        }),
      fields,
      ...(Object.keys(formulas).length > 0 && { formulas }),
      limit: view.limit ?? null,
      ...(libraries && { libraries }),
      ...(context && { context }),
    };
  }

  /** Run the view's query again, and show its rows. */
  refresh(): void {
    this.#refresh(false);
  }

  /** @param fromList whether a list change asked for the run. */
  #refresh(fromList: boolean): void {
    this.#run?.abort();
    this.#run = null;
    const { file, view, problems } = this.state.getState();
    if (!file || !view || problems.length > 0) {
      this.#runRequest = null;
      void this.#show(null);
      this.state.setState({
        phase: "idle",
        results: null,
        failure: null,
      });
      return;
    }
    const controller = new AbortController();
    this.#run = controller;
    const key = this.#runKey(file, view);
    this.#runRequest = key;
    if (this.#shownRequest !== key) this.state.setState({ phase: "loading" });
    // A Formula with a mistake, and each Formula that reads it, is left out
    // of the rows; the outcome gives the reason for each.
    this.#settled = this.#deps.query
      .run(this.#request(file, view), controller.signal)
      .then(
        (outcome) => {
          if (this.#run !== controller) return;
          this.#run = null;
          return this.#land({ key, file, view }, outcome, fromList);
        },
        (error: unknown) => {
          if (this.#run !== controller) return;
          this.#run = null;
          logger.warn("A Query View could not run its query", { error });
          this.#fail(
            { key, file, view },
            {
              code: "query-failed",
              message: error instanceof Error ? error.message : String(error),
              hint: "",
            },
            nameDictionary(),
          );
        },
      );
  }

  async #land(
    run: ViewRun,
    outcome: QueryViewOutcome,
    fromList = false,
  ): Promise<void> {
    const { key, view } = run;
    switch (outcome.kind) {
      case "cancelled":
        return;
      case "failed":
        this.#fail(run, outcome.diagnostic, formulaIssues(outcome));
        return;
      case "result": {
        const { result } = outcome;
        // The query reads Zotero's database, which can take a new Annotation
        // after the repository's list does. Such a run keeps the cards on
        // screen, and the database change that follows runs the view again.
        const named = (result.rows ?? []).map((row) => row.indexedKey);
        const cause = fromList
          ? "list-change"
          : key === this.#shownRequest
            ? "rerun"
            : "new-request";
        if (this.#layout.keepsBack(named, cause)) return;
        const rows = ranked(result.rows ?? [], this.#host.rank?.() ?? null);
        const shown = layoutRows(rows, view);
        const byKey = new Map(rows.map((row) => [row.indexedKey, row]));
        this.state.setState({
          phase: "ready",
          results: {
            rows: [...new Set(shown.rows.map((row) => row.annotationKey))].map(
              (key) => byKey.get(key)!,
            ),
            count: shown.count,
            records: shown.rows.map(({ annotationKey, group }) => ({
              row: byKey.get(annotationKey)!,
              ...(group && { group }),
            })),
            matched: result.matchedCount,
            groups: shown.groups,
            truncated: result.truncated,
            warnings: [
              ...new Map(
                result.warnings.map(({ code, message }) => [
                  code === "key-outside-target-libraries" ? code : message,
                  { code, message },
                ]),
              ).values(),
            ],
            formulaIssues: formulaIssues(outcome),
          },
          failure: null,
        });
        // The Layout may have changed while the query ran.
        const current = this.state.getState().view ?? view;
        await this.#show(key, drawsCards(current) ? shown.rows : null);
        this.#shownViewName = view.name;
        this.#shownDataset = view.from ?? "annotations";
        return;
      }
      default:
        outcome satisfies never;
    }
  }

  /**
   * A run that gives no rows says why. A refresh of the rows on screen, or a
   * new filter of the view they belong to, keeps them under the message;
   * another view shows none. A fault in one condition of the filters is
   * marked at that condition. The filters cannot hold without a Formula they
   * read: a condition that reads a Formula with a mistake, or one that the
   * file does not define, shows no rows. Kept rows keep the Formula marks of
   * the run that gave them; `issues` mark the Formulas otherwise.
   */
  #fail(
    { key, file, view }: ViewRun,
    diagnostic: Diagnostic | QueryViewFailure["diagnostic"],
    issues: NameDictionary<string>,
  ): void {
    const kept =
      !FORMULA_READ_FAULTS.has(diagnostic.code) &&
      (this.#shownRequest === key ||
        (this.#shownRequest !== null &&
          this.#shownViewName === view.name &&
          this.#shownDataset === (view.from ?? "annotations")));
    if (!kept) void this.#show(null);
    const span =
      "location" in diagnostic && diagnostic.location?.argument === "filter"
        ? diagnostic.location.span
        : undefined;
    const at = span ? locateFilterFault(file, view, span) : null;
    this.state.setState((state) => ({
      phase: "failed",
      results: kept ? state.results : null,
      failure: {
        diagnostic,
        filterIssue: at && {
          ...at,
          message: readerText(diagnostic),
        },
        formulaIssues: issues,
      },
    }));
  }

  /**
   * Put these rows on screen, from the lists the layout holds for them.
   * `null` rows stand for a Layout that draws no Annotation Cards: it shows
   * the rows from the state, and holds no list.
   */
  async #show(
    key: string | null,
    rows: Parameters<AnnotationsLayout["showRows"]>[0] | null = [],
  ): Promise<void> {
    this.#shownRequest = key;
    if (key === null) this.#shownViewName = null;
    this.#cardsShown = key !== null && rows !== null;
    if (key === null || rows === null) {
      this.#layout.clear();
      return;
    }
    await this.#layout.showRows(rows, this.#host.attachments?.() ?? []);
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
  const diagnostic = useQueryViewState(view, (s) => s.failure?.diagnostic);
  const marked = useQueryViewState(
    view,
    (s) => (s.failure?.filterIssue ?? null) !== null && s.results !== null,
  );
  // A fault in one condition, under the last good rows, is marked at its row
  // in the Filter popover; the view says only that the filter has an error.
  const unresolved = useAnnotStore((s) => s.unresolved);
  const hint =
    phase === "failed" && diagnostic
      ? contextHint(diagnostic, view.contextSource)
      : null;
  return (
    <>
      {hint !== null && (
        <p
          className="zt:mx-3 zt:mt-2 zt:mb-0 zt:text-sm zt:text-(--text-muted)"
          data-query-context-hint=""
        >
          {hint}
        </p>
      )}
      {problems.length > 0 && (
        <div
          className="zt:mx-3 zt:mt-2 zt:rounded-sm zt:border-(length:--border-width) zt:border-(--background-modifier-error) zt:p-2 zt:text-sm"
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
      {phase === "failed" && marked && (
        <p
          className="zt:mx-3 zt:mt-2 zt:mb-0 zt:text-sm zt:text-(--text-error)"
          role="alert"
          data-query-filter-error=""
        >
          {m.query_view_filter_error()}
        </p>
      )}
      {phase === "failed" && !marked && diagnostic && (
        <div
          className="zt:mx-3 zt:mt-2 zt:rounded-sm zt:border-(length:--border-width) zt:border-(--background-modifier-error) zt:p-2 zt:text-sm"
          role="alert"
          data-query-diagnostic={diagnostic.code}
        >
          <p className="zt:m-0 zt:font-semibold">{m.query_view_failed()}</p>
          <DiagnosticText diagnostic={diagnostic} />
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

/**
 * What the run's diagnostic says, and where the filter holds the fault: its
 * line, with a caret under the fault. The corrections ZotLit Query gives
 * follow.
 */
function DiagnosticText({
  diagnostic,
}: {
  diagnostic: QueryViewFailure["diagnostic"];
}) {
  const { sentence, corrections, excerpt } = readerDiagnostic(diagnostic);
  if (!excerpt)
    return <p className="zt:m-0 zt:mt-1">{readerText(diagnostic)}</p>;
  return (
    <>
      <pre className="zt:m-0 zt:mt-1 zt:overflow-auto zt:text-xs zt:whitespace-pre-wrap">
        {sentence}
        {"\n"}
        {excerpt.line}
        {"\n"}
        {" ".repeat(excerpt.from)}
        <span className="zt:text-(--text-error)">
          {"^".repeat(excerpt.length)}
        </span>
      </pre>
      {corrections.length > 0 && (
        <p className="zt:m-0 zt:mt-1">{correctionsText(corrections)}</p>
      )}
    </>
  );
}

/**
 * The parent record a grouping by Item or by Attachment reads, by the name
 * the notice gives it: a view of Items has no parent item to group by.
 */
const PARENTS: Partial<Record<string, () => string>> = {
  "item.indexedKey": m.query_view_property_parent_item,
  "attachment.indexedKey": m.query_view_property_source_attachment,
};

/**
 * What the view keeps in its file but does not use: what its dataset lacks,
 * the properties of the dataset that no cell shows, and those it cannot
 * sort by. Each property shows by its label, as a column header does.
 */
function UnusedNote({ view }: { view: QueryView }) {
  const current = useQueryViewState(view, (s) => s.view);
  const entries = useViewProperties(view);
  if (!current || !entries) return null;
  const { unused } = entries;
  const { engine, name } = datasetSpec(current.from);
  const known = (property: string) => engine.definition(property) !== undefined;
  // A property the dataset has that no cell shows, such as the tags of
  // Items, and one it has that ZotLit Query cannot sort by.
  const unshown = unused.order.filter(known);
  const unsorted = unused.sort.filter(known);
  const properties = [
    ...new Set([
      ...unused.sort.filter((property) => !known(property)),
      ...(unused.groupBy === null ? [] : [unused.groupBy]),
      ...unused.order.filter((property) => !known(property)),
    ]),
  ];
  const labels = (list: readonly string[]) =>
    list
      .map((property) => PARENTS[property]?.() ?? entries.entry(property).label)
      .join(", ");
  const text = [
    properties.length > 0
      ? m.query_view_unused({ dataset: name(), properties: labels(properties) })
      : "",
    unshown.length > 0
      ? m.query_view_unshown({ dataset: name(), properties: labels(unshown) })
      : "",
    unsorted.length > 0
      ? m.query_view_unsorted({ dataset: name(), properties: labels(unsorted) })
      : "",
  ]
    .filter((sentence) => sentence !== "")
    .join(" ");
  if (text === "") return null;
  return (
    <p
      className="zt:mx-3 zt:mt-1 zt:mb-0 zt:text-xs zt:text-(--text-muted) zt:in-[.print]:hidden"
      data-query-unused=""
    >
      {text}
    </p>
  );
}

function Warnings({ view }: { view: QueryView }) {
  // The warnings belong to the rows on screen, which a failed run can keep.
  const warnings = useQueryViewState(
    view,
    (s) => (s.results ?? NO_RESULTS).warnings,
  );
  if (warnings.length === 0) return null;
  return (
    <>
      {warnings.map((warning) => (
        <p
          key={warning.message}
          className="zt:mx-3 zt:mt-2 zt:mb-0 zt:text-sm zt:text-(--text-warning)"
          data-query-warning={warning.code}
        >
          {warningText(warning)}
        </p>
      ))}
    </>
  );
}

function NoResults({ view }: { view: QueryView }) {
  const phase = useQueryViewState(view, (s) => s.phase);
  const count = useQueryViewState(view, (s) => s.results?.count ?? 0);
  const dataset = useQueryViewState(view, (s) => s.view?.from);
  // A filter of this view or of all views can be what leaves it empty.
  const filtered = useQueryViewState(
    view,
    (s) => s.file?.filters !== undefined || s.view?.filters !== undefined,
  );
  if (phase !== "ready" || count > 0) return null;
  return (
    <div className="pane-empty zt:p-2" data-query-empty="">
      {datasetSpec(dataset).empty()}
      {filtered && (
        <p className="zt:m-0 zt:mt-1" data-query-empty-hint="">
          {m.query_view_no_results_filter_hint()}
        </p>
      )}
    </div>
  );
}

function ReadOnlyNote({ view }: { view: QueryView }) {
  // A host can tell where it stands only once it is on the page, which is
  // before a run lands; each run asks again.
  useQueryViewState(view, (s) => s.phase);
  const saveFailed = useQueryViewState(view, (s) => s.saveFailed);
  if (view.canSave && !saveFailed) return null;
  return (
    <p
      className="zt:mx-3 zt:mt-1 zt:mb-0 zt:text-xs zt:text-(--text-faint) zt:in-[.print]:hidden"
      data-query-read-only=""
    >
      {m.query_view_read_only()}
    </p>
  );
}

/** The paths the view's Layout reads from each row beside the visible properties. */
function layoutFields(view: QueryFileView): readonly string[] {
  switch (layoutOf(view)?.type) {
    case "table":
      return TABLE_FIELDS;
    case "papers":
      return PAPERS_FIELDS;
    default:
      return [];
  }
}

/** Whether the view's Layout draws live Annotation Cards. */
function drawsCards(view: QueryFileView): boolean {
  return layoutOf(view)?.type === "annotations";
}

/** `rows` in the order of `rank`, where the host gives one. */
function ranked<Row extends { indexedKey: string }>(
  rows: readonly Row[],
  rank: readonly string[] | null,
): readonly Row[] {
  if (rank === null) return rows;
  const place = new Map(rank.map((key, index) => [key, index]));
  return rows.toSorted(
    (a, b) =>
      (place.get(a.indexedKey) ?? rank.length) -
      (place.get(b.indexedKey) ?? rank.length),
  );
}

/** The rows, drawn by the shown view's Layout. */
function LayoutBody({ view }: { view: QueryView }) {
  const type = useQueryViewState(view, (s) =>
    s.view ? layoutOf(s.view)?.type : undefined,
  );
  switch (type) {
    case "list":
      return <ListLayout view={view} />;
    case "cards":
      return <CardsLayout view={view} />;
    case "table":
      return <TableLayout view={view} />;
    case "papers":
      return <PapersLayout view={view} />;
    default:
      return <AnnotationsCards view={view} />;
  }
}

/** The cards, drawn with the shown view's Annotations layout options. */
function AnnotationsCards({ view }: { view: QueryView }) {
  const shown = useQueryViewState(view, (s) => s.view);
  const cards = useAnnotStore((s) => s.annotations);
  useLayoutEffect(() => view.drewCards(cards), [view, cards]);
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
    <ToolbarButton
      icon="external-link"
      label={m.query_view_open_file()}
      labelClassName="zt:sr-only"
      data-query-open-file=""
      onClick={(event) => openFile(event.nativeEvent)}
    />
  );
}

function SortButton({ view }: { view: QueryView }) {
  const current = useQueryViewState(view, (s) => s.view);
  const properties = useViewProperties(view);
  if (!current || !properties) return null;
  const sort = current.sort ?? [];
  return (
    <ToolbarPopover
      icon="arrow-up-down"
      label={m.query_view_sort()}
      active={sort.length > 0}
      count={sort.length}
      hook="sort"
    >
      <SortEditor
        value={sort}
        options={sortOptions(
          current.from,
          (path) => properties.entry(path).label,
        )}
        unused={properties.unused.sort}
        onChange={(next) =>
          view.document.editView({ sort: next.length > 0 ? next : undefined })
        }
      />
    </ToolbarPopover>
  );
}

function GroupButton({ view }: { view: QueryView }) {
  const current = useQueryViewState(view, (s) => s.view);
  const groups = useQueryViewState(
    view,
    (s) => (s.results ?? NO_RESULTS).groups,
  );
  const properties = useViewProperties(view);
  if (!current || !properties) return null;
  return (
    <ToolbarPopover
      icon="layout-list"
      label={m.query_view_group()}
      active={current.groupBy !== undefined}
      hook="group"
    >
      <GroupEditor
        value={{ groupBy: current.groupBy, groupOrder: current.groupOrder }}
        options={groupOptions(
          current.from,
          (path) => properties.entry(path).label,
        )}
        unused={properties.unused.groupBy !== null}
        groups={groups}
        onChange={(next) =>
          view.document.editView({
            groupBy: next.groupBy,
            groupOrder: next.groupOrder,
          })
        }
      />
    </ToolbarPopover>
  );
}

function QueryViewBody({ view }: { view: QueryView }) {
  const search = useSearchBar();
  return (
    <div className="zt:flex zt:h-full zt:flex-col zt:in-[.print]:h-auto">
      {/* The toolbar is a size container: on a narrow pane its buttons show
          icons only, and it stays one row. In a Query File tab it runs to
          the pane's edges, as the Bases header does (see file-view.css).
          Export to PDF prints the rows without it. */}
      <div
        className="zt:@container zt:flex zt:min-h-(--size-4-10) zt:shrink-0 zt:flex-nowrap zt:items-center zt:gap-(--size-2-2) zt:overflow-hidden zt:border-b-(length:--border-width) zt:border-(--table-border-color) zt:ps-[var(--zt-query-toolbar-inset-start,var(--size-2-1))] zt:pe-[var(--zt-query-toolbar-inset-end,var(--size-2-1))] zt:in-[.is-mobile]:min-h-(--touch-size-l) zt:in-[.print]:hidden"
        role="toolbar"
      >
        <ViewMenu view={view} />
        <ResultsMenu view={view} />
        <SortButton view={view} />
        {view.can.group && <GroupButton view={view} />}
        {view.can.filter && <FilterButton view={view} />}
        <PropertiesMenu view={view} />
        <SearchButton bar={search} />
        <OpenFileButton view={view} />
      </div>
      <SearchRow view={view} bar={search} />
      <ReadOnlyNote view={view} />
      <UnusedNote view={view} />
      <Problems view={view} />
      <Warnings view={view} />
      <NoResults view={view} />
      <LayoutBody view={view} />
    </div>
  );
}
