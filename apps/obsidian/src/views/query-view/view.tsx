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

import type { QueryContext } from "@zotlit/item-query";
import type { MatchTree } from "@zotlit/templates/facade";

import { Icon } from "@/components/obsidian/icon";
import { Effect } from "@/lib/effect";
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
  QueryViewResult,
  QueryViewRow,
} from "@/services/item-query/query-view";
import type { QueryService } from "@/services/item-query/service";
import { selectorKey } from "@/services/library-scope/scope";
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
import { datasetSpec } from "./datasets";
import { FilterButton } from "./filter-popover";
import type { FilterValues } from "./filter-popover";
import {
  faultedFormula,
  formulaCondition,
  readersOf,
  readFormulas,
} from "./formula-graph";
import { GroupEditor } from "./group-control";
import { annotationsLayoutOptions, layoutOf } from "./layouts";
import { ListLayout } from "./list-layout";
import { groupOptions, sortOptions } from "./properties";
import { PropertiesMenu } from "./properties-menu";
import {
  editView,
  formulaName,
  formulaProperty,
  locateFilterFault,
  parseQueryFile,
  removeFormula,
  serializeQueryFile,
  viewFilter,
  withDisplayName,
  withFilters,
  withFormula,
} from "./query-file";
import type {
  ConditionIssue,
  FilterSection,
  QueryFile,
  QueryFileDataset,
  QueryFileProblem,
  QueryFileSort,
  QueryFileView,
  QueryFileViewEdit,
} from "./query-file";
import type { ShownRecord } from "./record-rows";
import { ResultsMenu } from "./results-menu";
import { layoutFields, layoutRows } from "./rows";
import type { LayoutGroup } from "./rows";
import { SearchControl } from "./search-control";
import { SortEditor } from "./sort-control";
import { resultTable } from "./table";
import type { ResultTable } from "./table";
import { propertyLabel, TABLE_FIELDS, TableLayout } from "./table-layout";
import type { LiteratureNotes } from "./table-notes";
import { ToolbarPopover } from "./toolbar-popover";
import * as edits from "./view-edits";
import { unusedSettings } from "./view-edits";
import { ViewMenu } from "./view-menu";
import { visibleProperties } from "./visible-properties";

const logger = getLogger(["views", "query-view"]);

/** The services a Query View reads through. */
export interface QueryViewDeps extends AnnotationsLayoutDeps {
  annotations: AnnotationsLayoutDeps["annotations"] &
    Pick<AnnotationRepository, "hold">;
  query: Pick<QueryService, "run">;
  reads: AnnotationsLayoutDeps["reads"] &
    Pick<ZoteroReadsService, "on" | "acquireRead">;
  libraryScope: Pick<LibraryScopeService, "on" | "current">;
  /** The keyboard of a view that a note holds, which the embed and the block share. */
  cardFocus: Pick<QueryCardFocus, "hold">;
  /** The Table's "Literature note" column. */
  literatureNotes: LiteratureNotes;
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
  /** The condition of the filters that the last run's diagnostic marks. */
  filterIssue: ConditionIssue | null;
  /**
   * The Formulas the last run left out, since ZotLit Query names a mistake in
   * them: each name with the message. Their columns show no values.
   */
  formulaIssues: Readonly<Record<string, string>>;
  /** Whether a failed run left the last good rows on screen. */
  keptResults: boolean;
  /** The rows shown, each once however many groups it stands in. */
  count: number;
  /** The rows in the order they show, a row once in each group it stands in. */
  records: readonly ShownRecord[];
  /** The records that match the view, before its limit. */
  matched: number;
  /** Every group the rows hold, the shown ones first; empty when ungrouped. */
  groups: readonly LayoutGroup[];
  /** Whether the view's limit cut the rows short. */
  truncated: boolean;
  /** What the last run that gave rows says about its query, each once. */
  warnings: readonly QueryViewWarning[];
}

/** A warning of ZotLit Query about the view's query. */
export interface QueryViewWarning {
  code: QueryViewResult["warnings"][number]["code"];
  message: string;
}

const INITIAL_STATE: QueryViewState = {
  file: null,
  view: null,
  problems: [],
  phase: "idle",
  diagnostic: null,
  filterIssue: null,
  formulaIssues: {},
  keptResults: false,
  count: 0,
  records: [],
  matched: 0,
  groups: [],
  truncated: false,
  warnings: [],
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
    default:
      problem satisfies never;
      return "";
  }
}

/** What keeps the view's Layout from showing it, beside the parser's own problems. */
function layoutProblems(view: QueryFileView): string[] {
  const problems: string[] = [];
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

/** The keys of the Annotations the repository holds for an Attachment now. */
function annotationKeys(
  annotations: Pick<AnnotationRepository, "peek">,
  attachmentKey: string,
): ReadonlySet<string> | null {
  const held = annotations.peek(attachmentKey);
  return held ? new Set(held.value.annotations.map(({ key }) => key)) : null;
}

/** One run of a view: its request key, and the file and view it ran for. */
interface ViewRun {
  key: string;
  file: QueryFile;
  view: QueryFileView;
}

/** A diagnostic's message, with its hint after it where it has one. */
function diagnosticText({
  message,
  hint,
}: Pick<Diagnostic, "message" | "hint">): string {
  return [message, hint].filter(Boolean).join(" ");
}

export class QueryView extends Component implements HistorySurface {
  readonly state = createStore<QueryViewState>()(() => INITIAL_STATE);
  readonly #deps: QueryViewDeps;
  readonly #host: QueryViewHost;
  readonly #layout: AnnotationsLayout;
  /** The view the host asked for by name; the first view where `null`. */
  #wanted: string | null = null;
  #run: AbortController | null = null;
  /** Whether the rows on screen are drawn as Annotation Cards. */
  #cardsShown = false;
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
  /** The name of the view whose rows are on screen. */
  #shownViewName: string | null = null;
  /** The dataset of the rows on screen. */
  #shownDataset: QueryFileDataset | null = null;
  #settled: Promise<void> = Promise.resolve();
  /** The rows on screen, each once, in the order they show. */
  #rows: readonly QueryViewRow[] = [];
  #subscriptions: DisposableStack | null = null;
  /** Whether the view draws into an element; until then no card waits to show. */
  #rendered = false;
  /** The cards the list last drew, as the layout's store held them. */
  #drawnCards: AnnotState["annotations"] | undefined = undefined;
  /** What waits for the list to draw the cards the store holds now. */
  #drawWaiters: (() => void)[] = [];
  /** The Annotations of each Attachment the cards show, as the last run found them. */
  readonly #listKeys = new Map<string, ReadonlySet<string>>();
  #rerunTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The Annotations a list change added that no run's rows have named yet,
   * each with its Attachment's Indexed Key.
   */
  readonly #listAdded = new Map<string, string>();
  /** Whether the next run is the one a list change asked for. */
  #listRerun = false;

  constructor(deps: QueryViewDeps, host: QueryViewHost) {
    super();
    this.#deps = deps;
    this.#host = host;
    this.#layout = new AnnotationsLayout(deps, {
      ...host.layout,
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

  /** What the Table reads beside the rows: the queries of its child rows and its notes. */
  get tableDeps(): Pick<QueryViewDeps, "query" | "literatureNotes"> {
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
    subscriptions.defer(
      this.#deps.annotations.on("annotations-changed", (attachmentKey) =>
        this.#listChanged(attachmentKey),
      ),
    );
    subscriptions.defer(() => this.#cancelRerun());
  }

  /** Run again, after a short wait, once a shown Attachment gains or loses an Annotation. */
  #listChanged(attachmentKey: string): void {
    const before = this.#listKeys.get(attachmentKey);
    if (!before) return;
    const now = annotationKeys(this.#deps.annotations, attachmentKey);
    if (
      now === null ||
      (now.size === before.size && [...now].every((key) => before.has(key)))
    )
      return;
    this.#listKeys.set(attachmentKey, now);
    for (const key of now) {
      if (!before.has(key)) this.#listAdded.set(key, attachmentKey);
    }
    this.#cancelRerun();
    this.#rerunTimer = setTimeout(() => {
      this.#rerunTimer = null;
      this.#listRerun = true;
      this.refresh();
    }, RERUN_DELAY_MS);
  }

  #cancelRerun(): void {
    if (this.#rerunTimer !== null) clearTimeout(this.#rerunTimer);
    this.#rerunTimer = null;
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

  /** Read a Query File's text, and show the view the host asked for. */
  setText(text: string): void {
    this.state.setState({ file: parseQueryFile(text) });
    this.#choose();
  }

  /**
   * Show nothing and run nothing until the next {@link setText}: the host has
   * no Query Context to run the file with.
   */
  clear(): void {
    this.state.setState({ file: null });
    this.#runRequest = null;
    this.refresh();
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

  /** Whether the host saves the view's changes to the file. */
  get writable(): boolean {
    return this.#host.save !== undefined;
  }

  /**
   * Save new filters: for all views, or for the view shown. `undefined`
   * removes them. Answers whether the host saves the change.
   */
  setFilters(section: FilterSection, filters: MatchTree | undefined): boolean {
    const { file, view } = this.state.getState();
    if (!file || !view || !this.writable) return false;
    this.commit(
      withFilters(file, section === "all" ? null : view.name, filters),
    );
    return true;
  }

  /**
   * Save the Display Name of `property`; an empty name removes it. Answers
   * whether the host saves the change.
   */
  renameProperty(property: string, name: string): boolean {
    const { file } = this.state.getState();
    if (!file || !this.writable) return false;
    this.commit(withDisplayName(file, property, name.trim() || undefined));
    return true;
  }

  /**
   * Save the Formula `name` with its text and, where given, its Display Name;
   * an empty Display Name removes it. A new Formula also shows in the view on
   * screen, after its other properties. Answers whether the host saves the
   * change.
   */
  saveFormula(name: string, text: string, label?: string): boolean {
    const { file, view } = this.state.getState();
    if (!file || !view || !this.writable) return false;
    let next = withFormula(file, name, text);
    const property = formulaProperty(name);
    if (label !== undefined)
      next = withDisplayName(next, property, label.trim() || undefined);
    if (
      !Object.hasOwn(file.formulas ?? {}, name) &&
      !(view.order ?? []).includes(property)
    ) {
      // A view that shows no property chosen shows the defaults; they stay.
      const shown =
        visibleProperties(view).length > 0
          ? (view.order ?? [])
          : visibleProperties(view, { fallback: true });
      next = editView(next, view, { order: [...shown, property] });
    }
    this.commit(next);
    return true;
  }

  /**
   * Remove the Formula `name` from the file and from every view. Answers
   * whether the host saves the change.
   */
  removeFormula(name: string): boolean {
    const { file } = this.state.getState();
    if (!file || !this.writable) return false;
    this.commit(removeFormula(file, name));
    return true;
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
    const rows = this.state.getState().records.map(({ row, group }) => ({
      annotationKey: row.indexedKey,
      attachmentKey: row.attachmentIndexedKey ?? row.indexedKey,
      ...(group && { group }),
    }));
    this.#settled = this.#show(this.#shownRequest, cards ? rows : null);
  }

  /**
   * The rows on screen as a table, one column for each visible property in
   * the view's order: what "Copy to clipboard" and "Export CSV…" write.
   */
  table(): ResultTable {
    const { file, view } = this.state.getState();
    return resultTable(
      this.#rows,
      view ? visibleProperties(view, { fallback: true }) : [],
      (property) => propertyLabel(file, property),
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
   * What ZotLit Query runs for one view of the file, without the Formulas
   * named in `formulasLeftOut`.
   */
  #request(
    file: QueryFile,
    view: QueryFileView,
    formulasLeftOut: Readonly<Record<string, string>> = {},
  ): QueryViewRequest {
    const filter = viewFilter(file, view);
    const context = this.#host.context();
    const unused = new Set(unusedSettings(view).sort);
    const sort = view.sort?.filter(({ property }) => !unused.has(property));
    const fields = [
      ...new Set([
        ...layoutFields(view.from ?? "annotations"),
        ...(layoutOf(view)?.type === "table" ? TABLE_FIELDS : []),
        ...visibleProperties(view, { fallback: true }),
      ]),
    ].filter((field) => {
      const name = formulaName(field);
      return name === null || !Object.hasOwn(formulasLeftOut, name);
    });
    const formulas = readFormulas(file, fields, filter);
    for (const name of Object.keys(formulasLeftOut)) delete formulas[name];
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
    // A new view reads what the view on screen reads.
    const edit = edits.addView(
      file,
      base,
      this.state.getState().view?.from ?? "annotations",
    );
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

  /** Set the dataset a view reads; what the dataset lacks stays in the file, unused. */
  setViewDataset(index: number, dataset: QueryFileDataset): void {
    const { file } = this.state.getState();
    if (!file) return;
    this.#apply(
      edits.setViewDataset(file, index, dataset),
      this.#nameAt(file, this.#shownIndex()),
    );
  }

  /** Run the view's query again, and show its rows. */
  refresh(): void {
    this.#run?.abort();
    this.#run = null;
    const fromList = this.#listRerun;
    this.#listRerun = false;
    const { file, view, problems } = this.state.getState();
    if (!file || !view || problems.length > 0) {
      this.#runRequest = null;
      void this.#show(null);
      this.state.setState({
        phase: "idle",
        diagnostic: null,
        filterIssue: null,
        formulaIssues: {},
        count: 0,
        matched: 0,
        groups: [],
        truncated: false,
        warnings: [],
      });
      return;
    }
    const controller = new AbortController();
    this.#run = controller;
    const key = this.#runKey(file, view);
    this.#runRequest = key;
    if (this.#shownRequest !== key) this.state.setState({ phase: "loading" });
    // A mistake in a Formula leaves that Formula and the Formulas that read
    // it out, and the view runs again, so the other columns still show. The
    // filters cannot hold without a Formula they read: the view shows no rows.
    const runWithout = async (formulasLeftOut: Record<string, string>) => {
      for (;;) {
        const request = this.#request(file, view, formulasLeftOut);
        const outcome = await this.#deps.query.run(request, controller.signal);
        if (outcome.kind !== "failed") return { outcome };
        const name = faultedFormula(outcome.diagnostic, request);
        if (name === null || Object.hasOwn(formulasLeftOut, name))
          return { outcome };
        formulasLeftOut[name] = diagnosticText(outcome.diagnostic);
        for (const reader of readersOf(request.formulas ?? {}, name))
          formulasLeftOut[reader] ??= m.query_view_formula_reads_wrong({
            name,
          });
        const condition = formulaCondition(file, view, formulasLeftOut);
        if (condition) return { outcome, condition };
      }
    };
    const formulasLeftOut: Record<string, string> = {};
    this.#settled = runWithout(formulasLeftOut).then(
      ({ outcome, condition }) => {
        if (this.#run !== controller) return;
        this.#run = null;
        this.state.setState({ formulaIssues: formulasLeftOut });
        if (condition && outcome.kind === "failed") {
          this.#fail({ key, file, view }, outcome.diagnostic, condition);
          return;
        }
        return this.#land({ key, file, view }, outcome, fromList);
      },
      (error: unknown) => {
        if (this.#run !== controller) return;
        this.#run = null;
        logger.warn("A Query View could not run its query", { error });
        this.state.setState({ formulaIssues: formulasLeftOut });
        this.#fail(
          { key, file, view },
          {
            code: "query-failed",
            message: error instanceof Error ? error.message : String(error),
            hint: "",
            report: [],
          },
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
        this.#fail(run, outcome.diagnostic);
        return;
      case "result": {
        const { result } = outcome;
        // The query reads Zotero's database, which can take a new Annotation
        // after the repository's list does. Such a run keeps the cards on
        // screen, and the database change that follows runs the view again.
        const waiting = this.#lacksListAdded(result.rows ?? []);
        if (fromList && waiting) return;
        const shown = layoutRows(
          result.rows ?? [],
          usedGroupBy(view),
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
          filterIssue: null,
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
   * Whether these rows lack an Annotation a list change added that the
   * repository still holds. An added Annotation the rows name, or that the
   * repository no longer holds, is no longer waited for.
   */
  #lacksListAdded(rows: readonly QueryViewRow[]): boolean {
    const named = new Set(rows.map((row) => row.indexedKey));
    for (const [key, attachmentKey] of this.#listAdded) {
      if (
        named.has(key) ||
        !annotationKeys(this.#deps.annotations, attachmentKey)?.has(key)
      )
        this.#listAdded.delete(key);
    }
    return this.#listAdded.size > 0;
  }

  /**
   * A run that gives no rows says why. A refresh of the rows on screen, or a
   * new filter of the view they belong to, keeps them under the message;
   * another view shows none. A fault in one condition of the filters is
   * marked at that condition. A condition that reads a Formula with a mistake
   * (`formulaCondition`) is marked with that Formula's message, and the view
   * shows no rows.
   */
  #fail(
    { key, file, view }: ViewRun,
    diagnostic: Diagnostic | NonNullable<QueryViewState["diagnostic"]>,
    formulaCondition?: ConditionIssue,
  ): void {
    const kept =
      formulaCondition === undefined &&
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
    this.state.setState({
      phase: "failed",
      diagnostic,
      warnings: [],
      keptResults: kept,
      filterIssue:
        formulaCondition ??
        (at && { ...at, message: diagnosticText(diagnostic) }),
    });
  }

  /**
   * Put these rows on screen, holding their lists before the old ones go.
   * `null` rows stand for a Layout that draws no Annotation Cards: it shows
   * the rows from the state, and holds no list.
   */
  async #show(
    key: string | null,
    rows: Parameters<AnnotationsLayout["showRows"]>[0] | null = [],
  ): Promise<void> {
    const previous = this.#hold;
    this.#shownRequest = key;
    if (key === null) {
      this.#shownViewName = null;
      this.#rows = [];
      this.state.setState({ records: [] });
    }
    this.#cardsShown = key !== null && rows !== null;
    this.#listKeys.clear();
    if (key === null || rows === null) {
      this.#hold = null;
      this.#layout.clear();
      previous?.[Symbol.dispose]();
      return;
    }
    const also = this.#host.attachments?.() ?? [];
    const attachmentKeys = [
      ...new Set([...rows.map((row) => row.attachmentKey), ...also]),
    ];
    this.#hold = this.#deps.annotations.hold(attachmentKeys);
    await this.#layout.showRows(rows, also);
    previous?.[Symbol.dispose]();
    if (this.#shownRequest !== key) return;
    for (const attachmentKey of attachmentKeys) {
      const keys = annotationKeys(this.#deps.annotations, attachmentKey);
      if (keys) this.#listKeys.set(attachmentKey, keys);
    }
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
  const filterIssue = useQueryViewState(view, (s) => s.filterIssue);
  const keptResults = useQueryViewState(view, (s) => s.keptResults);
  // A fault in one condition, under the last good rows, is marked at its row
  // in the Filter popover; the view says only that the filter has an error.
  const marked = filterIssue !== null && keptResults;
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

/** What the view keeps in its file but does not use, since its dataset lacks it. */
function UnusedNote({ view }: { view: QueryView }) {
  const current = useQueryViewState(view, (s) => s.view);
  if (!current) return null;
  const unused = unusedSettings(current);
  const properties = [
    ...new Set([
      ...unused.sort,
      ...(unused.groupBy === null ? [] : [unused.groupBy]),
      ...unused.order,
    ]),
  ];
  if (properties.length === 0) return null;
  return (
    <p
      className="zt:mx-3 zt:mt-1 zt:mb-0 zt:text-xs zt:text-(--text-muted) zt:in-[.print]:hidden"
      data-query-unused=""
    >
      {m.query_view_unused({
        dataset: datasetSpec(current.from).name(),
        properties: properties.join(", "),
      })}
    </p>
  );
}

function Warnings({ view }: { view: QueryView }) {
  const phase = useQueryViewState(view, (s) => s.phase);
  const warnings = useQueryViewState(view, (s) => s.warnings);
  if (phase !== "ready" || warnings.length === 0) return null;
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
  const count = useQueryViewState(view, (s) => s.count);
  const dataset = useQueryViewState(view, (s) => s.view?.from);
  if (phase !== "ready" || count > 0) return null;
  return (
    <div className="pane-empty zt:p-2" data-query-empty="">
      {datasetSpec(dataset).empty()}
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
      className="zt:mx-3 zt:mt-1 zt:mb-0 zt:text-xs zt:text-(--text-faint) zt:in-[.print]:hidden"
      data-query-read-only=""
    >
      {m.query_view_read_only()}
    </p>
  );
}

/** Whether the view's Layout draws live Annotation Cards. */
function drawsCards(view: QueryFileView): boolean {
  return layoutOf(view)?.type === "annotations";
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
        unused={unusedSettings(current).sort}
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
        options={groupOptions(current.from)}
        unused={unusedSettings(current).groupBy !== null}
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
    <div className="zt:flex zt:h-full zt:flex-col zt:in-[.print]:h-auto">
      {/* The toolbar is a size container: on a narrow pane its buttons show
          icons only. Export to PDF prints the rows without it. */}
      <div
        className="zt:@container zt:flex zt:flex-wrap zt:items-center zt:gap-x-2 zt:gap-y-1 zt:border-b zt:border-(--background-modifier-border) zt:px-3 zt:py-1 zt:text-sm zt:in-[.print]:hidden"
        role="toolbar"
      >
        <ViewMenu view={view} />
        <ResultsMenu view={view} />
        <FilterButton view={view} />
        <SortButton view={view} />
        <GroupButton view={view} />
        <PropertiesMenu view={view} />
        <span className="zt:flex-1" />
        <SearchControl view={view} />
        <OpenFileButton view={view} />
      </div>
      <ReadOnlyNote view={view} />
      <UnusedNote view={view} />
      <Problems view={view} />
      <Warnings view={view} />
      <NoResults view={view} />
      <LayoutBody view={view} />
    </div>
  );
}
