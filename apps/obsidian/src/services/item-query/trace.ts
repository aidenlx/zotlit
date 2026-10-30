// Measurement lives in the worker; these observers never transfer Query Rows.
import { Effect } from "effect";
import { createHook } from "node:async_hooks";

import { ItemQueryStatementObserver } from "@zotlit/db/item-query";
import type { ItemQueryReader } from "@zotlit/db/item-query";
import { ItemQuerySliceObserver } from "@zotlit/item-query";

import type { QueryInstrument } from "./answer";
const now = (): number => performance.timeOrigin + performance.now();

export interface CancellationEvent {
  phase:
    | "requested"
    | "sent"
    | "received"
    | "accepted"
    | "write-finished"
    | "files-closed"
    | "resources-closed"
    | "receipt"
    | "stop-requested"
    | "exit"
    | "cleanup-finished";
  /** Wall clock across processes; acceptance timings use the renderer's monotonic clock. */
  atEpochMs: number;
}

export interface QueryObserver {
  completed: (report: WorkerMeasurement) => void;
  cancelled?: (event: CancellationEvent) => void;
}

export interface Trace {
  instrument: QueryInstrument;
  engineStart: number | undefined;
  engineEnd: number | undefined;
  paused: number[];
  resumed: number[];
  slices: { start: number; end: number }[];
  statements: { reader: ItemQueryReader; rows: number; at: number }[];
  heapSamples: number[];
}

export function createTrace(sampleHeap: boolean): Trace {
  let currentSlice: { start: number; end: number } | undefined;
  const resources = new Map<number, boolean>();
  const callbacks: number[] = [];
  const startSlice = () => {
    const start = now();
    currentSlice = { start, end: start };
    trace.slices.push(currentSlice);
  };
  const endWork = () => {
    if (currentSlice) currentSlice.end = now();
  };
  // A worker runs one query at a time. Measure its host callbacks, including
  // native Promise continuations outside Effect. Microtasks extend the same
  // task; a later host callback starts a new slice and excludes the I/O wait.
  const hook = createHook({
    init: (id, type) => {
      resources.set(
        id,
        type === "PROMISE" || type === "Microtask" || type === "TickObject",
      );
    },
    before: (id) => {
      const microtask = resources.get(id);
      if (microtask === undefined) return;
      if (callbacks.length === 0 && !microtask) startSlice();
      callbacks.push(id);
    },
    after: (id) => {
      if (!resources.has(id)) return;
      endWork();
      if (callbacks.at(-1) === id) callbacks.pop();
    },
    destroy: (id) => {
      resources.delete(id);
    },
  });
  const sample = sampleHeap
    ? () => trace.heapSamples.push(process.memoryUsage().heapUsed)
    : () => {};
  const trace: Trace = {
    engineStart: undefined,
    engineEnd: undefined,
    paused: [],
    resumed: [],
    slices: [],
    statements: [],
    heapSamples: [],
    instrument: (operation) =>
      Effect.gen(function* () {
        trace.engineStart = now();
        sample();
        startSlice();
        hook.enable();
        const tracer = yield* Effect.tracer;
        return yield* Effect.withTracer(operation, {
          span: (options) => tracer.span(options),
          // The hook starts inside an existing callback. Cover its initial
          // synchronous work too, before the first observed host callback.
          context: (primitive, fiber) => {
            try {
              return tracer.context
                ? tracer.context(primitive, fiber)
                : primitive["~effect/Effect/evaluate"](fiber);
            } finally {
              endWork();
            }
          },
        });
      }).pipe(
        Effect.onExit(() =>
          Effect.sync(() => {
            trace.engineEnd = now();
            sample();
            endWork();
            hook.disable();
            callbacks.length = 0;
            resources.clear();
          }),
        ),
        // A scheduler pause ends the slice too. In the Obsidian worker the
        // resume is a Chromium MessageChannel task, which async_hooks does not
        // report, so the resume starts the next slice unless a host callback
        // started it already.
        Effect.provideService(ItemQuerySliceObserver, {
          paused: (at) => {
            trace.paused.push(performance.timeOrigin + at);
            sample();
            endWork();
            currentSlice = undefined;
          },
          resumed: (at) => {
            trace.resumed.push(performance.timeOrigin + at);
            if (!currentSlice) startSlice();
          },
        }),
        Effect.provideService(ItemQueryStatementObserver, (run) => {
          trace.statements.push({
            reader: run.reader,
            rows: run.rows.length,
            at: now(),
          });
        }),
      ),
  };
  return trace;
}

export interface WorkerMeasurement {
  workerMs: number;
  engineMs?: number;
  /** Time spent in synchronous JSON encoding steps, within engineMs. */
  answerMs?: number;
  channels?: { created: number; closed: number; open: number };
  answerSteps: number[];
  slices: number[];
  worstSlice?: {
    ms: number;
    index: number;
    statements: { reader: ItemQueryReader; rows: number }[];
  };
  pauses: number;
  longestPauseMs: number;
  statements: Partial<
    Record<
      ItemQueryReader,
      { count: number; rows: number; maxRows: number; longestSliceMs: number }
    >
  >;
  heap?: {
    beforeBytes: number;
    peakBytes: number;
    afterAnswerBytes: number;
    samples: number;
  };
}

/** Aggregate inside the worker; raw statement events and heap samples stay there. */
export function finishTrace(
  trace: Trace,
  context: { startedAt: number; answerSteps: number[]; heapBefore?: number },
): WorkerMeasurement {
  const finishedAt = now();
  const { slices } = trace;
  const durations = slices.map(({ start, end }) => end - start);
  let worstIndex = -1;
  for (const [index, ms] of durations.entries()) {
    if (worstIndex < 0 || ms > durations[worstIndex]!) worstIndex = index;
  }
  const worst = slices[worstIndex];
  const statements: WorkerMeasurement["statements"] = {};
  let sliceIndex = 0;
  for (const { reader, rows, at } of trace.statements) {
    while (sliceIndex < slices.length - 1 && at > slices[sliceIndex]!.end)
      sliceIndex++;
    const total = (statements[reader] ??= {
      count: 0,
      rows: 0,
      maxRows: 0,
      longestSliceMs: 0,
    });
    total.count++;
    total.rows += rows;
    total.maxRows = Math.max(total.maxRows, rows);
    total.longestSliceMs = Math.max(
      total.longestSliceMs,
      durations[sliceIndex] ?? 0,
    );
  }
  const measured: WorkerMeasurement = {
    workerMs: finishedAt - context.startedAt,
    engineMs:
      trace.engineStart === undefined || trace.engineEnd === undefined
        ? undefined
        : trace.engineEnd - trace.engineStart,
    answerMs: context.answerSteps.reduce((total, ms) => total + ms, 0),
    answerSteps: context.answerSteps,
    slices: durations,
    worstSlice: worst
      ? {
          ms: durations[worstIndex]!,
          index: worstIndex,
          statements: trace.statements
            .filter(({ at }) => at >= worst.start && at <= worst.end)
            .map(({ reader, rows }) => ({ reader, rows })),
        }
      : undefined,
    pauses: trace.paused.length,
    longestPauseMs: Math.max(
      0,
      ...trace.resumed.map((at, index) => at - trace.paused[index]!),
    ),
    statements,
    heap:
      context.heapBefore === undefined
        ? undefined
        : {
            beforeBytes: context.heapBefore,
            peakBytes: Math.max(context.heapBefore, ...trace.heapSamples),
            afterAnswerBytes: process.memoryUsage().heapUsed,
            samples: trace.heapSamples.length,
          },
  };
  measured.workerMs = now() - context.startedAt;
  return measured;
}
