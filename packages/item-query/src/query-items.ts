import { Effect } from "effect";

import { formatIndexedKey } from "@zotlit/db";
import {
  HYDRATE_CHUNK_SIZE,
  readCollectionPaths,
  readFieldVocabulary,
  readHydrateChunk,
  readScanPage,
  SCAN_PAGE_SIZE,
} from "@zotlit/db/item-query";
import type {
  FieldVocabulary,
  HydratedItem,
  HydrateFields,
  HydrateRelation,
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
  ScanRow,
} from "@zotlit/db/item-query";

import { compareStrings } from "./collation";
import { ItemQueryError } from "./error";
import type { FieldNeeds, QueryItem, SortKey } from "./fields";
import { allMatches, firstMatches } from "./matches";
import { readPath } from "./projection";
import type { PlannedPath } from "./projection";
import { planRequest } from "./request";
import type {
  ItemQueryRequest,
  PlannedSort,
  QueryResult,
  QueryRow,
} from "./request";

/** One match while the query orders it: its scan row and its sort keys. */
interface Match {
  readonly scan: ScanRow;
  /** One key for each entry of the sort list. */
  readonly keys: readonly SortKey[];
}

/**
 * Run one Item Query over the top-level, non-trashed Items of the Target
 * Library. Run the Effect with `ItemQueryScheduler`; cancellation is fiber
 * interruption.
 */
export function queryItems(
  request: ItemQueryRequest,
): Effect.Effect<
  QueryResult,
  ItemQueryError | ItemQueryLayoutError | ItemQueryDatabaseError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const { library } = request;
    const { query, paths, sorts } = yield* planRequest(request);
    const { limit } = query;

    const pathNeeds = paths.map((path) => path.needs);
    const sortNeeds = sorts.map((sort) => sort.needs);
    const vocabulary = [...pathNeeds, ...sortNeeds].some(needsHydration)
      ? yield* readFieldVocabulary()
      : null;
    if (vocabulary) yield* checkCustomFields(paths, vocabulary);
    const collectionPaths = [...pathNeeds, ...sortNeeds].some((needs) =>
      needs.relations?.includes("collections"),
    )
      ? yield* readCollectionPaths(library)
      : undefined;
    const itemOf = (
      scan: ScanRow,
      hydrated: ReadonlyMap<number, HydratedItem>,
    ): QueryItem => ({
      scan,
      hydrated: hydrated.get(scan.itemID) ?? NOTHING_HYDRATED,
      customFieldNames: vocabulary?.customFieldNames ?? [],
    });

    // The sort pass: every Item is hydrated with the sort fields only, and the
    // query keeps the scan row and the sort keys of a match.
    const sortFields =
      vocabulary && sortNeeds.some(needsHydration)
        ? hydrateFields(sortNeeds, vocabulary)
        : null;
    const compare = byKeysThenKey(sorts);
    const matches =
      limit === null ? allMatches(compare) : firstMatches(limit + 1, compare);
    let afterKey: string | null = null;
    for (;;) {
      const page: ScanRow[] = yield* readScanPage({
        libraryID: library.libraryID,
        afterKey,
      });
      const chunkSize = sortFields ? HYDRATE_CHUNK_SIZE : SCAN_PAGE_SIZE;
      for (let start = 0; start < page.length; start += chunkSize) {
        const chunk = page.slice(start, start + chunkSize);
        const hydrated: ReadonlyMap<number, HydratedItem> =
          vocabulary && sortFields
            ? yield* readHydrateChunk({
                vocabulary,
                itemIDs: chunk.map((row) => row.itemID),
                ...sortFields,
                collectionPaths,
              })
            : new Map();
        yield* Effect.sync(() => {
          matches.add(
            chunk.map((scan): Match => {
              const item = itemOf(scan, hydrated);
              return { scan, keys: sorts.map((sort) => sort.key(item)) };
            }),
          );
        });
      }
      if (page.length < SCAN_PAGE_SIZE) break;
      afterKey = page.at(-1)!.key;
    }

    const ordered = yield* matches.ordered();
    const truncated = limit !== null && ordered.length > limit;
    const returned = truncated ? ordered.slice(0, limit) : ordered;

    // The projection pass: only the returned rows are hydrated.
    const fields =
      vocabulary && pathNeeds.some(needsHydration)
        ? hydrateFields(pathNeeds, vocabulary)
        : null;
    const rows: QueryRow[] = [];
    for (let start = 0; start < returned.length; start += HYDRATE_CHUNK_SIZE) {
      const chunk = returned.slice(start, start + HYDRATE_CHUNK_SIZE);
      const hydrated: ReadonlyMap<number, HydratedItem> =
        vocabulary && fields
          ? yield* readHydrateChunk({
              vocabulary,
              itemIDs: chunk.map((row) => row.scan.itemID),
              ...fields,
              collectionPaths,
            })
          : new Map();
      yield* Effect.sync(() => {
        for (const { scan } of chunk) {
          const item = itemOf(scan, hydrated);
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

function needsHydration(needs: FieldNeeds): boolean {
  return Boolean(
    needs.builtIn?.length || needs.custom?.length || needs.relations?.length,
  );
}

function hydrateFields(
  allNeeds: readonly FieldNeeds[],
  vocabulary: FieldVocabulary,
): { fields: HydrateFields; relations: HydrateRelation[] } {
  const builtIn = new Set<string>();
  const custom = new Set<string>();
  const relations = new Set<HydrateRelation>();
  for (const needs of allNeeds) {
    for (const name of needs.builtIn ?? []) builtIn.add(name);
    const names =
      needs.custom === "all" ? vocabulary.customFieldNames : needs.custom;
    for (const name of names ?? []) custom.add(name);
    for (const relation of needs.relations ?? []) relations.add(relation);
  }
  return {
    fields: { builtIn: [...builtIn], custom: [...custom] },
    relations: [...relations],
  };
}

/**
 * The result order: each Sortable Field in turn, a missing value last in both
 * directions, and the Indexed Key as the final tie-breaker.
 */
function byKeysThenKey(
  sorts: readonly PlannedSort[],
): (a: Match, b: Match) => number {
  const descending = sorts.map((sort) => sort.direction === "desc");
  return (a, b) => {
    for (const [i, isDescending] of descending.entries()) {
      const x = a.keys[i]!;
      const y = b.keys[i]!;
      if (x === y) continue;
      if (x === null) return 1;
      if (y === null) return -1;
      const order =
        typeof x === "string"
          ? compareStrings(x, y as string)
          : x - (y as number);
      if (order !== 0) return isDescending ? -order : order;
    }
    return a.scan.key < b.scan.key ? -1 : a.scan.key > b.scan.key ? 1 : 0;
  };
}
