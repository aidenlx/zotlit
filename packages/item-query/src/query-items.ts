import { Effect } from "effect";

import { formatIndexedKey } from "@zotlit/db";
import {
  HYDRATE_CHUNK_SIZE,
  readFieldVocabulary,
  readHydrateChunk,
  readScanPage,
  SCAN_PAGE_SIZE,
} from "@zotlit/db/item-query";
import type {
  FieldVocabulary,
  HydratedItem,
  HydrateFields,
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  ScanRow,
} from "@zotlit/db/item-query";

import { ItemQueryError } from "./error";
import { allMatches, firstMatches } from "./matches";
import { readPath } from "./projection";
import type { PlannedPath } from "./projection";
import { planRequest } from "./request";
import type { ItemQueryRequest, QueryResult, QueryRow } from "./request";

/**
 * Run one Item Query over the top-level, non-trashed Items of the Target
 * Library. Run the Effect with `ItemQueryScheduler`; cancellation is fiber
 * interruption.
 */
export function queryItems(
  request: ItemQueryRequest,
): Effect.Effect<
  QueryResult,
  ItemQueryError | ItemQueryDatabaseError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const { library } = request;
    const { query, paths } = yield* planRequest(request);
    const { limit } = query;

    const needsHydration = paths.some(
      ({ needs }) => needs.builtIn?.length || needs.custom?.length,
    );
    const vocabulary = needsHydration ? yield* readFieldVocabulary() : null;
    if (vocabulary) yield* checkCustomFields(paths, vocabulary);

    const matches =
      limit === null
        ? allMatches(byModifiedThenKey)
        : firstMatches(limit + 1, byModifiedThenKey);
    let afterKey: string | null = null;
    for (;;) {
      const page: ScanRow[] = yield* readScanPage({
        libraryID: library.libraryID,
        afterKey,
      });
      yield* Effect.sync(() => {
        for (const row of page) matches.add(row);
      });
      if (page.length < SCAN_PAGE_SIZE) break;
      afterKey = page.at(-1)!.key;
    }

    const ordered = yield* Effect.sync(() => matches.ordered());
    const truncated = limit !== null && ordered.length > limit;
    const returned = truncated ? ordered.slice(0, limit) : ordered;

    // The projection pass: only the returned rows are hydrated.
    const fields = vocabulary ? hydrateFields(paths, vocabulary) : null;
    const rows: QueryRow[] = [];
    for (let start = 0; start < returned.length; start += HYDRATE_CHUNK_SIZE) {
      const chunk = returned.slice(start, start + HYDRATE_CHUNK_SIZE);
      const hydrated: ReadonlyMap<number, HydratedItem> =
        vocabulary && fields
          ? yield* readHydrateChunk({
              vocabulary,
              itemIDs: chunk.map((row) => row.itemID),
              fields,
            })
          : new Map();
      yield* Effect.sync(() => {
        for (const scan of chunk) {
          const item = {
            scan,
            hydrated: hydrated.get(scan.itemID) ?? NOTHING_HYDRATED,
            customFieldNames: vocabulary?.customFieldNames ?? [],
          };
          rows.push({
            indexedKey: formatIndexedKey(scan.key, library.groupID),
            values: Object.fromEntries(
              paths.map((path) => [path.text, readPath(path, item)]),
            ),
          });
        }
      });
    }
    return { query, rows, returnedCount: rows.length, truncated };
  });
}

const NOTHING_HYDRATED: HydratedItem = { fields: new Map(), custom: new Map() };

/** A custom field that the source does not define fails the query. */
function checkCustomFields(
  paths: readonly PlannedPath[],
  vocabulary: FieldVocabulary,
): Effect.Effect<void, ItemQueryError> {
  const known = new Set(vocabulary.customFieldNames);
  const index = paths.findIndex(
    (path) => path.customField !== null && !known.has(path.customField),
  );
  if (index === -1) return Effect.void;
  const names = vocabulary.customFieldNames;
  return Effect.fail(
    new ItemQueryError({
      code: "unknown-field",
      location: { argument: "fields", index },
      message: `The Zotero source has no custom field named ${JSON.stringify(paths[index]!.customField)}.`,
      hint:
        names.length === 0
          ? "The Zotero source has no custom fields."
          : `Use the exact name of a custom field: ${names.map((name) => JSON.stringify(name)).join(", ")}.`,
    }),
  );
}

function hydrateFields(
  paths: readonly PlannedPath[],
  vocabulary: FieldVocabulary,
): HydrateFields {
  const builtIn = new Set<string>();
  const custom = new Set<string>();
  for (const { needs } of paths) {
    for (const name of needs.builtIn ?? []) builtIn.add(name);
    const names =
      needs.custom === "all" ? vocabulary.customFieldNames : needs.custom;
    for (const name of names ?? []) custom.add(name);
  }
  return { builtIn: [...builtIn], custom: [...custom] };
}

function byModifiedThenKey(a: ScanRow, b: ScanRow): number {
  return (
    Temporal.Instant.compare(b.dateModified, a.dateModified) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}
