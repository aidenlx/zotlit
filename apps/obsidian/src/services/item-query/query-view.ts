// The typed call of a Query View to ZotLit Query: the request that the view
// gives, and the parsed groups of rows that it reads back. The call skips the
// CLI text path, so it has no default limit and no inline size bound. Request
// and result are plain JSON: they cross the ZoteroReads worker seam as they are.

import type {
  FormulaFaults,
  GroupValue,
  ItemQuery,
  QueryContext,
  QuerySummary,
  SortSpec,
} from "@zotlit/item-query";

import type { LibraryScope } from "@/services/library-scope/scope";

import type { Diagnostic, LibraryWire } from "./contract";
import type { QueryDatasetId } from "./worker-protocol";

/** The query of one Query View. Omitted keys take the engine defaults. */
export interface QueryViewRequest {
  /** The Query Dataset that the view reads. */
  readonly from: QueryDatasetId;
  /** The Filter Expression. Omitted: every record matches. */
  readonly filter?: string;
  /** The Projection Paths of each row. Omitted: the dataset default. */
  readonly fields?: readonly string[];
  /**
   * The Formulas the query reads: each name with its Filter Expression text.
   * A row holds a Formula's value under `formula.<name>` when `fields` names
   * it. Omitted: the request has none.
   */
  readonly formulas?: Readonly<Record<string, string>>;
  /** The Sortable Fields, the first one first. Omitted: the dataset default. */
  readonly sort?: readonly SortSpec[];
  /** One group path. Omitted: the result is one list of rows. */
  readonly group?: string;
  /**
   * The most rows to return, inside each group when grouped. Omitted or
   * `null`: every match.
   */
  readonly limit?: number | null;
  /** The Target Libraries. Omitted: the Library Scope in force. */
  readonly libraries?: LibraryScope;
  /**
   * The Query Context: the Indexed Keys of the Item and the Attachment that
   * a filter reads as `this.item` and `this.attachment`. Omitted: `this` has
   * no value, and a filter that reads it fails with `unbound-context`.
   */
  readonly context?: QueryContext;
}

/** A value of one Projection Path as JSON: a date is its ISO text. */
export type QueryViewValue =
  | null
  | string
  | number
  | boolean
  | readonly QueryViewValue[]
  | { readonly [key: string]: QueryViewValue };

export interface QueryViewRow {
  readonly indexedKey: string;
  readonly attachmentIndexedKey?: string;
  readonly itemIndexedKey?: string;
  /** One entry for each requested Projection Path. */
  readonly values: Readonly<Record<string, QueryViewValue>>;
}

export interface QueryViewGroup {
  readonly value: GroupValue;
  /** The records of this group, before the limit. */
  readonly count: number;
  readonly rows: readonly QueryViewRow[];
}

/** The rows of one call, with the metadata of the engine. */
export type QueryViewResult = {
  /** The Target Libraries that the call read. */
  readonly libraries: readonly LibraryWire[];
  /** The normalized query that the engine ran. */
  readonly query: ItemQuery;
  readonly returnedCount: number;
  /** The matching records, each once, before the limit. */
  readonly matchedCount: number;
  readonly truncated: boolean;
  readonly warnings: QuerySummary["warnings"];
  /**
   * The Formulas that the query left out, each with its Diagnostic: a
   * Formula with a mistake, or one that reads such a Formula.
   */
  readonly formulaFaults?: FormulaFaults;
} & (
  | {
      readonly rows: readonly QueryViewRow[];
      readonly groups?: never;
      readonly totalCount?: never;
    }
  | {
      readonly groups: readonly QueryViewGroup[];
      /** The matching records, each once. */
      readonly totalCount: number;
      readonly rows?: never;
    }
);

/**
 * The outcome of one call:
 * - `result`: the parsed rows.
 * - `failed`: the query is invalid or the source cannot answer; `diagnostic`
 *   is the one that `zotlit:query` reports for the same query.
 * - `cancelled`: the caller aborted the call before it settled.
 */
export type QueryViewOutcome =
  | { readonly kind: "result"; readonly result: QueryViewResult }
  | {
      readonly kind: "failed";
      readonly diagnostic: Diagnostic;
      /** As in the result, where the filter reads a Formula with a mistake. */
      readonly formulaFaults?: FormulaFaults;
    }
  | { readonly kind: "cancelled" };
