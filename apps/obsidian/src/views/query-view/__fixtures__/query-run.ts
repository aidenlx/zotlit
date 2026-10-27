// A fake ZotLit Query for the Query View tests, and its answer cut as the real
// one is: each row carries only the fields its request names, so a view that
// asks for too little shows the gap in a test.
import type {
  QueryViewOutcome,
  QueryViewRequest,
} from "@/services/item-query/query-view";
import type { QueryHostDeps } from "./host";

/**
 * The ZotLit Query a Query View reads in a test, answering by `run`; every
 * other read answers nothing. A wider `QueryHostDeps["query"]` adds its read
 * here.
 */
export const fakeQuery = (
  run: QueryHostDeps["query"]["run"],
): QueryHostDeps["query"] => ({
  run,
  on: () => () => {},
  customFieldNames: async () => [],
});

/** `outcome` with each row's values cut to the fields `request` names. */
export function requested(
  outcome: QueryViewOutcome,
  request: QueryViewRequest,
): QueryViewOutcome {
  if (outcome.kind !== "result" || !outcome.result.rows) return outcome;
  const fields = new Set(request.fields);
  return {
    ...outcome,
    result: {
      ...outcome.result,
      rows: outcome.result.rows.map((row) => ({
        ...row,
        values: Object.fromEntries(
          Object.entries(row.values).filter(([path]) => fields.has(path)),
        ),
      })),
    },
  };
}
