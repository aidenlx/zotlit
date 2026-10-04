import { Effect, Exit } from "effect";
import type { Scheduler } from "effect/Scheduler";
/**
 * PROTOTYPE — throwaway. The #1313 matrix, bundled to CommonJS and loaded in
 * the Obsidian window with `require`. `run-renderer.ts` drives it through the
 * Obsidian CLI. Results hold timings, counts, and a result hash, never Item data.
 */
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  discoverQueries,
  BASELINE,
} from "../prototype-async-execution/bench-core.ts";
import {
  executeItemQuery,
  QueryCancelled,
} from "../prototype-async-execution/executor.ts";
import type {
  ExecOptions,
  Query,
  QueryResult,
} from "../prototype-async-execution/executor.ts";
import { ItemQueryDatabase, queryItems } from "./executor-effect.ts";
import type { EffectTrace } from "./executor-effect.ts";
import {
  BudgetScheduler,
  defaultScheduler,
  messageChannelPause,
  Recorder,
  setImmediatePause,
  setTimeoutPause,
} from "./scheduler.ts";
import type { Pause } from "./scheduler.ts";

const now = () => performance.now();

/** The #596 plan path: unordered item-led scan, incremental top-K, chunked sort and projection. */
export const OPTS: ExecOptions = {
  ...BASELINE,
  sqlOrder: false,
  hydrateBatch: 250,
  candidateChunk: 500,
};

export type Engine =
  | "plain-mc8" // the #593 executor, MessageChannel pause, 8 ms budget
  | "effect-mc8" // BudgetScheduler, MessageChannel, 8 ms
  | "effect-st8" // BudgetScheduler, setTimeout(0), 8 ms
  | "effect-si8" // BudgetScheduler, setImmediate, 8 ms
  | "effect-mc4" // BudgetScheduler, MessageChannel, 4 ms
  | "effect-default"; // MixedScheduler as shipped: 2,048 operations, setImmediate

export interface RunRecord {
  engine: Engine;
  query: string;
  cancelFrac?: number;
  totalMs: number;
  slices: number[];
  maxGapMs: number;
  droppedFrames: number;
  returnedCount: number;
  truncated: boolean;
  hash: string;
  cancelled: boolean;
  cancelLatencyMs?: number;
  settleAfterAbortMs?: number;
  abortFiredLateMs?: number;
  leaseMs: number;
  statements: number;
}

const mc = messageChannelPause();
const pauses: Record<string, Pause> = {
  mc: mc.pause,
  st: setTimeoutPause,
  si: setImmediatePause,
};

function makeScheduler(engine: Engine, rec: Recorder): Scheduler {
  switch (engine) {
    case "effect-mc8":
      return new BudgetScheduler(rec, 8, pauses.mc!);
    case "effect-st8":
      return new BudgetScheduler(rec, 8, pauses.st!);
    case "effect-si8":
      return new BudgetScheduler(rec, 8, pauses.si!);
    case "effect-mc4":
      return new BudgetScheduler(rec, 4, pauses.mc!);
    case "effect-default":
      // The pause the default scheduler picks in this host.
      return defaultScheduler(
        rec,
        "setImmediate" in globalThis ? pauses.si! : pauses.st!,
      );
    default:
      throw new Error(engine);
  }
}

function hashResult(r: QueryResult): string {
  const s = JSON.stringify([r.rows, r.returnedCount, r.truncated]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}

/** A 4 ms heartbeat and frame callbacks: the longest time the thread could not answer. */
function startProbe() {
  const gaps: number[] = [];
  let last = now();
  const t = setInterval(() => {
    const n = now();
    gaps.push(n - last);
    last = n;
  }, 4);
  const frames: number[] = [];
  let on = true;
  const loop = (ts: number) => {
    if (!on) return;
    frames.push(ts);
    requestAnimationFrame(loop);
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(loop);
  return () => {
    clearInterval(t);
    on = false;
    gaps.push(now() - last);
    const fg = frames.slice(1).map((f, i) => f - frames[i]!);
    return {
      maxGapMs: Math.max(0, ...gaps),
      droppedFrames: fg.reduce(
        (n, g) => n + Math.max(0, Math.ceil(g / 16.7) - 1),
        0,
      ),
    };
  };
}

/** Simulated renderer work: 3 ms of busy work every 16 ms, as in #593. */
function startUiLoad() {
  const t = setInterval(() => {
    const end = now() + 3;
    while (now() < end);
  }, 16);
  return () => clearInterval(t);
}

const settle = () => new Promise<void>((r) => setTimeout(r, 20));

/**
 * One run. `abortAt` is ms after start for a timer-delivered cancel request;
 * `external` hands the AbortController out for the CLI-delivered case.
 */
export async function runOne(
  db: DatabaseSync,
  engine: Engine,
  queryName: string,
  query: Query,
  abortAt?: number,
  external?: AbortController,
): Promise<RunRecord> {
  if (!external) await settle();
  const stopLoad = startUiLoad();
  const stopProbe = startProbe();
  const ac = external ?? new AbortController();
  let fired = Number.NaN;
  ac.signal.addEventListener("abort", () => (fired = now()), { once: true });
  const t0 = now();
  const intended = abortAt === undefined ? Number.NaN : t0 + abortAt;
  if (abortAt !== undefined) setTimeout(() => ac.abort(), abortAt);

  let result: QueryResult | undefined;
  let slices: number[];
  let leaseMs: number;
  let statements: number;
  if (engine === "plain-mc8") {
    const { result: p, trace } = executeItemQuery(
      db,
      query,
      OPTS,
      { now, yield: () => new Promise<void>((r) => void mc.pause(r)) },
      () => ({ release() {} }),
      ac.signal,
    );
    try {
      result = await p;
    } catch (error) {
      if (!(error instanceof QueryCancelled)) throw error;
    }
    slices = trace.slices.map((s) => s.end - s.start);
    leaseMs = trace.leaseReleasedAt - trace.leaseAcquiredAt;
    statements = trace.statements;
  } else {
    const rec = new Recorder(now);
    const scheduler = makeScheduler(engine, rec);
    const trace: EffectTrace = {
      leaseAcquiredAt: 0,
      leaseReleasedAt: 0,
      candidateCount: 0,
      hydratedCount: 0,
      statements: 0,
      firstCandidateStepMs: 0,
    };
    const program = queryItems(query, OPTS, now, trace).pipe(
      Effect.provideService(ItemQueryDatabase, { db, release() {} }),
    );
    // The adapter checks the signal first: Effect runs one slice before it looks.
    if (ac.signal.aborted) throw new Error("aborted before start");
    rec.sliceStart = now();
    const p = Effect.runPromiseExit(program, { signal: ac.signal, scheduler });
    rec.slices.push([rec.sliceStart, now()]);
    const exit = await p;
    if (Exit.isSuccess(exit)) result = exit.value;
    else if (!Exit.hasInterrupts(exit)) throw new Error(String(exit.cause));
    slices = rec.slices.map(([a, b]) => b - a);
    leaseMs = trace.leaseReleasedAt - trace.leaseAcquiredAt;
    statements = trace.statements;
  }
  const t1 = now();
  const probe = stopProbe();
  stopLoad();
  return {
    engine,
    query: queryName,
    totalMs: t1 - t0,
    slices: slices.map((d) => +d.toFixed(3)),
    ...probe,
    returnedCount: result?.returnedCount ?? 0,
    truncated: result?.truncated ?? false,
    hash: result ? hashResult(result) : "",
    cancelled: result === undefined,
    ...(abortAt !== undefined || external
      ? {
          cancelLatencyMs: abortAt !== undefined ? t1 - intended : undefined,
          settleAfterAbortMs: t1 - fired,
          abortFiredLateMs:
            abortAt !== undefined ? fired - intended : undefined,
        }
      : {}),
    leaseMs,
    statements,
  };
}

export interface MatrixOptions {
  reps: number;
  out: string;
  only?: string;
}

const QUERIES = [
  "newest-100",
  "title-contains",
  "common-tag",
  "rare-tag",
  "has-attachment",
  "full-export",
];

/** Runs the whole matrix on one Library file and writes `out`. */
export async function runMatrix(
  file: string,
  o: MatrixOptions,
): Promise<string> {
  const db = new DatabaseSync(file, { readOnly: true });
  const records: RunRecord[] = [];
  const log = (m: string) => console.log("[1313]", m);
  try {
    const { queries, library } = discoverQueries(db);
    const want = (id: string) => !o.only || new RegExp(o.only).test(id);
    // Warm the page cache and statement caches.
    for (const q of QUERIES) {
      await runOne(db, "plain-mc8", q, queries[q]!);
      await runOne(db, "effect-mc8", q, queries[q]!);
    }
    const plan: { engine: Engine; query: string; cancelFrac?: number }[] = [];
    // A. Totals and slices: every query on the two engines under comparison.
    for (const q of QUERIES)
      for (const engine of ["plain-mc8", "effect-mc8"] as Engine[])
        plan.push({ engine, query: q });
    // B. The shipped default scheduler and the alternative pauses.
    for (const q of ["title-contains", "full-export"])
      for (const engine of [
        "effect-default",
        "effect-st8",
        "effect-si8",
        "effect-mc4",
      ] as Engine[])
        plan.push({ engine, query: q });
    // C. Timer-delivered cancel requests.
    for (const q of ["title-contains", "full-export"])
      for (const cancelFrac of [0.1, 0.5, 0.9])
        for (const engine of ["plain-mc8", "effect-mc8"] as Engine[])
          plan.push({ engine, query: q, cancelFrac });
    for (const engine of [
      "effect-default",
      "effect-st8",
      "effect-si8",
      "effect-mc4",
    ] as Engine[])
      plan.push({ engine, query: "full-export", cancelFrac: 0.5 });

    const medianTotal = new Map<string, number>();
    for (const [i, p] of plan.entries()) {
      const id = `${p.engine} ${p.query}${p.cancelFrac !== undefined ? ` cancel@${p.cancelFrac}` : ""}`;
      if (!want(id)) continue;
      let abortAt: number | undefined;
      if (p.cancelFrac !== undefined) {
        const key = `${p.engine}|${p.query}`;
        if (!medianTotal.has(key)) {
          const t: number[] = [];
          for (let r = 0; r < 3; r++)
            t.push(
              (await runOne(db, p.engine, p.query, queries[p.query]!)).totalMs,
            );
          medianTotal.set(key, t.sort((a, b) => a - b)[1]!);
        }
        abortAt = medianTotal.get(key)! * p.cancelFrac;
      }
      const runs: RunRecord[] = [];
      for (let r = 0; r < o.reps; r++) {
        const rec = await runOne(
          db,
          p.engine,
          p.query,
          queries[p.query]!,
          abortAt,
        );
        rec.cancelFrac = p.cancelFrac;
        runs.push(rec);
      }
      records.push(...runs);
      const med = runs.map((r) => r.totalMs).sort((a, b) => a - b)[
        Math.floor(runs.length / 2)
      ]!;
      const all = runs.flatMap((r) => r.slices);
      log(
        `[${i + 1}/${plan.length}] ${id}: total ${med.toFixed(0)}ms, max slice ${Math.max(...all).toFixed(1)}ms${
          abortAt !== undefined
            ? `, cancel ${runs.map((r) => (r.cancelled ? r.cancelLatencyMs!.toFixed(0) : "done")).join("/")}ms`
            : ""
        }`,
      );
    }
    writeFileSync(
      o.out,
      JSON.stringify({
        host: `electron-${process.versions.electron} node-${process.versions.node} sqlite-${library.sqlite}`,
        platform: `${process.platform}-${process.arch}`,
        visible:
          typeof document === "undefined" ? "n/a" : document.visibilityState,
        setImmediateInRenderer: "setImmediate" in globalThis,
        opts: OPTS,
        library,
        at: new Date().toISOString(),
        records,
      }),
    );
    return `wrote ${records.length} runs to ${o.out}`;
  } finally {
    db.close();
  }
}

/** CLI-delivered cancel: `startCli` begins a run and parks its controller; `abortCli` is a second CLI call. */
const parked: {
  ac?: AbortController;
  done?: Promise<RunRecord & { runsBefore: number }>;
} = {};
/** Repeats the query back to back until the CLI abort lands inside one run. */
export function startCli(
  file: string,
  engine: Engine,
  queryName: string,
): string {
  const db = new DatabaseSync(file, { readOnly: true });
  const { queries } = discoverQueries(db);
  const ac = (parked.ac = new AbortController());
  parked.done = (async () => {
    for (let runsBefore = 0; ; runsBefore++) {
      if (ac.signal.aborted) throw new Error("abort landed between runs");
      const rec = await runOne(
        db,
        engine,
        queryName,
        queries[queryName]!,
        undefined,
        ac,
      );
      if (rec.cancelled) return { ...rec, runsBefore };
    }
  })().finally(() => db.close());
  return "started";
}
export function abortCli(sentAtWall: number): string {
  const receivedAtWall = Date.now();
  parked.ac!.abort();
  return JSON.stringify({ sentAtWall, receivedAtWall });
}
export async function collectCli(): Promise<RunRecord> {
  return parked.done!;
}
export function close() {
  mc.close();
}
