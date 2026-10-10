import { Effect } from "effect";

import { tagTypeToName } from "@zotlit/db";
import type {
  ItemQueryDatabase,
  ItemQueryReaderError,
} from "@zotlit/db/item-query";
import { readCollectionPaths, readTagValues } from "@zotlit/db/item-query";

import { compareStrings } from "./collation";

export interface QueryValuesRequest {
  readonly kind: "collections" | "tags";
  readonly match?: string;
  readonly limit: number | null;
}

export interface QueryValues {
  readonly values: readonly (
    | string
    | { name: string; type: "manual" | "auto" | "unknown" }
  )[];
  readonly totalCount: number;
  readonly returnedCount: number;
  readonly truncated: boolean;
}

/** Sorted Collection paths or Tag names and types of one Target Library. */
export const listQueryValues = Effect.fnUntraced(function* (
  library: { libraryID: number },
  request: QueryValuesRequest,
): Effect.fn.Return<QueryValues, ItemQueryReaderError, ItemQueryDatabase> {
  const values =
    request.kind === "collections"
      ? [
          ...new Set(
            [...(yield* readCollectionPaths(library)).values()].map((path) =>
              path.join("/"),
            ),
          ),
        ].sort(compareStrings)
      : (yield* readTagValues(library))
          .map((tag) => ({ name: tag.name, type: tagTypeToName(tag.type) }))
          .sort(
            (a, b) =>
              compareStrings(a.name, b.name) || compareStrings(a.type, b.type),
          );
  const match = request.match?.toLowerCase() ?? "";
  const matching = values.filter((value) =>
    (typeof value === "string" ? value : value.name)
      .toLowerCase()
      .includes(match),
  );
  const selected =
    request.limit === null ? matching : matching.slice(0, request.limit);
  return {
    totalCount: matching.length,
    returnedCount: selected.length,
    truncated: selected.length < matching.length,
    values: selected,
  };
});
