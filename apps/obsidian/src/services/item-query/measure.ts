// The measurement commands of Item Query, registered in a dev build only. The
// release-time measurement script (packages/e2e/src/item-query-measure.ts) calls
// them to read what `zotlit:item-query` cannot report: the slices of the
// engine, its statements, the heap, and the time from a cancel request to
// settlement. Each run goes through the handler of `zotlit:item-query` itself,
// with the two observer references of the engine provided. A run with `id` is
// a named query: the production `zotlit:item-query-cancel` stops it.
//
// Command, flag, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.

import type { CliData, CliFlags, CliHandler, Plugin } from "obsidian";

import type { ItemQueryReader } from "@zotlit/db/item-query";

import { itemQueryFlags } from "./cli";
import type { ItemQueryService } from "./service";
import type { CancellationEvent, WorkerMeasurement } from "./trace";

export const ITEM_QUERY_MEASURE_COMMAND = "zotlit:item-query-measure" as const;

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
  /** Time outside the worker: the source lease, queue, transfer, and publication. */
  adapterMs?: number;
  /** The Effect run: Library resolution, query execution, encoding, and file writes. */
  engineMs?: number;
  /** Cumulative synchronous encoding time, included in engineMs. */
  answerMs?: number;
  channels?: { created: number; closed: number; open: number };
  answerBytes?: number;
  /** The duration of each step in which the handler built the answer. */
  answerSteps: number[];
  /** The duration of each slice, in run order. */
  slices: number[];
  /** Renderer timer gaps across the complete worker call, including result transfer. */
  uiGaps: number[];
  worstSlice?: SliceRecord;
  pauses: number;
  /** The longest time the worker kept the fiber paused. */
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
    settledAtMs: number;
    firedAtEpochMs: number;
    events: CancellationEvent[];
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
  queryService: Pick<ItemQueryService, "answer">,
): void {
  const unload = new AbortController();
  plugin.register(() => unload.abort());

  const measure: CliHandler = async (params: CliData): Promise<string> => {
    const { cancelAfterMs: cancelAfter, heap, ...query } = params;
    const cancelAfterMs = decodeCancelAfterMs(cancelAfter);
    const own = new AbortController();
    const signal = AbortSignal.any([unload.signal, own.signal]);
    let measurement: WorkerMeasurement | undefined;
    const cancellationEvents: CancellationEvent[] = [];
    const uiGaps: number[] = [];
    let lastTick = now();
    const sampleUi = () => {
      const at = now();
      uiGaps.push(round(at - lastTick));
      lastTick = at;
    };
    const uiTimer = window.setInterval(sampleUi, 4);

    let hiddenDuringRun = document.visibilityState !== "visible";
    const visibleAtStart = !hiddenDuringRun;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") hiddenDuringRun = true;
    };
    document.addEventListener("visibilitychange", onVisibility);

    const startedAt = now();
    const startedAtEpochMs = Date.now();
    // The service reports the request from any source: the timer, an unload,
    // or `zotlit:item-query-cancel` for a run with `id`.
    let firedAt: number | undefined;
    const timer =
      cancelAfterMs === undefined
        ? undefined
        : window.setTimeout(() => own.abort(), cancelAfterMs);

    let outcome: ItemQueryMeasureReport["outcome"];
    let answer: string | undefined;
    let error: string | undefined;
    try {
      answer = await queryService.answer(query, signal, {
        completed: (report) => {
          measurement = report;
        },
        cancelled: (event) => {
          if (event.phase === "requested") firedAt ??= now();
          cancellationEvents.push(event);
        },
        heap: heap === "true",
      });
      outcome = "answered";
    } catch (caught) {
      // The service reports each cancel request, also one that names the run.
      outcome = firedAt === undefined ? "failed" : "cancelled";
      error = caught instanceof Error ? caught.message : String(caught);
    }
    sampleUi();
    window.clearInterval(uiTimer);
    const settledAt = now();
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);

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
      adapterMs:
        measurement === undefined
          ? undefined
          : round(settledAt - startedAt - measurement.workerMs),
      engineMs: measurement?.engineMs,
      answerMs: measurement?.answerMs,
      answerBytes: answer?.length,
      answerSteps: measurement?.answerSteps ?? [],
      uiGaps,
      slices: measurement?.slices ?? [],
      worstSlice: measurement?.worstSlice,
      pauses: measurement?.pauses ?? 0,
      longestPauseMs: measurement?.longestPauseMs ?? 0,
      statements: measurement?.statements ?? {},
      heap: measurement?.heap,
      channels: measurement?.channels,
      cancel:
        firedAt === undefined
          ? undefined
          : {
              intendedAtMs: cancelAfterMs,
              firedAtMs: round(firedAt - startedAt),
              settledAtMs: round(settledAt - startedAt),
              firedAtEpochMs: round(startedAtEpochMs + firedAt - startedAt),
              events: cancellationEvents,
            },
      window: {
        visibleAtStart,
        visibleAtEnd: document.visibilityState === "visible",
        hiddenDuringRun,
        focused: document.hasFocus(),
      },
      startedAtEpochMs,
    };
    return JSON.stringify(report);
  };

  plugin.registerCliHandler(
    ITEM_QUERY_MEASURE_COMMAND,
    "Run one Item Query and report its slices, statements, heap, and cancel times (dev build)",
    itemQueryMeasureFlags,
    measure,
  );
}
