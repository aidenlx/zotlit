/**
 * PROTOTYPE — throwaway. Answers https://github.com/aidenlx/zotlit/issues/593:
 * does a chunked Item Query plan stay responsive and cancellable on a thread
 * that also has to render UI?
 *
 * This module is the liftable part: a chunked, cancellable executor over a
 * synchronous `node:sqlite` connection. It has no evaluator; filters are tiny
 * hand-written predicates with roughly the same per-Item cost. Every
 * synchronous stretch between two yields is recorded as a Slice so the bench
 * and the report can show where the thread was blocked.
 */
import type { DatabaseSync, StatementSync } from "node:sqlite";

// --- Query model (a narrow stand-in for the settled Item Query contract) ---

export type Filter =
  | { kind: "titleContains"; needle: string }
  | { kind: "tagEquals"; name: string }
  | { kind: "creatorContains"; needle: string }
  | { kind: "hasAttachment" };

export type SortField = "dateModified" | "key" | "title";
export interface SortKey {
  field: SortField;
  dir: "asc" | "desc";
}

export type Projection =
  | "title"
  | "date"
  | "dateModified"
  | "creators"
  | "tags"
  | "collections"
  | "hasAttachment";

export interface Query {
  libraryID: number;
  filter: Filter | null;
  sort: SortKey[];
  fields: Projection[];
  limit: number | null;
}

// --- Physical knobs under test ---

export type PlanFamily = "item-led" | "predicate-led" | "snapshot";

export interface ExecOptions {
  plan: PlanFamily;
  /** Item IDs per `IN (...)` hydration statement. */
  hydrateBatch: number;
  /** Candidate IDs pulled from the candidate cursor per step; 0 = read all at once. */
  candidateChunk: number;
  /** Yield once a synchronous slice reaches this many ms; 0 = yield at every yield point. */
  sliceBudgetMs: number;
  /** Push the final order into candidate SQL when every sort key is an Item column. */
  sqlOrder: boolean;
  /** Hydrate projection-only relations for the returned rows only. Applies to limited queries. */
  lateProjection: boolean;
  /**
   * `whole`: one `Array.sort` after evaluation, plus one projection loop.
   * `incremental`: a bounded top-K buffer while evaluating limited queries; sorted runs
   * plus a pausable merge for unlimited ones; projection pauses too.
   */
  sortStrategy: "whole" | "incremental";
  /** Release the source lease after the last database read instead of at the end. */
  releaseLeaseEarly: boolean;
}

export interface Scheduler {
  now(): number;
  yield(): Promise<void>;
}

export interface Lease {
  release(): void;
}

export interface Slice {
  start: number;
  end: number;
  ops: string[];
}

export interface Trace {
  slices: Slice[];
  leaseAcquiredAt: number;
  leaseReleasedAt: number;
  candidateCount: number;
  hydratedCount: number;
  statements: number;
  /** Duration of the first `step()` on the candidate cursor: an unsplittable SQL sort shows up here. */
  firstCandidateStepMs: number;
}

export interface QueryRow {
  indexedKey: string;
  values: Record<string, unknown>;
}

export interface QueryResult {
  rows: QueryRow[];
  returnedCount: number;
  truncated: boolean;
  matchedCount: number | null;
}

export class QueryCancelled extends Error {
  override name = "QueryCancelled";
}

// --- Hydrated Item shape used by the evaluator stand-in ---

export interface Hydrated {
  itemID: number;
  key: string;
  dateModified: string;
  fields: Map<string, string>;
  creators?: { firstName: string; lastName: string; fieldMode: number }[];
  tags?: string[];
  collections?: string[];
  hasAttachment?: boolean;
}

export type Relation =
  | "fields"
  | "creators"
  | "tags"
  | "collections"
  | "attachments";

export const ITEM_COLUMNS = new Set<SortField>(["dateModified", "key"]);

export function executeItemQuery(
  db: DatabaseSync,
  query: Query,
  opts: ExecOptions,
  sched: Scheduler,
  acquireLease: () => Lease,
  signal?: AbortSignal,
): { result: Promise<QueryResult>; trace: Trace } {
  const trace: Trace = {
    slices: [],
    leaseAcquiredAt: sched.now(),
    leaseReleasedAt: Number.NaN,
    candidateCount: 0,
    hydratedCount: 0,
    statements: 0,
    firstCandidateStepMs: 0,
  };
  const lease = acquireLease();
  let leaseHeld = true;
  const releaseLease = () => {
    if (!leaseHeld) return;
    leaseHeld = false;
    trace.leaseReleasedAt = sched.now();
    lease.release();
  };

  let sliceStart = sched.now();
  let sliceOps: string[] = [];
  const op = (name: string) => {
    if (sliceOps.at(-1) !== name) sliceOps.push(name);
  };
  const closeSlice = () => {
    trace.slices.push({ start: sliceStart, end: sched.now(), ops: sliceOps });
    sliceOps = [];
  };
  const checkAbort = () => {
    if (signal?.aborted) throw new QueryCancelled("Item Query cancelled");
  };
  /** A yield point: yields only once the slice budget is spent. */
  const maybeYield = async () => {
    if (sched.now() - sliceStart < opts.sliceBudgetMs) return;
    closeSlice();
    await sched.yield();
    sliceStart = sched.now();
    checkAbort();
  };

  const run = async (): Promise<QueryResult> => {
    checkAbort();
    const fieldIDs = loadFieldIDs(db);
    trace.statements += 1;

    // Which relations each phase needs.
    const filterRel = relationsForFilter(query.filter);
    const sortRel: Relation[] = query.sort.some((s) => s.field === "title")
      ? ["fields"]
      : [];
    const projRel = relationsForProjection(query.fields);
    const evalRel = uniq([...filterRel, ...sortRel]);
    // Late projection re-reads relations, which only pays off when a limit drops rows.
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

    // --- Phase 1: candidate cursor ---
    op("candidate-sql");
    const cand = candidateStatement(db, query, opts.plan, sqlCanOrder);
    trace.statements += 1;
    const iter = cand.stmt.iterate(...cand.params) as Iterator<{
      itemID: number;
      key: string;
      dateModified: string;
    }>;
    let firstStep = true;
    const pull = (n: number) => {
      const out: { itemID: number; key: string; dateModified: string }[] = [];
      while (n === 0 || out.length < n) {
        const t0 = firstStep ? sched.now() : 0;
        const next = iter.next();
        if (firstStep) {
          trace.firstCandidateStepMs = sched.now() - t0;
          firstStep = false;
        }
        if (next.done) break;
        out.push(next.value);
      }
      return out;
    };

    const cmp = comparator(query.sort);
    // Bounded top-K: keep only `limit + 1` best rows while evaluating.
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
    let exhausted = false;
    try {
      while (!exhausted && !(earlyStop && matches.length >= want)) {
        op("candidate-step");
        const chunk = pull(opts.candidateChunk);
        if (chunk.length === 0 || opts.candidateChunk === 0) exhausted = true;
        trace.candidateCount += chunk.length;
        await maybeYield();

        // --- Phase 2: hydrate + evaluate this chunk in bounded batches ---
        for (let i = 0; i < chunk.length; i += opts.hydrateBatch) {
          const batch = chunk.slice(i, i + opts.hydrateBatch);
          const rows = new Map<number, Hydrated>(
            batch.map((c) => [
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
            op(`hydrate-${rel}`);
            hydrate(db, rel, rows, fieldIDs, fieldNames);
            trace.statements += 1;
            await maybeYield();
          }
          trace.hydratedCount += rows.size;
          op("evaluate");
          for (const row of rows.values()) {
            if (evaluate(query.filter, row)) {
              accept(row);
              if (earlyStop && matches.length >= want) break;
            }
          }
          await maybeYield();
          if (earlyStop && matches.length >= want) break;
        }
      }
    } finally {
      iter.return?.();
    }

    if (opts.releaseLeaseEarly && !lateProjection) releaseLease();

    // --- Phase 3: order, limit, truncate ---
    let ordered = matches;
    if (!sqlCanOrder && !topK) {
      op("sort");
      if (opts.sortStrategy === "whole") {
        ordered = matches.slice().sort(cmp);
        await maybeYield();
      } else {
        ordered = await pausableSort(matches, cmp, maybeYield, op);
      }
    }
    const truncated = limit !== null && ordered.length > limit;
    const winners = limit === null ? ordered : ordered.slice(0, limit);

    // --- Phase 4: late projection for the returned rows only ---
    if (lateProjection) {
      const lateFields = query.fields.filter(
        (f) => f === "title" || f === "date",
      );
      const lateRel = uniq([...relationsForProjection(query.fields)]).filter(
        (r) => r !== "fields" || lateFields.length > 0,
      );
      for (let i = 0; i < winners.length; i += opts.hydrateBatch) {
        const batch = winners.slice(i, i + opts.hydrateBatch);
        const rows = new Map(batch.map((r) => [r.itemID, r]));
        for (const rel of lateRel) {
          op(`late-${rel}`);
          hydrate(db, rel, rows, fieldIDs, lateFields);
          trace.statements += 1;
          await maybeYield();
        }
      }
      if (opts.releaseLeaseEarly) releaseLease();
    }

    op("project");
    const out: QueryRow[] = [];
    for (const [i, row] of winners.entries()) {
      out.push({ indexedKey: row.key, values: project(query.fields, row) });
      if (opts.sortStrategy === "incremental" && (i & 1023) === 1023)
        await maybeYield();
    }
    releaseLease();
    closeSlice();
    return {
      rows: out,
      returnedCount: out.length,
      truncated,
      matchedCount: earlyStop ? null : matchedCount,
    };
  };

  const result = run().catch((error: unknown) => {
    releaseLease();
    closeSlice();
    throw error;
  });
  return { result, trace };
}

/** Sorted runs, then pairwise merges; every run and every 2,048 merged rows is a yield point. */
async function pausableSort<T>(
  xs: T[],
  cmp: (a: T, b: T) => number,
  maybeYield: () => Promise<void>,
  op: (name: string) => void,
): Promise<T[]> {
  const RUN = 2048;
  let runs: T[][] = [];
  for (let i = 0; i < xs.length; i += RUN) {
    runs.push(xs.slice(i, i + RUN).sort(cmp));
    await maybeYield();
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
      op("merge");
      const out: T[] = new Array(a.length + b.length);
      let i = 0;
      let j = 0;
      let k = 0;
      while (i < a.length && j < b.length) {
        out[k++] = cmp(a[i]!, b[j]!) <= 0 ? a[i++]! : b[j++]!;
        if ((k & 2047) === 0) await maybeYield();
      }
      while (i < a.length) out[k++] = a[i++]!;
      while (j < b.length) out[k++] = b[j++]!;
      next.push(out);
      await maybeYield();
    }
    runs = next;
  }
  return runs[0] ?? [];
}

// --- SQL ---

const UNIVERSE = `
  FROM items AS i
  JOIN itemTypes AS t ON t.itemTypeID = i.itemTypeID
  WHERE i.libraryID = ?
    AND t.typeName NOT IN ('attachment', 'note', 'annotation')
    AND NOT EXISTS (SELECT 1 FROM deletedItems AS d WHERE d.itemID = i.itemID)`;

function orderSql(sort: SortKey[]): string {
  const keys = sort.map((s) => `i.${s.field} ${s.dir.toUpperCase()}`);
  if (!sort.some((s) => s.field === "key")) keys.push("i.key ASC");
  return `ORDER BY ${keys.join(", ")}`;
}

export function candidateStatement(
  db: DatabaseSync,
  query: Query,
  plan: PlanFamily,
  sqlOrder: boolean,
): { stmt: StatementSync; params: (string | number)[] } {
  const order = sqlOrder ? orderSql(query.sort) : "";
  const f = query.filter;
  if (plan === "predicate-led" && f?.kind === "tagEquals") {
    return {
      stmt: db.prepare(`
        SELECT DISTINCT i.itemID, i.key, i.dateModified
        FROM tags AS tg
        JOIN itemTags AS it ON it.tagID = tg.tagID
        JOIN items AS i ON i.itemID = it.itemID
        JOIN itemTypes AS t ON t.itemTypeID = i.itemTypeID
        WHERE tg.name = ? AND i.libraryID = ?
          AND t.typeName NOT IN ('attachment', 'note', 'annotation')
          AND NOT EXISTS (SELECT 1 FROM deletedItems AS d WHERE d.itemID = i.itemID)
        ${order}`),
      params: [f.name, query.libraryID],
    };
  }
  let pushdown = "";
  const params: (string | number)[] = [query.libraryID];
  if (plan !== "snapshot" && f?.kind === "tagEquals") {
    pushdown = `AND EXISTS (SELECT 1 FROM itemTags AS it JOIN tags AS tg ON tg.tagID = it.tagID
                WHERE it.itemID = i.itemID AND tg.name = ?)`;
    params.push(f.name);
  } else if (plan !== "snapshot" && f?.kind === "hasAttachment") {
    pushdown = `AND EXISTS (SELECT 1 FROM itemAttachments AS ia WHERE ia.parentItemID = i.itemID
                AND NOT EXISTS (SELECT 1 FROM deletedItems AS d2 WHERE d2.itemID = ia.itemID))`;
  }
  return {
    stmt: db.prepare(
      `SELECT i.itemID, i.key, i.dateModified ${UNIVERSE} ${pushdown} ${order}`,
    ),
    params,
  };
}

export function loadFieldIDs(db: DatabaseSync): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT fieldID, fieldName FROM fields WHERE fieldName IN ('title', 'date')`,
    )
    .all() as { fieldID: number; fieldName: string }[];
  return new Map(rows.map((r) => [r.fieldName, r.fieldID]));
}

const stmtCache = new WeakMap<DatabaseSync, Map<string, StatementSync>>();
function cached(db: DatabaseSync, sql: string): StatementSync {
  let m = stmtCache.get(db);
  if (!m) stmtCache.set(db, (m = new Map()));
  let s = m.get(sql);
  if (!s) m.set(sql, (s = db.prepare(sql)));
  return s;
}

export function hydrate(
  db: DatabaseSync,
  rel: Relation,
  rows: Map<number, Hydrated>,
  fieldIDs: Map<string, number>,
  fieldNames: string[],
): void {
  const ids = [...rows.keys()];
  if (ids.length === 0) return;
  const inList = ids.map(() => "?").join(",");
  switch (rel) {
    case "fields": {
      const fids = fieldNames.map((n) => fieldIDs.get(n)!).filter(Boolean);
      if (fids.length === 0) return;
      const names = new Map([...fieldIDs].map(([n, id]) => [id, n]));
      const res = cached(
        db,
        `SELECT d.itemID, d.fieldID, v.value FROM itemData AS d
         JOIN itemDataValues AS v ON v.valueID = d.valueID
         WHERE d.itemID IN (${inList}) AND d.fieldID IN (${fids.map(() => "?").join(",")})`,
      ).all(...ids, ...fids) as {
        itemID: number;
        fieldID: number;
        value: unknown;
      }[];
      for (const r of res)
        rows.get(r.itemID)!.fields.set(names.get(r.fieldID)!, String(r.value));
      return;
    }
    case "creators": {
      for (const r of rows.values()) r.creators = [];
      const res = cached(
        db,
        `SELECT ic.itemID, c.firstName, c.lastName, c.fieldMode FROM itemCreators AS ic
         JOIN creators AS c ON c.creatorID = ic.creatorID
         WHERE ic.itemID IN (${inList}) ORDER BY ic.itemID, ic.orderIndex`,
      ).all(...ids) as {
        itemID: number;
        firstName: string;
        lastName: string;
        fieldMode: number;
      }[];
      for (const r of res) rows.get(r.itemID)!.creators!.push(r);
      return;
    }
    case "tags": {
      for (const r of rows.values()) r.tags = [];
      const res = cached(
        db,
        `SELECT it.itemID, tg.name FROM itemTags AS it JOIN tags AS tg ON tg.tagID = it.tagID
         WHERE it.itemID IN (${inList})`,
      ).all(...ids) as { itemID: number; name: string }[];
      for (const r of res) rows.get(r.itemID)!.tags!.push(r.name);
      return;
    }
    case "collections": {
      for (const r of rows.values()) r.collections = [];
      const res = cached(
        db,
        `SELECT ci.itemID, c.collectionName FROM collectionItems AS ci
         JOIN collections AS c ON c.collectionID = ci.collectionID
         WHERE ci.itemID IN (${inList})`,
      ).all(...ids) as { itemID: number; collectionName: string }[];
      for (const r of res)
        rows.get(r.itemID)!.collections!.push(r.collectionName);
      return;
    }
    case "attachments": {
      for (const r of rows.values()) r.hasAttachment = false;
      const res = cached(
        db,
        `SELECT DISTINCT ia.parentItemID AS itemID FROM itemAttachments AS ia
         WHERE ia.parentItemID IN (${inList})
           AND NOT EXISTS (SELECT 1 FROM deletedItems AS d WHERE d.itemID = ia.itemID)`,
      ).all(...ids) as { itemID: number }[];
      for (const r of res) rows.get(r.itemID)!.hasAttachment = true;
      return;
    }
  }
}

// --- Evaluator / projection stand-ins ---

export function relationsForFilter(f: Filter | null): Relation[] {
  switch (f?.kind) {
    case "titleContains":
      return ["fields"];
    case "tagEquals":
      return ["tags"];
    case "creatorContains":
      return ["creators"];
    case "hasAttachment":
      return ["attachments"];
    default:
      return [];
  }
}

export function relationsForProjection(fields: Projection[]): Relation[] {
  const out: Relation[] = [];
  for (const f of fields) {
    if (f === "title" || f === "date") out.push("fields");
    if (f === "creators") out.push("creators");
    if (f === "tags") out.push("tags");
    if (f === "collections") out.push("collections");
    if (f === "hasAttachment") out.push("attachments");
  }
  return uniq(out);
}

/** Authoritative evaluation always runs, even when SQL already narrowed the set. */
export function evaluate(f: Filter | null, row: Hydrated): boolean {
  switch (f?.kind) {
    case undefined:
      return true;
    case "titleContains":
      return (row.fields.get("title") ?? "")
        .toLocaleLowerCase()
        .includes(f.needle);
    case "tagEquals":
      return row.tags!.includes(f.name);
    case "creatorContains":
      return row.creators!.some((c) =>
        `${c.firstName} ${c.lastName}`.toLocaleLowerCase().includes(f.needle),
      );
    case "hasAttachment":
      return row.hasAttachment!;
  }
}

export function comparator(sort: SortKey[]) {
  const collator = new Intl.Collator(undefined, { sensitivity: "base" });
  const get = (r: Hydrated, f: SortField) =>
    f === "title" ? (r.fields.get("title") ?? null) : r[f];
  return (a: Hydrated, b: Hydrated) => {
    for (const s of sort) {
      const x = get(a, s.field);
      const y = get(b, s.field);
      if (x === y) continue;
      if (x === null) return 1; // nulls last
      if (y === null) return -1;
      const c = collator.compare(x, y);
      if (c !== 0) return s.dir === "asc" ? c : -c;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  };
}

export function project(
  fields: Projection[],
  row: Hydrated,
): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const f of fields) {
    if (f === "title" || f === "date") v[f] = row.fields.get(f) ?? null;
    else if (f === "dateModified") v[f] = row.dateModified;
    else if (f === "creators")
      v[f] = row.creators!.map((c) => ({
        firstName: c.firstName,
        lastName: c.lastName,
        fullName:
          c.fieldMode === 1 ? c.lastName : `${c.firstName} ${c.lastName}`,
      }));
    else if (f === "tags") v[f] = row.tags;
    else if (f === "collections") v[f] = row.collections;
    else if (f === "hasAttachment") v[f] = row.hasAttachment;
  }
  return v;
}

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
