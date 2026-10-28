// Query View reads and commands, run in the plugin's view registry.
import { Cause, Effect } from "effect";

import type { FilterValues } from "@zotlit/workbench/ui";

import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";
import { viewRuntime } from "@/lib/view-atoms";
import type {
  QueryViewOutcome,
  QueryViewRequest,
  QueryViewResult,
} from "@/services/item-query/query-view";
import { QueryService } from "@/services/item-query/service";
import { selectorKey } from "@/services/library-scope/scope";
import { LibraryScope } from "@/services/library-scope/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import type { QueryRowPass } from "./view";

const listed = (
  result: QueryViewResult,
  change: Pick<
    QueryViewResult,
    "returnedCount" | "matchedCount" | "truncated"
  > & {
    rows: NonNullable<QueryViewResult["rows"]>;
    warnings?: QueryViewResult["warnings"];
  },
): QueryViewResult => {
  const { groups: _groups, totalCount: _totalCount, ...list } = result;
  return { ...list, ...change };
};

export const readQueryView = Effect.fn("QueryView.read")(function* (
  request: QueryViewRequest,
  pass: QueryRowPass | null,
) {
  const query = yield* QueryService;
  if (!pass) return yield* query.run(request);
  const keys = yield* query.run({ ...request, fields: [], limit: null });
  if (keys.kind !== "result") return keys;
  const kept = (keys.result.rows ?? [])
    .map((row) => row.indexedKey)
    .filter((key) => pass.keeps(key));
  const page =
    request.limit === null || request.limit === undefined
      ? kept
      : kept.slice(0, request.limit);
  const counts = {
    returnedCount: page.length,
    matchedCount: kept.length,
    truncated: page.length < kept.length,
  };
  if (page.length === 0)
    return { ...keys, result: listed(keys.result, { ...counts, rows: [] }) };
  const read = yield* query.run({
    ...request,
    filter: [
      `${JSON.stringify(page)}.contains(indexedKey)`,
      ...(request.filter === undefined ? [] : [`(${request.filter})`]),
    ].join(" && "),
    limit: null,
  });
  if (read.kind !== "result") return read;
  const byKey = new Map(
    (read.result.rows ?? []).map((row) => [row.indexedKey, row]),
  );
  return {
    ...read,
    result: listed(read.result, {
      ...counts,
      rows: page.flatMap((key) => byKey.get(key) ?? []),
      warnings: [...keys.result.warnings, ...read.result.warnings],
    }),
  };
});

export const makeRunQueryCommand = () =>
  viewRuntime.fn(
    (job: {
      request: QueryViewRequest;
      pass: QueryRowPass | null;
      land(outcome: QueryViewOutcome): Promise<void>;
      fail(error: unknown): void;
      done(): void;
    }) =>
      readQueryView(job.request, job.pass).pipe(
        Effect.flatMap((outcome) =>
          Effect.tryPromise((_signal) => job.land(outcome)),
        ),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.gen(function* () {
                const error = Cause.squash(cause);
                yield* Effect.logWarning(
                  "A Query View could not run its query",
                  { error },
                );
                job.fail(error);
              }),
        ),
        Effect.ensuring(Effect.sync(() => job.done())),
        withLogCategory("query-view"),
      ),
  );

export const readFilterValues = Effect.gen(function* () {
  const libraries = (yield* (yield* LibraryScope).current)?.available ?? [];
  const reads = yield* (yield* ZoteroReads).snapshot;
  const tags = new Set<string>();
  for (const { libraryID } of libraries)
    for (const tag of yield* reads.TagNames({ libraryID })) tags.add(tag);
  const collections = yield* reads.CollectionPaths({
    libraryIDs: libraries.map(({ libraryID }) => libraryID),
  });
  return {
    tags: [...tags].sort(),
    collections: collections.map((path) => path.join("/")),
    libraries: libraries.map(({ selector, name }) => ({
      id: selectorKey(selector),
      name,
    })),
  };
}).pipe(Effect.scoped);

/** The values a filter condition offers where they cannot be read. */
const NO_FILTER_VALUES: FilterValues = {
  tags: [],
  collections: [],
  libraries: [],
};

/**
 * The values a filter condition offers, from the Libraries the plugin reads.
 * A Filter popover reads it while it is open; the read stops once none does.
 */
export const filterValuesAtom = viewRuntime.atom(
  readFilterValues.pipe(
    recover(
      (error) =>
        Effect.logWarning("The filter values could not be read", { error }),
      Effect.succeed(NO_FILTER_VALUES),
    ),
    withLogCategory("query-view"),
  ),
);

/**
 * The custom fields of the Zotero source, which `custom[...]` offers. An
 * expression editor reads it while it reads custom fields; the read stops
 * once none does.
 */
export const customFieldNamesAtom = viewRuntime.atom(
  Effect.flatMap(QueryService, (query) => query.customFieldNames).pipe(
    recover(
      (error) =>
        Effect.logWarning("The custom fields could not be read", { error }),
      Effect.succeed<readonly string[]>([]),
    ),
    withLogCategory("query-view"),
  ),
);
