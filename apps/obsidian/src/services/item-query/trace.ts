// Measurement lives in the worker; these observers never transfer Query Rows.
import { Effect } from "effect";

import { ItemQueryStatementObserver } from "@zotlit/db/item-query";
import type { ItemQueryReader } from "@zotlit/db/item-query";
import { ItemQuerySliceObserver } from "@zotlit/item-query";

import type { ItemQueryInstrument } from "./run";
const now = (): number => performance.timeOrigin + performance.now();

export interface CancellationEvent {
  phase:
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
  instrument: ItemQueryInstrument;
  engineStart: number | undefined;
  engineEnd: number | undefined;
  paused: number[];
  resumed: number[];
  statements: { reader: ItemQueryReader; rows: number; at: number }[];
  heapSamples: number[];
}

export function createTrace(sampleHeap: boolean): Trace {
  const sample = sampleHeap
    ? () => trace.heapSamples.push(process.memoryUsage().heapUsed)
    : () => {};
  const trace: Trace = {
    engineStart: undefined,
    engineEnd: undefined,
    paused: [],
    resumed: [],
    statements: [],
    heapSamples: [],
    instrument: (operation) =>
      Effect.suspend(() => {
        trace.engineStart = now();
        sample();
        return operation;
      }).pipe(
        Effect.onExit(() =>
          Effect.sync(() => {
            trace.engineEnd = now();
            sample();
          }),
        ),
        Effect.provideService(ItemQuerySliceObserver, {
          paused: (at) => {
            trace.paused.push(performance.timeOrigin + at);
            sample();
          },
          resumed: (at) => {
            trace.resumed.push(performance.timeOrigin + at);
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

/** The slices of a run: from its start or a resume to the next pause or its end. */
export function slicesOf(
  trace: Omit<Trace, "instrument">,
): { start: number; end: number }[] {
  if (trace.engineStart === undefined || trace.engineEnd === undefined) {
    return [];
  }
  const slices: { start: number; end: number }[] = [];
  let start: number | undefined = trace.engineStart;
  for (const [index, pausedAt] of trace.paused.entries()) {
    if (start !== undefined) slices.push({ start, end: pausedAt });
    start = trace.resumed[index];
  }
  if (start !== undefined) slices.push({ start, end: trace.engineEnd });
  return slices;
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
  const slices = slicesOf(trace);
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
