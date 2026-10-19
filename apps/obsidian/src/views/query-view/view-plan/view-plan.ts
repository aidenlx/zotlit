// The View Plan: what ZotLit Query runs for one view of a Query File, and
// apart from it the sort keys and the conditions that read a vault property,
// which the vault answers. `limit` counts the rows the researcher sees, so
// the plan is made before ZotLit Query runs and lays out the rows it returns,
// never filtering them after. The Query View and the mixed-query bench both
// plan through it; the order of the steps lives here alone.
//
// @see apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md
import type { QueryContext } from "@zotlit/item-query";

import type {
  QueryViewRequest,
  QueryViewRow,
} from "@/services/item-query/query-view";
import type { LibraryScope } from "@/services/library-scope/scope";
import { grouping } from "@/views/query-view/datasets";
import { layoutOf } from "@/views/query-view/layouts";
import { PAPERS_FIELDS } from "@/views/query-view/papers-layout";
import { isVaultProperty } from "@/views/query-view/query-file";
import type {
  FilterLocation,
  QueryFile,
  QueryFileView,
} from "@/views/query-view/query-file";
import type { ReaderDiagnosticSource } from "@/views/query-view/reader-diagnostic";
import { layoutRows } from "@/views/query-view/rows";
import type { LayoutRows } from "@/views/query-view/rows";
import { TABLE_FIELDS } from "@/views/query-view/table-layout";
import type { VaultHost, VaultValue } from "@/views/query-view/table-notes";
import {
  vaultSortRequest,
  vaultSortedLayout,
} from "@/views/query-view/vault-sort";
import {
  unusedSettings,
  usedGroupBy,
  viewProperties,
} from "@/views/query-view/view-properties";

import { splitFilters } from "./filter-split";
import type { FilterSplit } from "./filter-split";
import { planVaultFilter } from "./vault-filter";
import type { VaultFilter } from "./vault-filter";

/** The Literature Notes a plan reads, as the Query View's reader gives them. */
export interface ViewPlanNotes {
  /** The Indexed Keys of the Items that have a Literature Note. */
  itemKeys(): Iterable<string>;
  /** The vault property `name` of an Item, read as the note that holds the view, `host`, reads it. */
  read(itemKey: string, name: string, host: VaultHost | null): VaultValue;
}

/** What a plan reads beside the file and the view. */
export interface ViewPlanSources {
  /** The Query Context `this` reads; `undefined` where it has no value. */
  context(): QueryContext | undefined;
  /**
   * The Libraries the query reads, as the Library View gives its selected
   * Library; absent or `undefined`: the Library Scope in force.
   */
  libraries?(): LibraryScope | undefined;
  /** Extra projection paths the host reads for the shown layout. */
  fields?(view: QueryFileView): readonly string[];
  /** The note that holds the view and the Item it names; `null` elsewhere. */
  host(): VaultHost | null;
  notes: ViewPlanNotes;
}

/** A vault condition the vault cannot answer, which keeps the view from running. */
export interface ViewPlanFault {
  readonly at: FilterLocation;
  readonly diagnostic: ReaderDiagnosticSource;
}

/** The plan of one view. */
export interface ViewPlan {
  /**
   * What tells one run from another: the request, what the vault answers
   * apart from it, the limit, and the grouping the rows are gathered by.
   */
  readonly key: string;
  /** What ZotLit Query runs. It never reads a vault property. */
  readonly request: QueryViewRequest;
  /** What keeps the view from running; `null` where it runs. */
  readonly fault: ViewPlanFault | null;
  /**
   * The condition on the Indexed Key that stands for the vault conditions on
   * the last line of the request's filter; `null` where it needs none.
   */
  readonly keys: string | null;
  /**
   * The rows ZotLit Query returned, as the view lays them out: sorted by its
   * vault sort keys and cut to its `limit` where it has any. `dropped` says
   * whether the limit left any out.
   */
  layout<R extends QueryViewRow>(
    rows: readonly R[],
  ): LayoutRows & { dropped: boolean };
  /**
   * The condition that a fault at `span` of the request's filter marks, or
   * `null` when the span falls inside no one condition.
   */
  locate(span: {
    readonly from: number;
    readonly to: number;
  }): FilterLocation | null;
}

/**
 * Plans the views of a Query File. It reads every Literature Note only for
 * a plan whose vault conditions, Query Dataset or host note differ from
 * the last one, or once {@link notesChanged} says the notes did: a new Query
 * Context alone plans without them.
 */
export class ViewPlanner {
  readonly #sources: ViewPlanSources;
  /** The filters of the last view planned. */
  #split: { file: QueryFile; view: QueryFileView; split: FilterSplit } | null =
    null;
  /** The vault filter of the last plan, by what it was planned from. */
  #vaultFilter: { key: string; filter: VaultFilter } | null = null;

  constructor(sources: ViewPlanSources) {
    this.#sources = sources;
  }

  /** The Literature Notes changed: the next plan reads them again. */
  notesChanged(): void {
    this.#vaultFilter = null;
  }

  /**
   * The plan of one view of the file. It sends every Formula of the file:
   * ZotLit Query plans only those that the view reads.
   */
  plan(file: QueryFile, view: QueryFileView): ViewPlan {
    const split = this.#splitOf(file, view);
    const host = this.#sources.host();
    const vaultFilter = this.#vaultFilterOf(split, view, host);
    const keys = "condition" in vaultFilter ? vaultFilter.condition : null;
    const engine = split.engine(keys);
    const unused = new Set(unusedSettings(view).sort);
    const used =
      view.sort?.filter(({ property }) => !unused.has(property)) ?? [];
    const sort = used.filter(({ property }) => !isVaultProperty(property));
    const vaultSort = used.filter(({ property }) => isVaultProperty(property));
    const grouped = view.groupBy && grouping(view.from, view.groupBy.property);
    const fields = [
      ...new Set([
        ...(grouped?.fields ?? []),
        ...layoutFields(view),
        ...(this.#sources.fields?.(view) ?? []),
        ...viewProperties(file, view).queried.map(({ path }) => path),
      ]),
    ];
    const formulas = file.formulas ?? {};
    const context = this.#sources.context();
    const libraries = this.#sources.libraries?.();
    const request: QueryViewRequest = {
      from: view.from ?? "annotations",
      ...(engine && { filter: engine.text }),
      ...(sort.length > 0 && {
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
    const planned = vaultSort.length > 0 ? vaultSortRequest(request) : request;
    const notes = this.#sources.notes;
    return {
      key: JSON.stringify([
        planned,
        // A vault sort keeps the view's limit out of the request.
        {
          sort: vaultSort,
          conditions: split.vault.map(({ section, path, text }) => ({
            section,
            path,
            text,
          })),
          filter: vaultFilter,
        },
        view.limit ?? null,
        usedGroupBy(view) ?? null,
        view.groupOrder ?? null,
      ]),
      request: planned,
      fault: "fault" in vaultFilter ? vaultFilter.fault : null,
      keys,
      layout: (rows) =>
        vaultSort.length > 0
          ? vaultSortedLayout(rows, view, {
              sort: used,
              read: (row, name) => notes.read(row.indexedKey, name, host),
            })
          : { ...layoutRows(rows, view), dropped: false },
      locate: (span) => engine?.locate(span) ?? null,
    };
  }

  /** The split of the view's filters, made once for each file and view. */
  #splitOf(file: QueryFile, view: QueryFileView): FilterSplit {
    if (this.#split?.file !== file || this.#split.view !== view)
      this.#split = { file, view, split: splitFilters(file, view) };
    return this.#split.split;
  }

  /** The vault conditions of a view, planned against its Literature Notes. */
  #vaultFilterOf(
    { vault, stranded }: FilterSplit,
    view: QueryFileView,
    host: VaultHost | null,
  ): VaultFilter {
    const keyPath =
      (view.from ?? "annotations") === "items"
        ? "indexedKey"
        : "item.indexedKey";
    const key = JSON.stringify([vault, stranded, keyPath, host]);
    if (this.#vaultFilter?.key === key) return this.#vaultFilter.filter;
    const { notes } = this.#sources;
    const filter = planVaultFilter({
      conditions: vault,
      stranded,
      notes: {
        itemKeys: () => notes.itemKeys(),
        read: (itemKey, name) => notes.read(itemKey, name, host),
      },
      keyPath,
    });
    this.#vaultFilter = { key, filter };
    return filter;
  }
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
