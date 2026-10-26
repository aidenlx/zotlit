// The one Items query of ZotLit Query that tests Profile Matches: the request
// for many Items and many filters, and what its outcome says of each Item.
import { formatIndexedKey } from "@zotlit/db";
import type { Item } from "@zotlit/db";

import type { Diagnostic } from "@/services/item-query/contract";
import type {
  QueryViewOutcome,
  QueryViewRequest,
} from "@/services/item-query/query-view";

export type MatchItem = Pick<Item, "key" | "groupID">;

/** Whether each filter holds for one Item, and each filter's Diagnostic. */
export interface ItemMatches {
  matched: readonly boolean[];
  faults: readonly (Diagnostic | undefined)[];
}

/** One query's test of many Items, by Indexed Key; a missing Item has none. */
export type BatchMatches =
  | { kind: "result"; byKey: ReadonlyMap<string, ItemMatches> }
  | { kind: "failed"; diagnostic?: Diagnostic };

/**
 * The Items query that tests each of `items` against each of `filters`, over
 * the Libraries the Items belong to.
 */
export function matchesRequest(
  items: readonly MatchItem[],
  filters: readonly string[],
): QueryViewRequest {
  // `!!` gives the truth a filter reads: null and an Error Value are false.
  const formulas = Object.fromEntries(
    filters.map((filter, index) => [`match${index}`, `!!(${filter})`]),
  );
  const indexedKeys = items.map(({ key, groupID }) =>
    formatIndexedKey(key, groupID),
  );
  return {
    from: "items",
    // A literal list of Indexed Keys plans as a key lookup, not a scan.
    filter: `${JSON.stringify(indexedKeys)}.contains(indexedKey)`,
    fields: Object.keys(formulas).map((name) => `formula.${name}`),
    formulas,
    libraries: {
      mode: "selected",
      libraries: [...new Set(items.map(({ groupID }) => groupID))].map(
        (groupID) =>
          groupID === null
            ? { type: "personal" as const }
            : { type: "group" as const, groupID },
      ),
    },
  };
}

/**
 * What the outcome of {@link matchesRequest} says of each Item: whether each
 * filter holds and the Diagnostic of each filter that cannot be evaluated, or
 * the failure, with its Diagnostic where it gives one.
 */
export function readMatches(
  outcome: QueryViewOutcome,
  filters: readonly string[],
): BatchMatches {
  if (outcome.kind === "cancelled") return { kind: "failed" };
  if (outcome.kind === "failed")
    return { kind: "failed", diagnostic: outcome.diagnostic };
  const faultsByName: Readonly<Record<string, Diagnostic | undefined>> =
    outcome.result.formulaDiagnostics ?? {};
  const faults = filters.map((_, index) => faultsByName[`match${index}`]);
  return {
    kind: "result",
    byKey: new Map(
      (outcome.result.rows ?? []).map((row) => [
        row.indexedKey,
        {
          matched: filters.map(
            (_, index) => row.values[`formula.match${index}`] === true,
          ),
          faults,
        },
      ]),
    ),
  };
}
