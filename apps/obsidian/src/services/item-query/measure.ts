// The measurement commands of Item Query, registered in a dev build only. The
// release-time measurement script (packages/e2e/src/item-query-measure.ts) calls
// them to read what `zotlit:item-query` cannot report: the slices of the
// engine, its statements, the heap, and the time from a cancel request to
// settlement. Each run goes through the handler of `zotlit:item-query` itself,
// with the two observer references of the engine provided.
//
// Command, flag, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.

import { Effect } from "effect";
import type { CliData, CliFlags, CliHandler, Plugin } from "obsidian";

import { ItemQueryStatementObserver } from "@zotlit/db/item-query";
import type { ItemQueryReader } from "@zotlit/db/item-query";
import { ItemQuerySliceObserver } from "@zotlit/item-query";

import { createItemQueryHandler, itemQueryFlags } from "./cli";
import type { ItemQueryCliDeps } from "./cli";
import type { ItemQueryInstrument } from "./run";

export const ITEM_QUERY_MEASURE_COMMAND = "zotlit:item-query-measure" as const;
export const ITEM_QUERY_MEASURE_CANCEL_COMMAND =
  "zotlit:item-query-measure-cancel" as const;

const itemQueryMeasureFlags: CliFlags = {
  ...itemQueryFlags,
  cancelAfterMs: {
    value: "<ms>",
    description:
      "Request a cancel from a timer this many milliseconds after the run starts",
  },
  heap: {
    value: "<true>",
    description: "Sample the JavaScript heap at every pause of the run",
  },
};

/** One slice: engine work between two pauses, with the statements it ran. */
interface SliceRecord {
  ms: number;
  index: number;
  statements: { reader: ItemQueryReader; rows: number }[];
}

/** The report of one measured run. Times are milliseconds from the run start. */
export interface ItemQueryMeasureReport {
  /** `answered`: the handler returned an envelope. `cancelled`: it rejected after an abort. */
  outcome: "answered" | "cancelled" | "failed";
  error?: string;
  /** `ok` of the envelope, and its counts or its diagnostic code. */
  ok?: boolean;
  diagnosticCode?: string;
  returnedCount?: number;
  truncated?: boolean;
  /** The handler, from its call to its answer or rejection. */
  totalMs: number;
  /** Argument decoding and the source lease. */
  leaseMs?: number;
  /** The Effect run: the resolution of the Target Libraries and `queryItems`. */
  engineMs?: number;
  /** The envelope, built in steps after the engine settles. */
  answerMs?: number;
  answerBytes?: number;
  /** The duration of each step in which the handler built the answer. */
  answerSteps: number[];
  /** The duration of each slice, in run order. */
  slices: number[];
  worstSlice?: SliceRecord;
  pauses: number;
  /** The longest time the window kept the fiber paused. */
  longestPauseMs: number;
  /** By reader: its statements, their rows, and the longest slice that ran one. */
  statements: Partial<
    Record<
      ItemQueryReader,
      { count: number; rows: number; maxRows: number; longestSliceMs: number }
    >
  >;
  heap?: {
    beforeBytes: number;
    /** The highest sample while the engine ran. */
    peakBytes: number;
    /** After the handler built its answer. */
    afterAnswerBytes: number;
    samples: number;
  };
  cancel?: {
    /** When the timer was due, for a timer-delivered request. */
    intendedAtMs?: number;
    /** When the abort signal fired. */
    firedAtMs: number;
    engineSettledAtMs?: number;
    settledAtMs: number;
    firedAtEpochMs: number;
  };
  window: {
    visibleAtStart: boolean;
    visibleAtEnd: boolean;
    /** The window was hidden at some time in the run. */
    hiddenDuringRun: boolean;
    focused: boolean;
  };
  startedAtEpochMs: number;
}

const now = (): number => performance.now();
const round = (ms: number): number => Math.round(ms * 100) / 100;

interface Trace {
  instrument: ItemQueryInstrument;
  engineStart: number | undefined;
  engineEnd: number | undefined;
  paused: number[];
  resumed: number[];
  statements: { reader: ItemQueryReader; rows: number; at: number }[];
  heapSamples: number[];
}

function createTrace(sampleHeap: boolean): Trace {
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
            trace.paused.push(at);
            sample();
          },
          resumed: (at) => {
            trace.resumed.push(at);
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
function slicesOf(trace: Trace): { start: number; end: number }[] {
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

/**
 * @throws {Error} when the text is not a finite number from 0: the run has no
 *   envelope for an invalid argument, so the command rejects.
 */
function decodeCancelAfterMs(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const ms = raw.trim() === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(
      `cancelAfterMs '${raw}' is not a time in milliseconds: use a number from 0.`,
    );
  }
  return ms;
}

export function registerItemQueryMeasureCli(
  plugin: Plugin,
  deps: Omit<ItemQueryCliDeps, "signal" | "instrument" | "onAnswerStep">,
): void {
  const unload = new AbortController();
  plugin.register(() => unload.abort());
  const inFlight = new Set<AbortController>();

  const measure: CliHandler = async (params: CliData): Promise<string> => {
    const { cancelAfterMs: cancelAfter, heap, ...query } = params;
    const cancelAfterMs = decodeCancelAfterMs(cancelAfter);
    const own = new AbortController();
    inFlight.add(own);
    const signal = AbortSignal.any([unload.signal, own.signal]);
    const trace = createTrace(heap === "true");
    const answerSteps: number[] = [];
    const handler = createItemQueryHandler({
      ...deps,
      signal,
      instrument: trace.instrument,
      onAnswerStep: (ms) => answerSteps.push(round(ms)),
    });

    let hiddenDuringRun = document.visibilityState !== "visible";
    const visibleAtStart = !hiddenDuringRun;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") hiddenDuringRun = true;
    };
    document.addEventListener("visibilitychange", onVisibility);

    const heapBefore = process.memoryUsage().heapUsed;
    const startedAt = now();
    let firedAt: number | undefined;
    signal.addEventListener("abort", () => (firedAt = now()), { once: true });
    const timer =
      cancelAfterMs === undefined
        ? undefined
        : window.setTimeout(() => own.abort(), cancelAfterMs);

    let outcome: ItemQueryMeasureReport["outcome"];
    let answer: string | undefined;
    let error: string | undefined;
    try {
      answer = await handler(query);
      outcome = "answered";
    } catch (caught) {
      outcome = signal.aborted ? "cancelled" : "failed";
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const settledAt = now();
    const heapAfterAnswer = process.memoryUsage().heapUsed;
    window.clearTimeout(timer);
    inFlight.delete(own);
    document.removeEventListener("visibilitychange", onVisibility);

    const slices = slicesOf(trace);
    const durations = slices.map((slice) => round(slice.end - slice.start));
    let worstSlice: SliceRecord | undefined;
    for (const [index, slice] of slices.entries()) {
      const ms = durations[index]!;
      if (worstSlice && worstSlice.ms >= ms) continue;
      worstSlice = {
        ms,
        index,
        statements: trace.statements
          .filter(({ at }) => at >= slice.start && at <= slice.end)
          .map(({ reader, rows }) => ({ reader, rows })),
      };
    }
    const statements: ItemQueryMeasureReport["statements"] = {};
    for (const { reader, rows, at } of trace.statements) {
      const total = (statements[reader] ??= {
        count: 0,
        rows: 0,
        maxRows: 0,
        longestSliceMs: 0,
      });
      total.count += 1;
      total.rows += rows;
      total.maxRows = Math.max(total.maxRows, rows);
      const slice = slices.findIndex(
        ({ start, end }) => at >= start && at <= end,
      );
      total.longestSliceMs = Math.max(
        total.longestSliceMs,
        durations[slice] ?? 0,
      );
    }
    const envelope =
      answer === undefined
        ? undefined
        : (JSON.parse(answer) as {
            ok: boolean;
            returnedCount?: number;
            truncated?: boolean;
            diagnostic?: { code: string };
          });

    const report: ItemQueryMeasureReport = {
      outcome,
      error,
      ok: envelope?.ok,
      diagnosticCode: envelope?.diagnostic?.code,
      returnedCount: envelope?.returnedCount,
      truncated: envelope?.truncated,
      totalMs: round(settledAt - startedAt),
      leaseMs:
        trace.engineStart === undefined
          ? undefined
          : round(trace.engineStart - startedAt),
      engineMs:
        trace.engineStart === undefined || trace.engineEnd === undefined
          ? undefined
          : round(trace.engineEnd - trace.engineStart),
      answerMs:
        trace.engineEnd === undefined
          ? undefined
          : round(settledAt - trace.engineEnd),
      answerBytes: answer?.length,
      answerSteps,
      slices: durations,
      worstSlice,
      pauses: trace.paused.length,
      longestPauseMs: round(
        Math.max(
          0,
          ...trace.resumed.map((at, index) => at - trace.paused[index]!),
        ),
      ),
      statements,
      heap:
        heap === "true"
          ? {
              beforeBytes: heapBefore,
              peakBytes: Math.max(heapBefore, ...trace.heapSamples),
              afterAnswerBytes: heapAfterAnswer,
              samples: trace.heapSamples.length,
            }
          : undefined,
      cancel:
        firedAt === undefined
          ? undefined
          : {
              intendedAtMs: cancelAfterMs,
              firedAtMs: round(firedAt - startedAt),
              engineSettledAtMs:
                trace.engineEnd === undefined
                  ? undefined
                  : round(trace.engineEnd - startedAt),
              settledAtMs: round(settledAt - startedAt),
              firedAtEpochMs: round(performance.timeOrigin + firedAt),
            },
      window: {
        visibleAtStart,
        visibleAtEnd: document.visibilityState === "visible",
        hiddenDuringRun,
        focused: document.hasFocus(),
      },
      startedAtEpochMs: round(performance.timeOrigin + startedAt),
    };
    return JSON.stringify(report);
  };

  plugin.registerCliHandler(
    ITEM_QUERY_MEASURE_COMMAND,
    "Run one Item Query and report its slices, statements, heap, and cancel times (dev build)",
    itemQueryMeasureFlags,
    measure,
  );
  plugin.registerCliHandler(
    ITEM_QUERY_MEASURE_CANCEL_COMMAND,
    "Request a cancel of every measured Item Query run in progress (dev build)",
    null,
    () => {
      const arrivedAt = now();
      const cancelled = inFlight.size;
      for (const controller of inFlight) controller.abort();
      return JSON.stringify({
        cancelled,
        arrivedAtEpochMs: round(performance.timeOrigin + arrivedAt),
      });
    },
  );
}
