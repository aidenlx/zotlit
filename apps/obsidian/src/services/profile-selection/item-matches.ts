// The test of one Item against Profile Match filters, for the Template
// Workbench's Match tab.
import { formatIndexedKey } from "@zotlit/db";

import type { Diagnostic } from "@/services/item-query/contract";
import type { QueryHandle } from "@/services/item-query/handle";

import { matchesRequest, readMatches } from "./match-query";
import type { ItemMatches, MatchItem } from "./match-query";

/**
 * The test of one Item against each of `filters`:
 * - `result`: whether each filter holds, and the Diagnostic of each filter
 *   that cannot be evaluated for the Item, which does not hold.
 * - `missing`: the query finds no such Item.
 * - `failed`: the query failed, with its Diagnostic where it gives one.
 */
export async function testItemMatches(
  query: Pick<QueryHandle, "run">,
  item: MatchItem,
  filters: readonly string[],
): Promise<
  | ({ kind: "result" } & ItemMatches)
  | { kind: "missing" }
  | { kind: "failed"; diagnostic?: Diagnostic }
> {
  const answer = readMatches(
    await query.run(
      matchesRequest([item], filters),
      new AbortController().signal,
    ),
    filters,
  );
  if (answer.kind === "failed") return answer;
  const row = answer.byKey.get(formatIndexedKey(item.key, item.groupID));
  return row ? { kind: "result", ...row } : { kind: "missing" };
}
