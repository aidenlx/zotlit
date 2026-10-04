import { Context, Data, Effect } from "effect";
/**
 * PROTOTYPE — throwaway. Answers https://github.com/aidenlx/zotlit/issues/1313:
 * the #593 executor ported to Effect v4. The engine code has no pause calls.
 * Each SQL statement is one `Effect.try` and each in-memory chunk is one
 * `Effect.sync`; the scheduler alone decides where a slice ends. Cancellation
 * is fiber interruption; the lease and the cursor close in finalizers.
 */
import type { DatabaseSync } from "node:sqlite";

import {
  candidateStatement,
  comparator,
  evaluate,
  hydrate,
  ITEM_COLUMNS,
  loadFieldIDs,
  project,
  relationsForFilter,
  relationsForProjection,
  uniq,
} from "../prototype-async-execution/executor.ts";
import type {
  ExecOptions,
  Hydrated,
  Query,
  QueryResult,
  QueryRow,
  Relation,
} from "../prototype-async-execution/executor.ts";

export class ItemQueryDatabaseError extends Data.TaggedError(
  "ItemQueryDatabaseError",
)<{
  cause: unknown;
}> {}

/** The leased database, as the #1312 decision has it: a service over the leased client. */
export class ItemQueryDatabase extends Context.Service<
  ItemQueryDatabase,
  { readonly db: DatabaseSync; release(): void }
>()("ItemQueryDatabase") {}

export interface EffectTrace {
  leaseAcquiredAt: number;
  leaseReleasedAt: number;
  candidateCount: number;
  hydratedCount: number;
  statements: number;
  firstCandidateStepMs: number;
}

type Candidate = { itemID: number; key: string; dateModified: string };

const sql = <A>(f: () => A) =>
  Effect.try({
    try: f,
    catch: (cause) => new ItemQueryDatabaseError({ cause }),
  });

export function queryItems(
  query: Query,
  opts: ExecOptions,
  now: () => number,
  trace: EffectTrace,
): Effect.Effect<QueryResult, ItemQueryDatabaseError, ItemQueryDatabase> {
  return Effect.gen(function* () {
    const source = yield* ItemQueryDatabase;
    const { db } = source;
    trace.leaseAcquiredAt = now();
    let leaseHeld = true;
    const releaseLease = Effect.sync(() => {
      if (!leaseHeld) return;
      leaseHeld = false;
      trace.leaseReleasedAt = now();
      source.release();
    });

    const body = Effect.gen(function* () {
      const fieldIDs = yield* sql(() => loadFieldIDs(db));
      trace.statements += 1;

      const filterRel = relationsForFilter(query.filter);
      const sortRel: Relation[] = query.sort.some((s) => s.field === "title")
        ? ["fields"]
        : [];
      const projRel = relationsForProjection(query.fields);
      const evalRel = uniq([...filterRel, ...sortRel]);
      const lateProjection = opts.lateProjection && query.limit !== null;
      const hydrateRel = lateProjection
        ? evalRel
        : uniq([...evalRel, ...projRel]);
      const fieldNames = uniq([
        ...(query.filter?.kind === "titleContains" ? ["title"] : []),
        ...(query.sort.some((s) => s.field === "title") ? ["title"] : []),
        ...(lateProjection
          ? []
          : query.fields.filter((f) => f === "title" || f === "date")),
      ]);
      const sqlCanOrder =
        opts.sqlOrder &&
        opts.plan !== "snapshot" &&
        query.sort.every((s) => ITEM_COLUMNS.has(s.field));
      const limit = query.limit;
      const earlyStop = sqlCanOrder && limit !== null;

      const cmp = comparator(query.sort);
      const topK =
        !sqlCanOrder && limit !== null && opts.sortStrategy === "incremental";
      let matchedCount = 0;
      const matches: Hydrated[] = [];
      const want = limit === null ? Infinity : limit + 1;
      const accept = (row: Hydrated) => {
        matchedCount += 1;
        if (!topK) return void matches.push(row);
        if (matches.length >= want && cmp(row, matches.at(-1)!) >= 0) return;
        let lo = 0;
        let hi = matches.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cmp(matches[mid]!, row) <= 0) lo = mid + 1;
          else hi = mid;
        }
        matches.splice(lo, 0, row);
        if (matches.length > want) matches.pop();
      };
      const full = () => earlyStop && matches.length >= want;

      // --- Phases 1–2: candidate cursor, then hydrate and evaluate in batches ---
      const iter = yield* sql(() => {
        const cand = candidateStatement(db, query, opts.plan, sqlCanOrder);
        return cand.stmt.iterate(...cand.params) as Iterator<Candidate>;
      });
      trace.statements += 1;
      let firstStep = true;
      const scan = Effect.gen(function* () {
        let exhausted = false;
        while (!exhausted && !full()) {
          const chunk = yield* sql(() => {
            const out: Candidate[] = [];
            while (
              opts.candidateChunk === 0 ||
              out.length < opts.candidateChunk
            ) {
              const t0 = firstStep ? now() : 0;
              const next = iter.next();
              if (firstStep) {
                trace.firstCandidateStepMs = now() - t0;
                firstStep = false;
              }
              if (next.done) break;
              out.push(next.value);
            }
            return out;
          });
          if (chunk.length === 0 || opts.candidateChunk === 0) exhausted = true;
          trace.candidateCount += chunk.length;
          for (let i = 0; i < chunk.length && !full(); i += opts.hydrateBatch) {
            const rows = new Map<number, Hydrated>(
              chunk.slice(i, i + opts.hydrateBatch).map((c) => [
                c.itemID,
                {
                  itemID: c.itemID,
                  key: c.key,
                  dateModified: c.dateModified,
                  fields: new Map(),
                },
              ]),
            );
            for (const rel of hydrateRel) {
              yield* sql(() => hydrate(db, rel, rows, fieldIDs, fieldNames));
              trace.statements += 1;
            }
            trace.hydratedCount += rows.size;
            yield* Effect.sync(() => {
              for (const row of rows.values()) {
                if (evaluate(query.filter, row)) {
                  accept(row);
                  if (full()) break;
                }
              }
            });
          }
        }
      }).pipe(Effect.ensuring(Effect.sync(() => iter.return?.())));
      yield* scan;

      if (opts.releaseLeaseEarly && !lateProjection) yield* releaseLease;

      // --- Phase 3: order, limit, truncate ---
      let ordered = matches;
      if (!sqlCanOrder && !topK) {
        ordered =
          opts.sortStrategy === "whole"
            ? yield* Effect.sync(() => matches.slice().sort(cmp))
            : yield* chunkedSort(matches, cmp);
      }
      const truncated = limit !== null && ordered.length > limit;
      const winners = limit === null ? ordered : ordered.slice(0, limit);

      // --- Phase 4: late projection for the returned rows only ---
      if (lateProjection) {
        const lateFields = query.fields.filter(
          (f) => f === "title" || f === "date",
        );
        const lateRel = relationsForProjection(query.fields).filter(
          (r) => r !== "fields" || lateFields.length > 0,
        );
        for (let i = 0; i < winners.length; i += opts.hydrateBatch) {
          const rows = new Map(
            winners.slice(i, i + opts.hydrateBatch).map((r) => [r.itemID, r]),
          );
          for (const rel of lateRel) {
            yield* sql(() => hydrate(db, rel, rows, fieldIDs, lateFields));
            trace.statements += 1;
          }
        }
        if (opts.releaseLeaseEarly) yield* releaseLease;
      }

      const out: QueryRow[] = [];
      const PROJECT_CHUNK =
        opts.sortStrategy === "incremental" ? 1024 : Infinity;
      for (let i = 0; i < winners.length; i += PROJECT_CHUNK) {
        yield* Effect.sync(() => {
          for (const row of winners.slice(i, i + PROJECT_CHUNK))
            out.push({
              indexedKey: row.key,
              values: project(query.fields, row),
            });
        });
      }
      yield* releaseLease;
      return {
        rows: out,
        returnedCount: out.length,
        truncated,
        matchedCount: earlyStop ? null : matchedCount,
      } satisfies QueryResult;
    });
    return yield* body.pipe(Effect.ensuring(releaseLease));
  });
}

/** Sorted runs of 2,048, then pairwise merges in steps of 2,048 rows: each run and step is one operation. */
function chunkedSort<T>(
  xs: T[],
  cmp: (a: T, b: T) => number,
): Effect.Effect<T[]> {
  return Effect.gen(function* () {
    const RUN = 2048;
    let runs: T[][] = [];
    for (let i = 0; i < xs.length; i += RUN) {
      runs.push(yield* Effect.sync(() => xs.slice(i, i + RUN).sort(cmp)));
    }
    while (runs.length > 1) {
      const next: T[][] = [];
      for (let r = 0; r < runs.length; r += 2) {
        const a = runs[r]!;
        const b = runs[r + 1];
        if (!b) {
          next.push(a);
          continue;
        }
        const out: T[] = new Array(a.length + b.length);
        let i = 0;
        let j = 0;
        let k = 0;
        while (k < out.length) {
          yield* Effect.sync(() => {
            const stop = Math.min(out.length, k + RUN);
            while (k < stop) {
              if (j >= b.length || (i < a.length && cmp(a[i]!, b[j]!) <= 0))
                out[k++] = a[i++]!;
              else out[k++] = b[j++]!;
            }
          });
        }
        next.push(out);
      }
      runs = next;
    }
    return runs[0] ?? [];
  });
}
