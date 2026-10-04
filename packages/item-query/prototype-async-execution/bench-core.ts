/**
 * PROTOTYPE — throwaway. Environment-agnostic experiment matrix for #593.
 * `bench-node.ts` runs it in Node; `bench-renderer.ts` runs it inside the
 * Obsidian renderer. Results contain timings and counts only, never Item data.
 */
import type { DatabaseSync } from "node:sqlite";

import {
  executeItemQuery,
  QueryCancelled,
  type ExecOptions,
  type Query,
  type Slice,
} from "./executor.ts";

export interface BenchEnv {
  name: string;
  now(): number;
  yielders: Record<string, () => Promise<void>>;
  defaultYield: string;
  heapUsed(): number;
  gc?(): void;
  /** Resolves on each rendered frame, when the host renders frames. */
  onFrame?(cb: (t: number) => void): () => void;
  log(msg: string): void;
}

export interface Experiment {
  id: string;
  group: string;
  query: string;
  opts: ExecOptions;
  yield: string;
  uiLoad: boolean;
  cancelFrac?: number;
}

export interface RunMetrics {
  totalMs: number;
  maxSliceMs: number;
  p95SliceMs: number;
  sliceCount: number;
  firstCandidateStepMs: number;
  leaseMs: number;
  statements: number;
  candidateCount: number;
  hydratedCount: number;
  returnedCount: number;
  truncated: boolean;
  matchedCount: number | null;
  heapPeakMB: number;
  maxGapMs: number;
  longTasks: number;
  droppedFrames: number;
  cancelled: boolean;
  cancelLatencyMs?: number;
  abortFiredLateMs?: number;
}

export interface ExperimentResult extends Experiment {
  runs: RunMetrics[];
  median: RunMetrics;
  /** Slices of the median run, relative to its start: [startMs, endMs, opsLabel]. */
  slices: [number, number, string][];
  leaseSpan: [number, number];
}

export const BASELINE: ExecOptions = {
  plan: "item-led",
  hydrateBatch: 250,
  candidateChunk: 1000,
  sliceBudgetMs: 8,
  sqlOrder: true,
  lateProjection: true,
  releaseLeaseEarly: true,
  sortStrategy: "incremental",
};

export function discoverQueries(db: DatabaseSync): {
  queries: Record<string, Query>;
  library: Record<string, number | string>;
} {
  const one = <T>(sql: string) => db.prepare(sql).get() as T;
  const libraryID = 1;
  const common = one<{ name: string; n: number }>(
    `SELECT tg.name, count(*) AS n FROM itemTags it JOIN tags tg ON tg.tagID = it.tagID
     GROUP BY it.tagID ORDER BY n DESC LIMIT 1`,
  );
  const rare = one<{ name: string; n: number }>(
    `SELECT tg.name, count(*) AS n FROM itemTags it JOIN tags tg ON tg.tagID = it.tagID
     GROUP BY it.tagID HAVING n BETWEEN 1 AND 3 ORDER BY n DESC LIMIT 1`,
  );
  const count = (sql: string) => one<{ n: number }>(sql).n;
  const library = {
    userdata: one<{ version: number }>(
      `SELECT version FROM version WHERE schema = 'userdata'`,
    ).version,
    sqlite: one<{ v: string }>(`SELECT sqlite_version() AS v`).v,
    topLevelItems: count(`SELECT count(*) AS n FROM items i JOIN itemTypes t USING (itemTypeID)
      WHERE i.libraryID = 1 AND t.typeName NOT IN ('attachment','note','annotation')
      AND i.itemID NOT IN (SELECT itemID FROM deletedItems)`),
    fieldRows: count(`SELECT count(*) AS n FROM itemData`),
    creatorRows: count(`SELECT count(*) AS n FROM itemCreators`),
    tagRows: count(`SELECT count(*) AS n FROM itemTags`),
    collectionRows: count(`SELECT count(*) AS n FROM collectionItems`),
    attachmentRows: count(`SELECT count(*) AS n FROM itemAttachments`),
    commonTagUses: common?.n ?? 0,
    rareTagUses: rare?.n ?? 0,
  };
  const base = { libraryID, limit: 100 as number | null };
  const queries: Record<string, Query> = {
    "newest-100": {
      ...base,
      filter: null,
      sort: [{ field: "dateModified", dir: "desc" }],
      fields: ["title", "date", "creators"],
    },
    "title-contains": {
      ...base,
      filter: { kind: "titleContains", needle: "the" },
      sort: [{ field: "title", dir: "asc" }],
      fields: ["title", "date"],
    },
    "common-tag": {
      ...base,
      filter: { kind: "tagEquals", name: common?.name ?? "" },
      sort: [{ field: "dateModified", dir: "desc" }],
      fields: ["title", "tags"],
    },
    "rare-tag": {
      ...base,
      filter: { kind: "tagEquals", name: rare?.name ?? "" },
      sort: [{ field: "dateModified", dir: "desc" }],
      fields: ["title", "tags"],
    },
    "has-attachment": {
      ...base,
      filter: { kind: "hasAttachment" },
      sort: [{ field: "dateModified", dir: "desc" }],
      fields: ["title", "hasAttachment"],
    },
    "full-export": {
      ...base,
      limit: null,
      filter: { kind: "creatorContains", needle: "a" },
      sort: [{ field: "title", dir: "asc" }],
      fields: ["title", "date", "creators", "tags", "collections", "hasAttachment"],
    },
  };
  return { queries, library };
}

export function experiments(env: BenchEnv, quick: boolean): Experiment[] {
  const out: Experiment[] = [];
  const y = env.defaultYield;
  const add = (
    group: string,
    query: string,
    patch: Partial<ExecOptions>,
    extra: Partial<Experiment> = {},
  ) => {
    const opts = { ...BASELINE, ...patch };
    const yieldName = extra.yield ?? y;
    const uiLoad = extra.uiLoad ?? true;
    const id = [
      group,
      query,
      ...Object.entries(patch).map(([k, v]) => `${k}=${v}`),
      extra.yield ? `yield=${extra.yield}` : "",
      extra.uiLoad === false ? "noload" : "",
      extra.cancelFrac !== undefined ? `cancel@${extra.cancelFrac}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    out.push({ id, group, query, opts, yield: yieldName, uiLoad, ...extra });
  };

  // Baselines for every query.
  for (const q of [
    "newest-100",
    "title-contains",
    "common-tag",
    "rare-tag",
    "has-attachment",
    "full-export",
  ])
    add("baseline", q, {});

  // A. Hydration batch size, yielding at every yield point.
  for (const q of ["title-contains", "full-export"])
    for (const hydrateBatch of quick ? [50, 500] : [25, 100, 250, 500, 1000, 2000])
      add("batch-size", q, { hydrateBatch, sliceBudgetMs: 0 });

  // B. Slice budget (yield placement policy).
  for (const q of ["title-contains", "full-export"])
    for (const sliceBudgetMs of quick ? [0, 16] : [0, 4, 8, 16, 33, 100])
      add("slice-budget", q, { sliceBudgetMs });

  // C. Yield mechanism.
  for (const name of Object.keys(env.yielders))
    if (name !== y) add("yield-mechanism", "full-export", {}, { yield: name });

  // D. Ordering, limit, early stop, candidate cursor, late projection.
  for (const sqlOrder of [true, false])
    for (const candidateChunk of [0, 1000])
      add("order-limit", "newest-100", { sqlOrder, candidateChunk });
  add("order-limit", "newest-100", { lateProjection: false });
  add("order-limit", "title-contains", { lateProjection: false });
  add("order-limit", "full-export", { lateProjection: false });
  // In-memory ordering and limit: one sort vs top-K / pausable merge.
  for (const q of ["title-contains", "full-export", "newest-100"])
    add("sort-strategy", q, { sortStrategy: "whole", ...(q === "newest-100" ? { sqlOrder: false } : {}) });
  add("sort-strategy", "newest-100", { sqlOrder: false });

  // E. Plan family.
  for (const q of ["common-tag", "rare-tag", "has-attachment", "newest-100"])
    for (const plan of ["predicate-led", "snapshot"] as const)
      add("plan-family", q, { plan });

  // F. Lease lifetime.
  for (const q of ["title-contains", "full-export"])
    add("lease", q, { releaseLeaseEarly: false });

  // G. Cancellation latency.
  for (const q of ["title-contains", "full-export"])
    for (const cancelFrac of [0.1, 0.5, 0.9]) {
      add("cancel", q, {}, { cancelFrac });
      add("cancel", q, { sliceBudgetMs: 100 }, { cancelFrac });
    }
  add("cancel", "newest-100", { candidateChunk: 0 }, { cancelFrac: 0.1 });

  // G2. Cancellation latency per yield mechanism: the abort arrives as a timer task.
  for (const name of Object.keys(env.yielders))
    for (const cancelFrac of [0.1, 0.5])
      add("cancel-yield", "full-export", {}, { yield: name, cancelFrac });

  // H. Renderer load on/off.
  for (const q of ["title-contains", "full-export"]) add("ui-load", q, {}, { uiLoad: false });

  return out;
}

/** Records gaps in a 4 ms heartbeat: a gap is the longest time the thread could not respond. */
function startProbe(env: BenchEnv) {
  const gaps: number[] = [];
  let last = env.now();
  const t = setInterval(() => {
    const now = env.now();
    gaps.push(now - last);
    last = now;
  }, 4);
  const frames: number[] = [];
  const stopFrames = env.onFrame?.((ts) => frames.push(ts));
  return () => {
    clearInterval(t);
    stopFrames?.();
    gaps.push(env.now() - last);
    const frameGaps = frames.slice(1).map((f, i) => f - frames[i]!);
    const basis = frameGaps.length > 0 ? frameGaps : gaps;
    return {
      maxGapMs: Math.max(0, ...gaps),
      longTasks: gaps.filter((g) => g > 50).length,
      droppedFrames: basis.reduce((n, g) => n + Math.max(0, Math.ceil(g / 16.7) - 1), 0),
    };
  };
}

/** Simulated renderer work: 3 ms of busy work every 16 ms, like layout and paint. */
function startUiLoad(env: BenchEnv) {
  const t = setInterval(() => {
    const end = env.now() + 3;
    while (env.now() < end);
  }, 16);
  return () => clearInterval(t);
}

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};

export async function runOne(
  env: BenchEnv,
  db: DatabaseSync,
  query: Query,
  exp: Experiment,
  cancelAtMs?: number,
): Promise<{ metrics: RunMetrics; slices: Slice[]; t0: number; lease: [number, number] }> {
  env.gc?.();
  await env.yielders[exp.yield]!();
  const heap0 = env.heapUsed();
  let heapPeak = heap0;
  const baseYield = env.yielders[exp.yield]!;
  const sched = {
    now: env.now,
    yield: async () => {
      heapPeak = Math.max(heapPeak, env.heapUsed());
      await baseYield();
    },
  };
  const stopLoad = exp.uiLoad ? startUiLoad(env) : () => {};
  const stopProbe = startProbe(env);
  const ac = new AbortController();
  let intended = Number.NaN;
  let fired = Number.NaN;
  const t0 = env.now();
  if (cancelAtMs !== undefined) {
    intended = t0 + cancelAtMs;
    setTimeout(() => {
      fired = env.now();
      ac.abort();
    }, cancelAtMs);
  }
  const { result, trace } = executeItemQuery(
    db,
    query,
    exp.opts,
    sched,
    () => ({ release() {} }),
    ac.signal,
  );
  let cancelled = false;
  let res = { returnedCount: 0, truncated: false, matchedCount: null as number | null };
  try {
    res = await result;
  } catch (error) {
    if (!(error instanceof QueryCancelled)) throw error;
    cancelled = true;
  }
  const t1 = env.now();
  heapPeak = Math.max(heapPeak, env.heapUsed());
  const probe = stopProbe();
  stopLoad();
  const durs = trace.slices.map((s) => s.end - s.start);
  return {
    t0,
    slices: trace.slices,
    lease: [trace.leaseAcquiredAt - t0, trace.leaseReleasedAt - t0],
    metrics: {
      totalMs: t1 - t0,
      maxSliceMs: Math.max(0, ...durs),
      p95SliceMs: pct(durs, 0.95),
      sliceCount: durs.length,
      firstCandidateStepMs: trace.firstCandidateStepMs,
      leaseMs: trace.leaseReleasedAt - trace.leaseAcquiredAt,
      statements: trace.statements,
      candidateCount: trace.candidateCount,
      hydratedCount: trace.hydratedCount,
      returnedCount: res.returnedCount,
      truncated: res.truncated,
      matchedCount: res.matchedCount,
      heapPeakMB: (heapPeak - heap0) / 2 ** 20,
      ...probe,
      cancelled,
      ...(cancelAtMs !== undefined
        ? { cancelLatencyMs: t1 - intended, abortFiredLateMs: fired - intended }
        : {}),
    },
  };
}

export async function runMatrix(
  env: BenchEnv,
  db: DatabaseSync,
  opts: { quick: boolean; reps: number; only?: RegExp },
): Promise<{ library: Record<string, number | string>; results: ExperimentResult[] }> {
  const { queries, library } = discoverQueries(db);
  const exps = experiments(env, opts.quick).filter((e) => !opts.only || opts.only.test(e.id));
  const results: ExperimentResult[] = [];
  const baselineMedian = new Map<string, number>();
  // Warm the page cache and statement caches once per query.
  for (const [name, q] of Object.entries(queries)) {
    await runOne(env, db, q, { id: "warm", group: "warm", query: name, opts: BASELINE, yield: env.defaultYield, uiLoad: false });
  }
  for (const [i, exp] of exps.entries()) {
    const q = queries[exp.query]!;
    let cancelAt: number | undefined;
    if (exp.cancelFrac !== undefined) {
      const key = `${exp.query}|${exp.opts.sliceBudgetMs}|${exp.opts.candidateChunk}`;
      if (!baselineMedian.has(key)) {
        const probe = await runOne(env, db, q, { ...exp, cancelFrac: undefined });
        baselineMedian.set(key, probe.metrics.totalMs);
      }
      cancelAt = baselineMedian.get(key)! * exp.cancelFrac;
    }
    const runs: Awaited<ReturnType<typeof runOne>>[] = [];
    for (let r = 0; r < opts.reps; r++) runs.push(await runOne(env, db, q, exp, cancelAt));
    const sorted = runs.slice().sort((a, b) => a.metrics.totalMs - b.metrics.totalMs);
    const mid = sorted[Math.floor(sorted.length / 2)]!;
    results.push({
      ...exp,
      runs: runs.map((r) => r.metrics),
      median: mid.metrics,
      slices: mid.slices.map((s) => [
        +(s.start - mid.t0).toFixed(3),
        +(s.end - mid.t0).toFixed(3),
        s.ops.join(" "),
      ]),
      leaseSpan: mid.lease,
    });
    env.log(
      `[${i + 1}/${exps.length}] ${exp.id}: total ${mid.metrics.totalMs.toFixed(0)}ms, max slice ${mid.metrics.maxSliceMs.toFixed(1)}ms, gap ${mid.metrics.maxGapMs.toFixed(1)}ms${mid.metrics.cancelLatencyMs !== undefined ? `, cancel ${mid.metrics.cancelLatencyMs.toFixed(1)}ms` : ""}`,
    );
  }
  return { library, results };
}
