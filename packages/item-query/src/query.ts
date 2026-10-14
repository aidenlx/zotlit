// The operations of the engine: one query of a Query Dataset, delivered to a
// consumer in projection chunks or collected into the complete Query Result.
import { Effect } from "effect";

import type {
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";

import { collectionWarnings } from "./collection-warnings";
import type { QueryDataset } from "./dataset";
import { diagnoseUnusedFormula, diagnoseWarning } from "./diagnose";
import type { WarningSource } from "./diagnose";
import type { ItemQueryError } from "./error";
import { consumeDataset } from "./execution";
import type { FilterPlan } from "./filter-plan";
import { indexedKeyWarnings } from "./indexed-key-selection";
import { readQueryClock } from "./query-clock";
import { openQuerySources } from "./query-sources";
import type { QuerySources } from "./query-sources";
import { planRequest } from "./request";
import type {
  ItemQueryRequest,
  QueryResult,
  QueryRow,
  QueryMetadata,
  QueryGroup,
  TargetLibrary,
} from "./request";

/** Metadata known before the projection pass begins. */
export interface QuerySummary extends QueryMetadata {
  readonly groups?: readonly Omit<QueryGroup, "rows">[];
  readonly totalCount?: number;
  /**
   * The matching records, each once, grouped or not. The `zotlit:query`
   * envelope leaves it out; a typed caller reads it as the count before the
   * limit.
   */
  readonly matchedCount: number;
}

/**
 * The warnings of one Filter Expression of the request, the filter or the
 * text of one Formula, in the order of the text.
 */
const expressionWarnings = Effect.fnUntraced(function* (
  source: WarningSource,
  expression: FilterPlan,
  {
    dataset,
    libraries,
    sources,
    warning,
  }: {
    dataset: QueryDataset<any>;
    libraries: readonly TargetLibrary[];
    sources: QuerySources;
    warning: Parameters<typeof diagnoseWarning>[2];
  },
) {
  return [
    ...expression.warnings,
    ...(yield* collectionWarnings(expression.root, libraries, sources)),
    ...indexedKeyWarnings(expression.root, dataset.id, libraries),
  ]
    .sort((a, b) => a.at.from - b.at.from)
    .map((fault) => diagnoseWarning(fault, source, warning));
});

/** Each write completes before the engine projects the next chunk. */
export interface QueryConsumer<A, E = never, R = never> {
  /** groupIndex addresses summary.groups; each chunk belongs to one group. */
  write(
    rows: readonly QueryRow[],
    groupIndex?: number,
  ): Effect.Effect<void, E, R>;
  end(): Effect.Effect<A, E, R>;
}

/**
 * Run one query of the Query Dataset over the Target Libraries, as one result
 * set. Run the Effect with `ItemQueryScheduler`; cancellation is fiber
 * interruption.
 */
export function collectQuery<Request extends ItemQueryRequest>(
  dataset: QueryDataset<Request>,
  request: Request,
): Effect.Effect<
  QueryResult,
  ItemQueryError | ItemQueryLayoutError | ItemQueryDatabaseError,
  ItemQueryDatabase
> {
  return consumeQuery(dataset, request, (summary) =>
    Effect.sync(() => {
      const rows: QueryRow[] = [];
      const {
        groups: summaries,
        totalCount,
        matchedCount: _matched,
        ...metadata
      } = summary;
      const groups = summaries?.map((group) => ({
        ...group,
        rows: [] as QueryRow[],
      }));
      return {
        write: (chunk, groupIndex) =>
          Effect.sync(() => {
            const target =
              groups && groupIndex !== undefined
                ? groups[groupIndex]!.rows
                : rows;
            for (const row of chunk) target.push(row);
          }),
        end: () =>
          Effect.succeed<QueryResult>(
            groups
              ? { ...metadata, totalCount: totalCount!, groups }
              : { ...metadata, rows },
          ),
      };
    }),
  );
}

/**
 * Deliver the same query in final-order projection chunks. Begin runs once
 * after ordering, including for an empty result. Failure or interruption stops
 * delivery; end runs only after every write succeeds. Consumer state belongs
 * inside begin, so each execution is independent.
 */
export function consumeQuery<Request extends ItemQueryRequest, A, E, R>(
  dataset: QueryDataset<Request>,
  request: Request,
  begin: (summary: QuerySummary) => Effect.Effect<QueryConsumer<A, E, R>, E, R>,
): Effect.Effect<
  A,
  ItemQueryError | ItemQueryLayoutError | ItemQueryDatabaseError | E,
  ItemQueryDatabase | R
> {
  return Effect.gen(function* () {
    const sources = yield* openQuerySources;
    // A Formula that names a custom field the source lacks leaves out only
    // that Formula, so the planner reads the source's custom fields first.
    const customFieldNames =
      request.formulaFaults === "leave-out" &&
      Object.keys(request.formulas ?? {}).length > 0
        ? (yield* sources.vocabulary()).customFieldNames
        : undefined;
    const plan = yield* planRequest(dataset, request, customFieldNames);
    const { query, sorts } = plan;
    const clock = yield* readQueryClock;
    const run = yield* dataset.open(plan, request, { clock, sources });
    return yield* consumeDataset(
      {
        ...run,
        dataset,
        sources,
        filter: plan.filter?.root,
        query,
        warnings: [
          // The filter and each Formula the request reads warn alike, each
          // at its own text.
          ...(yield* Effect.forEach(
            [
              ...(plan.filter
                ? [{ source: { text: query.filter! }, plan: plan.filter }]
                : []),
              ...plan.formulas.map((formula) => ({
                source: { text: formula.text, formula: formula.name },
                plan: formula.plan,
              })),
            ],
            (expression) =>
              expressionWarnings(expression.source, expression.plan, {
                dataset,
                libraries: request.libraries,
                sources,
                warning: { clock, dataset, context: query.context },
              }),
          )).flat(),
          ...plan.unusedFormulas.map(diagnoseUnusedFormula),
        ],
        formulaFaults: plan.formulaFaults ?? undefined,
        libraries: request.libraries,
        sort: plan.order,
        readScanPage: dataset.readScanPage,
        readUniverseRows: dataset.readUniverseRows,
        keys: (item) => sorts.map((sort) => sort.key(item, clock)),
        groupValues: plan.group && plan.group.values,
      },
      begin,
    );
  });
}
