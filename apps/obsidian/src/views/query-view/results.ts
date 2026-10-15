// The rows of the last run of a Query View that gave rows, kept as one
// value: a run that lands replaces them whole, and a failed run keeps them
// whole or clears them.
import { nameDictionary } from "@zotlit/item-query";
import type { NameDictionary } from "@zotlit/item-query";

import type { QueryViewRow } from "@/services/item-query/query-view";

import type { ConditionIssue } from "./query-file";
import type { ReaderDiagnosticSource } from "./reader-diagnostic";
import type { ShownRecord } from "./record-rows";
import type { LayoutGroup } from "./rows";
import type { QueryViewState, QueryViewWarning } from "./view";

/** The rows of one run that gave rows, and what the run says about them. */
export interface ResultSnapshot {
  /** The rows shown, each once, in the order they show. */
  rows: readonly QueryViewRow[];
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
  /** What the run says about its query, each once. */
  warnings: readonly QueryViewWarning[];
  /**
   * The Formulas the run left out, since ZotLit Query names a mistake in
   * them: each name with the message. Their columns show no values.
   */
  formulaIssues: NameDictionary<string>;
}

/** Why a run gave no rows. */
export interface QueryViewFailure {
  diagnostic: ReaderDiagnosticSource;
  /** The condition of the filters that the diagnostic marks. */
  filterIssue: ConditionIssue | null;
  /** The Formulas the run left out, by name, with the message of each. */
  formulaIssues: NameDictionary<string>;
}

/** No rows: what a reader of the results sees while none are on screen. */
export const NO_RESULTS: ResultSnapshot = {
  rows: [],
  count: 0,
  records: [],
  matched: 0,
  groups: [],
  truncated: false,
  warnings: [],
  formulaIssues: nameDictionary(),
};

/**
 * The Formula marks of what the view shows: those of the rows on screen, or
 * of the failed run that cleared them.
 */
export function formulaIssuesOf(
  state: Pick<QueryViewState, "results" | "failure">,
): NameDictionary<string> {
  return (
    state.results?.formulaIssues ??
    state.failure?.formulaIssues ??
    NO_RESULTS.formulaIssues
  );
}
