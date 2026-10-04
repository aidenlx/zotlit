import { Effect } from "effect";

import { formatIndexedKey } from "@zotlit/db";
import {
  HYDRATE_CHUNK_SIZE,
  readCollectionPaths,
  readFieldVocabulary,
  readHydrateChunk,
  readLibraryRowCount,
  readScanPage,
  readUniverseRows,
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

import { planCandidates, readCandidates } from "./candidate-plan";
import { compareStrings } from "./collation";
import { ItemQueryError } from "./error";
import type { FieldNeeds, QueryItem, SortKey } from "./fields";
import { matches as isMatch } from "./filter-evaluate";
import { hasBareForm } from "./filter-plan";
import type { FilterPlan } from "./filter-plan";
import { allMatches, firstMatches } from "./matches";
import { readPath } from "./projection";
import type { PlannedPath } from "./projection";
import { readQueryClock } from "./query-clock";
import { planRequest } from "./request";
import type {
  ItemQueryRequest,
  PlannedSort,
  QueryResult,
  QueryRow,
} from "./request";
import { ItemQueryTuning } from "./tuning";

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
    const { query, filter, paths, sorts } = yield* planRequest(request);
    const { limit } = query;
    // One instant and one time zone for every date in the query.
    const clock = yield* readQueryClock;
    const tuning = yield* ItemQueryTuning;
    const scanPageSize = sizeWithin(tuning.scanPageSize, SCAN_PAGE_SIZE);
    const hydrateChunkSize = sizeWithin(
      tuning.hydrateChunkSize,
      HYDRATE_CHUNK_SIZE,
    );

    const pathNeeds = paths.map((path) => path.needs);
    // The scan pass loads what the filter and the sort read.
    const scanNeeds = [
      ...(filter?.needs ?? []),
      ...sorts.map((sort) => sort.needs),
    ];
    const vocabulary = [...pathNeeds, ...scanNeeds].some(needsHydration)
      ? yield* readFieldVocabulary()
      : null;
    if (vocabulary) {
      if (filter) yield* checkFilterCustomFields(filter, vocabulary);
      yield* checkCustomFields(paths, vocabulary);
    }
    const collectionPaths = [...pathNeeds, ...scanNeeds].some((needs) =>
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

    /**
     * Load what one pass needs for the Items of a chunk. A pass that reads
     * only scan rows runs no statement.
     */
    const hydrate = function* (
      needs: ReturnType<typeof hydrateFields> | null,
      itemIDs: readonly number[],
    ) {
      if (!vocabulary || !needs) return NOTHING_HYDRATED_CHUNK;
      return yield* readHydrateChunk({
        vocabulary,
        itemIDs,
        ...needs,
        collectionPaths,
      });
    };

    // The scan pass: every Item is hydrated with the filter and sort fields
    // only, and the query keeps the scan row and the sort keys of a match.
    const scanFields =
      vocabulary && scanNeeds.some(needsHydration)
        ? hydrateFields(scanNeeds, vocabulary)
        : null;
    const compare = byKeysThenKey(sorts);
    const matches =
      limit === null
        ? allMatches(compare, sizeWithin(tuning.mergeStepSize, Infinity))
        : firstMatches(limit + 1, compare);
    // Each page and each chunk lives in the Effect that reads it, so the query
    // holds no row of a page it has finished.
    /** Hydrate one chunk of a page and keep its matches. */
    const takeChunk = (chunk: readonly ScanRow[]) =>
      Effect.gen(function* () {
        const hydrated = yield* hydrate(
          scanFields,
          chunk.map((row) => row.itemID),
        );
        yield* Effect.sync(() => {
          const matching: Match[] = [];
          for (const scan of chunk) {
            const item = itemOf(scan, hydrated);
            if (filter && !isMatch(filter.root, item, clock)) continue;
            matching.push({
              scan,
              keys: sorts.map((sort) => sort.key(item)),
            });
          }
          matches.add(matching);
        });
      });
    /** Hydrate one page of the query universe and keep its matches. */
    const takePage = (page: readonly ScanRow[]) =>
      Effect.gen(function* () {
        const chunkSize = scanFields ? hydrateChunkSize : scanPageSize;
        for (let start = 0; start < page.length; start += chunkSize) {
          yield* takeChunk(page.slice(start, start + chunkSize));
        }
      });
    /** Read and take the scan page after `afterKey`. Null: the last page. */
    const takeScanPage = (afterKey: string | null) =>
      Effect.gen(function* () {
        const page = yield* readScanPage({
          libraryID: library.libraryID,
          afterKey,
          size: scanPageSize,
        });
        yield* takePage(page);
        return page.length < scanPageSize ? null : page.at(-1)!.key;
      });

    // The candidate pass reads the Items that the lowered leaves of the filter
    // name; the Library scan reads every Item. The evaluator decides the match
    // on both paths.
    const candidatePlan =
      filter && !tuning.forceScan
        ? planCandidates(filter.root, { vocabulary, collectionPaths })
        : null;
    const candidates = candidatePlan
      ? yield* readCandidates(
          candidatePlan,
          library.libraryID,
          Math.floor(
            (yield* readLibraryRowCount(library.libraryID)) * tuning.capRatio,
          ),
        )
      : null;
    if (candidates) {
      const itemIDs = [...candidates];
      for (let start = 0; start < itemIDs.length; start += scanPageSize) {
        yield* takePage(
          yield* readUniverseRows({
            libraryID: library.libraryID,
            itemIDs: itemIDs.slice(start, start + scanPageSize),
          }),
        );
      }
    } else {
      let afterKey: string | null = null;
      do afterKey = yield* takeScanPage(afterKey);
      while (afterKey !== null);
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
    for (let start = 0; start < returned.length; start += hydrateChunkSize) {
      const chunk = returned.slice(start, start + hydrateChunkSize);
      const hydrated = yield* hydrate(
        fields,
        chunk.map((row) => row.scan.itemID),
      );
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

/** A tuned size as a whole number from one to the upper limit of its reader. */
function sizeWithin(size: number, limit: number): number {
  return Math.max(1, Math.min(Math.floor(size), limit));
}

const NOTHING_HYDRATED: HydratedItem = { fields: new Map(), custom: new Map() };
const NOTHING_HYDRATED_CHUNK: ReadonlyMap<number, HydratedItem> = new Map();

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

/**
 * A custom field that the source does not define fails the query. A bare name
 * outside the built-in names is a custom field of the source or an unknown
 * field.
 */
function checkFilterCustomFields(
  filter: FilterPlan,
  vocabulary: FieldVocabulary,
): Effect.Effect<void, ItemQueryError> {
  const names = vocabulary.customFieldNames;
  const known = new Set(names);
  const missing = filter.customFields.find((field) => !known.has(field.name));
  if (!missing) return Effect.void;
  const { from, to, name, bare } = missing;
  const bareNames = names.filter(hasBareForm);
  return Effect.fail(
    new ItemQueryError({
      code: "unknown-field",
      location: { argument: "filter", span: { from, to } },
      message: bare
        ? `${JSON.stringify(name)} is not a field of Item Query.`
        : `The Zotero source has no custom field named ${JSON.stringify(name)}.`,
      hint: bare
        ? `Use a field of the Item Query Schema; field names are case-sensitive.${
            bareNames.length === 0
              ? ""
              : ` The custom fields with a bare name: ${bareNames.join(", ")}.`
          } Reach every custom field with custom["exact name"].`
        : names.length === 0
          ? "The Zotero source has no custom fields."
          : `Use the exact name of a custom field: ${names.map((entry) => JSON.stringify(entry)).join(", ")}.`,
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
