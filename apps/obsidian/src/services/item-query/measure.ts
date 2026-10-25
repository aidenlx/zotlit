// The measurement command of ZotLit Query, registered in a dev build only. The
// release-time measurement script (packages/e2e/src/query-measure.ts) calls
// them to read what `zotlit:query` cannot report: the slices of the
// engine, its statements, the heap, and the time from a cancel request to
// settlement. Each run goes through the handler of `zotlit:query` itself,
// with the two observer references of the engine provided. A run with `id` is
// a named query: the production `zotlit:query-cancel` stops it.
//
// Command, flag, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.

import { Cause, Clock, Effect, Exit, Fiber, Layer, Schema } from "effect";
import type { CliData, CliFlags } from "obsidian";

import type { ItemQueryReader } from "@zotlit/db/item-query";

import type { CliHost } from "@/lib/cli-command";
import {
  cliMap,
  cliParams,
  cliSwitch,
  decodeCliParams,
  rejectionText,
} from "@/lib/cli-params";
import type { CliOutput, CliRejection } from "@/lib/cli-params";
import { PluginHost } from "@/lib/plugin-host";

import { queryFlags } from "./contract";
import { decodeQuery } from "./decode";
import { QueryService } from "./service";
import type { CancellationEvent, WorkerMeasurement } from "./trace";

export const QUERY_MEASURE_COMMAND = "zotlit:query-measure" as const;

const queryMeasureFlags: CliFlags = {
  ...queryFlags,
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
export interface QueryMeasureReport {
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
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const round = (ms: number): number => Math.round(ms * 100) / 100;

/**
 * The parameters of a measured run; the rest are the query's own, which
 * `zotlit:query` decodes.
 */
const measureParams = cliParams({
  cancelAfterMs: Schema.optionalKey(
    Schema.String.check(
      Schema.makeFilter(
        (text: string) =>
          (text.trim() !== "" &&
            Number.isFinite(Number(text)) &&
            Number(text) >= 0) ||
          `cancelAfterMs '${text}' is not a time in milliseconds: use a number from 0.`,
      ),
    ).pipe(cliMap(Number)),
  ),
  heap: cliSwitch("heap is a switch: name it alone, as heap."),
});

/** The `zotlit:query-measure` command, over the plugin's ZotLit Query. */
export const layerQueryMeasureCli: Layer.Layer<
  never,
  never,
  PluginHost | QueryService
> = Layer.effectDiscard(
  Effect.gen(function* () {
    registerQueryMeasureCli(yield* PluginHost, yield* QueryService);
  }),
);

export function registerQueryMeasureCli(
  host: CliHost,
  queryService: Pick<QueryService["Service"], "measure">,
): void {
  const measure = Effect.fn("QueryCli.measure")(function* (params: CliData) {
    // A parameter of the run, also as a `--` token, is the run's own; the rest
    // are the query's. The run has no envelope for an invalid argument, so the
    // command rejects before it starts.
    const runParams: CliData = {};
    const query: CliData = {};
    for (const [key, value] of Object.entries(params)) {
      const name = key.replace(/^--/, "");
      (Object.hasOwn(measureParams.fields, name) ? runParams : query)[key] =
        value;
    }
    const rejected = (rejection: CliRejection) =>
      new TypeError(rejectionText(rejection));
    const measured = yield* decodeCliParams(runParams, measureParams, {
      command: QUERY_MEASURE_COMMAND,
    }).pipe(Effect.mapError((rejection) => rejected(rejection)));
    yield* decodeQuery(query).pipe(
      Effect.mapError((rejection) => rejected(rejection)),
    );
    return yield* measureRun({ queryService, query, measured });
  });

  host.registerCliCommand(QUERY_MEASURE_COMMAND, {
    description:
      "Run one ZotLit Query and report its slices, statements, heap, and cancel times (dev build)",
    flags: queryMeasureFlags,
    handler: measure,
  });
}

/**
 * One measured run of `query`, until it answers or fails. A cancel, from the
 * `cancelAfterMs` timer or `zotlit:query-cancel`, ends it with a report;
 * interrupting it, as an unload does, aborts the run with no report.
 */
const measureRun = Effect.fn("QueryCli.measureRun")(function* ({
  queryService,
  query,
  measured,
}: {
  queryService: Pick<QueryService["Service"], "measure">;
  query: CliData;
  measured: CliOutput<typeof measureParams>;
}) {
  let measurement: WorkerMeasurement | undefined;
  const cancellationEvents: CancellationEvent[] = [];
  const uiGaps: number[] = [];
  let lastTick = now();
  const sampleUi = () => {
    const at = now();
    uiGaps.push(round(at - lastTick));
    lastTick = at;
  };
  let hiddenDuringRun = document.visibilityState !== "visible";
  const visibleAtStart = !hiddenDuringRun;
  const onVisibility = () => {
    if (document.visibilityState !== "visible") hiddenDuringRun = true;
  };

  const startedAt = now();
  const startedAtEpochMs = yield* Clock.currentTimeMillis;
  // The service reports the request from any source: the timer, an unload,
  // or `zotlit:query-cancel` for a run with `id`.
  let firedAt: number | undefined;

  const settled = yield* Effect.gen(function* () {
    // Renderer timer gaps: a real interval, sampled once more as the run ends.
    yield* Effect.acquireRelease(
      Effect.sync(() => window.setInterval(sampleUi, 4)),
      (uiTimer) =>
        Effect.sync(() => {
          sampleUi();
          window.clearInterval(uiTimer);
        }),
    );
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        document.addEventListener("visibilitychange", onVisibility),
      ),
      () =>
        Effect.sync(() =>
          document.removeEventListener("visibilitychange", onVisibility),
        ),
    );
    const run = yield* Effect.forkScoped(
      queryService.measure(query, {
        completed: (report) => {
          measurement = report;
        },
        cancelled: (event) => {
          if (event.phase === "requested") firedAt ??= now();
          cancellationEvents.push(event);
        },
        heap: measured.heap === true,
      }),
    );
    // The timer cancels the run by interrupting it; the run still settles,
    // so the report holds the cancel times.
    if (measured.cancelAfterMs !== undefined)
      yield* Effect.forkScoped(
        Effect.sleep(measured.cancelAfterMs).pipe(
          Effect.andThen(Fiber.interrupt(run)),
        ),
      );
    return yield* Fiber.await(run);
  }).pipe(Effect.scoped);
  const settledAt = now();

  const answer = Exit.isSuccess(settled) ? settled.value : undefined;
  // The service reports each cancel request, also one that names the run.
  const outcome: QueryMeasureReport["outcome"] = Exit.isSuccess(settled)
    ? "answered"
    : firedAt === undefined
      ? "failed"
      : "cancelled";
  const error = Exit.isFailure(settled)
    ? errorText(Cause.squash(settled.cause))
    : undefined;

  const envelope =
    answer === undefined
      ? undefined
      : (JSON.parse(answer) as {
          ok: boolean;
          returnedCount?: number;
          truncated?: boolean;
          diagnostic?: { code: string };
        });

  const report: QueryMeasureReport = {
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
            intendedAtMs: measured.cancelAfterMs,
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
});
