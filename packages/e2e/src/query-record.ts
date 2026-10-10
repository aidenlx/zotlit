// The pure half of the ZotLit Query measurement script: the thresholds of the
// performance acceptance criteria (spec #1314), their evaluation, and the
// summary for the release pull request. `query-measure.ts` produces the measurements.

/** The thresholds of the reference machine: macOS arm64, a visible window. */
export const THRESHOLDS = {
  /** Every query at every tier. */
  slice: { p99Ms: 16, maxMs: 32 },
  /** From a cancel request to settlement, at every tier. */
  cancelMs: 50,
  /**
   * Median total of five `limit 100` runs, by query class and tier. A tier
   * with no entry, and every `limit=all` query, is recorded only.
   */
  totalMs: {
    selective: { 10_000: 50, 50_000: 50 },
    other: { 10_000: 150, 50_000: 750 },
  },
} as const satisfies {
  slice: { p99Ms: number; maxMs: number };
  cancelMs: number;
  totalMs: Record<"selective" | "other", Record<number, number>>;
};

/**
 * `selective`: one exact Tag, field value, Collection, or key that few Items
 * have. `other`: any other `limit 100` query. `all`: a `limit=all` query.
 */
export type QueryClass = "selective" | "other" | "all";

/** The same cross-dataset workload at every measurement tier. */
export const DATASET_QUERY_SPECS: readonly Pick<
  QueryMeasurement,
  "id" | "class" | "args"
>[] = [
  {
    id: "items-default",
    class: "other",
    args: { from: "items", limit: "100" },
  },
  {
    id: "collection-projection",
    class: "other",
    args: { from: "items", fields: "key,collections", limit: "100" },
  },
  {
    id: "attachments-default",
    class: "other",
    args: { from: "attachments", limit: "100" },
  },
  {
    id: "annotations-default",
    class: "other",
    args: { from: "annotations", limit: "100" },
  },
  {
    id: "relation-tag",
    class: "selective",
    args: {
      filter:
        'annotations.filter(value.tags.contains("methodology")).length > 0',
      limit: "100",
    },
  },
  {
    id: "relation-many-marks",
    class: "other",
    args: {
      from: "items",
      filter:
        'annotations.filter(value.tags.contains("stress-many-marks")).length > 0',
      limit: "100",
    },
  },
  {
    id: "relation-parent-dominant",
    class: "other",
    args: {
      from: "annotations",
      filter: 'item.tags.contains("stress-dominant")',
      limit: "100",
    },
  },
  {
    id: "relation-scan",
    class: "other",
    args: {
      filter: "attachments.filter(value.exists).isEmpty()",
      limit: "100",
    },
  },
  {
    id: "all-attachment-paths",
    class: "all",
    args: { fields: "attachments[].path", limit: "all" },
  },
];

/** One run of one query, as the measurement command reports it. */
export interface RunSample {
  totalMs: number;
  slices: readonly number[];
  /** Present for worker execution: renderer timer gaps across the entire call. */
  uiGaps?: readonly number[];
  /** The readers of the statements in the longest slice. */
  worstSliceReaders: readonly string[];
  /** Synchronous encoding steps within query execution. */
  answerSteps: readonly number[];
}

export interface QueryMeasurement {
  id: string;
  class: QueryClass;
  /** The arguments of the query, as given to the CLI. */
  args: Readonly<Record<string, string>>;
  returnedCount: number;
  runs: readonly RunSample[];
}

/**
 * One cancelled run. `timer`: a timer in the window requests the cancel.
 * `cli`: a second Obsidian CLI call requests it. `unload`: the plugin unloads.
 */
export interface CancelMeasurement {
  delivery: "timer" | "cli" | "unload";
  query: string;
  /**
   * From the cancel request to settlement. The request is the time the timer
   * was due, or the time the request reached the window.
   */
  latencyMs: number;
  /** From the CLI call in the terminal to its arrival in the window. */
  transportMs?: number;
  /** Absent when cancellation ends the worker before a complete trace exists. */
  worstSliceMs?: number;
}

/**
 * A cancel request that measured nothing: the run ended before the request
 * arrived, or it gave no report.
 */
export interface MissedCancel {
  delivery: CancelMeasurement["delivery"];
  query: string;
  /** How the run ended, such as `answered`. */
  outcome: string;
}

export interface HeapMeasurement {
  query: string;
  class: QueryClass;
  returnedCount: number;
  /** Absolute worker heap peak, largest of the runs. */
  peakBytes: number;
  beforeBytes?: number;
  /** Absolute worker heap after the handler built its answer. */
  afterAnswerBytes: number;
}

/**
 * The queries of a tier that read two large Libraries as one result set: My
 * Library with the Items of the tier, and a group Library. They have the slice
 * limits and the cancel limit; their totals are recorded.
 */
export interface TwoLibraryMeasurement {
  /** Top-level Items in the group Library. */
  groupItems: number;
  queries: readonly QueryMeasurement[];
  cancels: readonly CancelMeasurement[];
  missedCancels: readonly MissedCancel[];
  /** The run measured every query and every cancel of the part. */
  complete: boolean;
}

export interface TierMeasurement {
  /** Top-level Items in the Library. */
  items: number;
  queries: readonly QueryMeasurement[];
  cancels: readonly CancelMeasurement[];
  missedCancels: readonly MissedCancel[];
  heaps: readonly HeapMeasurement[];
  /** Undefined: the run stopped before the queries over two Libraries. */
  twoLibraries: TwoLibraryMeasurement | undefined;
}

export interface MeasurementRecord {
  /** ISO time the run started. */
  startedAt: string;
  /** The machine, Obsidian, and ZotLit versions, one line each. */
  environment: readonly string[];
  tiers: readonly TierMeasurement[];
  /** Statements of the first record and of each later finding. */
  notes: readonly string[];
  /** Where the raw output is. */
  rawPath: string;
}

/** `recorded`: the value has no threshold. */
export type Status = "passed" | "failed" | "recorded";

export interface Check {
  tier: number;
  /** `complete`: the run measured the part that the subject names. */
  kind: "slices" | "answer" | "ui" | "total" | "cancel" | "complete";
  subject: string;
  /** The measured values with their limits, as text. */
  detail: string;
  status: Status;
}

/** The nearest-rank percentile: the smallest value with `p`% of the sample at or below it. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)]!;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** The total-time budget of a query class at a tier, when it has one. */
export function totalBudgetMs(
  queryClass: QueryClass,
  items: number,
): number | undefined {
  if (queryClass === "all") return undefined;
  const budgets: Record<number, number> = THRESHOLDS.totalMs[queryClass];
  return budgets[items];
}

const ms = (value: number): string =>
  value >= 100 ? value.toFixed(0) : value.toFixed(1);

/** The slices of every run of a query, as one sample. */
function pooledSlices(query: QueryMeasurement): number[] {
  return query.runs.flatMap((run) => run.slices);
}

/**
 * The queries of a tier that read one set of Libraries, with their cancels:
 * those of one Library, or those of two Libraries.
 */
interface TierPart {
  /** The words that mark a subject of this part, when it needs a mark. */
  mark: string;
  queries: readonly QueryMeasurement[];
  cancels: readonly CancelMeasurement[];
  missedCancels: readonly MissedCancel[];
  /** The total-time budget of a query, when it has one. */
  budgetOf: (query: QueryMeasurement) => number | undefined;
}

function oneLibraryPart(tier: TierMeasurement): TierPart {
  return {
    mark: "",
    queries: tier.queries,
    cancels: tier.cancels,
    missedCancels: tier.missedCancels,
    budgetOf: (query) => totalBudgetMs(query.class, tier.items),
  };
}

function twoLibraryPart(measured: TwoLibraryMeasurement): TierPart {
  return {
    mark: ", two Libraries",
    queries: measured.queries,
    cancels: measured.cancels,
    missedCancels: measured.missedCancels,
    budgetOf: () => undefined,
  };
}

/** Every threshold of one tier, each passed, failed, or recorded. */
export function evaluateTier(tier: TierMeasurement): Check[] {
  const { items, twoLibraries } = tier;
  return [
    ...evaluatePart(items, oneLibraryPart(tier)),
    ...(twoLibraries ? evaluatePart(items, twoLibraryPart(twoLibraries)) : []),
    // A record without these queries proves nothing about two Libraries.
    ...(twoLibraries?.complete
      ? []
      : [
          {
            tier: items,
            kind: "complete",
            subject: "two Libraries",
            detail:
              "the run stopped before it measured every query and cancel over two Libraries; run the measurement again",
            status: "failed",
          } satisfies Check,
        ]),
  ];
}

/** The checks of one part of the tier with `items` Items. */
function evaluatePart(items: number, part: TierPart): Check[] {
  const checks: Check[] = [];
  for (const query of part.queries) {
    const worker = query.runs.some((run) => run.uiGaps !== undefined);
    const slices = pooledSlices(query);
    const p99 = percentile(slices, 99);
    const max = Math.max(0, ...slices);
    checks.push({
      tier: items,
      kind: "slices",
      subject: query.id,
      detail: `p99 ${ms(p99)} ms (limit ${THRESHOLDS.slice.p99Ms}), max ${ms(max)} ms (limit ${THRESHOLDS.slice.maxMs})`,
      status:
        p99 <= THRESHOLDS.slice.p99Ms && max <= THRESHOLDS.slice.maxMs
          ? "passed"
          : "failed",
    });
    // Execution and encoding retain the spec's limits in either process.
    const answerSteps = query.runs.flatMap((run) => run.answerSteps);
    const answerP99 = percentile(answerSteps, 99);
    const answerMax = Math.max(0, ...answerSteps);
    checks.push({
      tier: items,
      kind: "answer",
      subject: query.id,
      detail: `p99 ${ms(answerP99)} ms (limit ${THRESHOLDS.slice.p99Ms}), max ${ms(answerMax)} ms (limit ${THRESHOLDS.slice.maxMs})`,
      status:
        answerP99 <= THRESHOLDS.slice.p99Ms &&
        answerMax <= THRESHOLDS.slice.maxMs
          ? "passed"
          : "failed",
    });
    if (worker) {
      const gaps = query.runs.flatMap((run) => run.uiGaps ?? []);
      const complete = query.runs.every((run) => (run.uiGaps?.length ?? 0) > 0);
      const p99 = percentile(gaps, 99);
      const max = Math.max(0, ...gaps);
      checks.push({
        tier: items,
        kind: "ui",
        subject: query.id,
        detail: `renderer p99 ${ms(p99)} ms (limit ${THRESHOLDS.slice.p99Ms}), max ${ms(max)} ms (limit ${THRESHOLDS.slice.maxMs})${complete ? "" : "; missing samples"}`,
        status:
          complete &&
          p99 <= THRESHOLDS.slice.p99Ms &&
          max <= THRESHOLDS.slice.maxMs
            ? "passed"
            : "failed",
      });
    }
    const total = median(query.runs.map((run) => run.totalMs));
    const budget = part.budgetOf(query);
    checks.push({
      tier: items,
      kind: "total",
      subject: query.id,
      detail:
        budget === undefined
          ? `median ${ms(total)} ms`
          : `median ${ms(total)} ms (budget ${budget})`,
      status:
        budget === undefined
          ? "recorded"
          : total <= budget
            ? "passed"
            : "failed",
    });
  }
  for (const cancel of part.cancels) {
    checks.push({
      tier: items,
      kind: "cancel",
      subject: `${cancel.delivery}: ${cancel.query}`,
      detail: `${ms(cancel.latencyMs)} ms (limit ${THRESHOLDS.cancelMs})`,
      status: cancel.latencyMs <= THRESHOLDS.cancelMs ? "passed" : "failed",
    });
  }
  // A kind of request with no measured run proves nothing about the limit.
  const missed = Map.groupBy(part.missedCancels, (cancel) => cancel.delivery);
  for (const [delivery, requests] of missed) {
    if (part.cancels.some((cancel) => cancel.delivery === delivery)) continue;
    checks.push({
      tier: items,
      kind: "cancel",
      subject: `${delivery}: not measured${part.mark}`,
      detail: `none of ${requests.length} cancel requests reached a running query (${requests.map((request) => request.outcome).join(", ")}); run the measurement again`,
      status: "failed",
    });
  }
  return checks;
}

/**
 * The failed execution-slice, renderer-gap, and total-time checks for some
 * queries of a tier. Encoding steps have their own check.
 */
export function failedEngineChecks(
  tier: TierMeasurement,
  queryIDs: ReadonlySet<string>,
): Check[] {
  return evaluateTier(tier).filter(
    (check) =>
      check.status === "failed" &&
      (check.kind === "slices" ||
        check.kind === "ui" ||
        check.kind === "total") &&
      queryIDs.has(check.subject),
  );
}

const MARK: Record<Status, string> = {
  passed: "pass",
  failed: "**FAIL**",
  recorded: "recorded",
};

const megabytes = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);

const count = (value: number): string => value.toLocaleString("en-US");

function table(header: readonly string[], rows: readonly string[][]): string {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

/** The query table and the cancel table of one part of a tier. */
function partTables(items: number, part: TierPart): string[] {
  const checks = evaluatePart(items, part);
  const statusOf = (kind: Check["kind"], subject: string): Status =>
    checks.find((check) => check.kind === kind && check.subject === subject)!
      .status;

  const tables = [
    table(
      [
        "Query",
        "Class",
        "Rows",
        "Median total (ms)",
        "Budget (ms)",
        "Total",
        "Slices",
        "p99 slice (ms)",
        "Max slice (ms)",
        "Slice limits",
        "Worst slice of each run (ms)",
        "Answer steps",
        "Longest answer step (ms)",
        "Answer limits",
        "UI p99 (ms)",
        "UI max (ms)",
        "UI limits",
      ],
      part.queries.map((query) => {
        const slices = pooledSlices(query);
        const answerSteps = query.runs.flatMap((run) => run.answerSteps);
        const budget = part.budgetOf(query);
        return [
          `\`${query.id}\``,
          query.class,
          count(query.returnedCount),
          ms(median(query.runs.map((run) => run.totalMs))),
          budget === undefined ? "-" : String(budget),
          MARK[statusOf("total", query.id)],
          count(slices.length),
          ms(percentile(slices, 99)),
          ms(Math.max(0, ...slices)),
          MARK[statusOf("slices", query.id)],
          query.runs.map((run) => ms(Math.max(0, ...run.slices))).join(", "),
          count(answerSteps.length),
          ms(Math.max(0, ...answerSteps)),
          MARK[statusOf("answer", query.id)],
          query.runs[0]?.uiGaps
            ? ms(
                percentile(
                  query.runs.flatMap((run) => run.uiGaps ?? []),
                  99,
                ),
              )
            : "-",
          query.runs[0]?.uiGaps
            ? ms(Math.max(0, ...query.runs.flatMap((run) => run.uiGaps ?? [])))
            : "-",
          query.runs[0]?.uiGaps ? MARK[statusOf("ui", query.id)] : "-",
        ];
      }),
    ),
  ];
  if (part.cancels.length > 0) {
    tables.push(
      table(
        [
          "Cancel request",
          "Query",
          "Request to settlement (ms)",
          `Limit ${THRESHOLDS.cancelMs} ms`,
          "CLI transport (ms)",
          "Worst slice (ms)",
        ],
        part.cancels.map((cancel) => [
          cancel.delivery,
          `\`${cancel.query}\``,
          ms(cancel.latencyMs),
          MARK[statusOf("cancel", `${cancel.delivery}: ${cancel.query}`)],
          cancel.transportMs === undefined ? "-" : ms(cancel.transportMs),
          cancel.worstSliceMs === undefined ? "-" : ms(cancel.worstSliceMs),
        ]),
      ),
    );
  }
  return tables;
}

function tierSection(tier: TierMeasurement): string {
  const parts = [
    `### ${count(tier.items)} Items`,
    ...partTables(tier.items, oneLibraryPart(tier)),
  ];

  if (tier.heaps.length > 0) {
    parts.push(
      table(
        [
          "Peak heap",
          "Rows",
          "Worker baseline (MB)",
          "Worker peak (MB)",
          "MB for each 10,000 rows",
          "After the answer (MB)",
        ],
        tier.heaps.map((heap) => [
          `\`${heap.query}\``,
          count(heap.returnedCount),
          heap.beforeBytes === undefined ? "-" : megabytes(heap.beforeBytes),
          megabytes(heap.peakBytes),
          heap.class === "all" && heap.returnedCount > 0
            ? megabytes((heap.peakBytes / heap.returnedCount) * 10_000)
            : "-",
          megabytes(heap.afterAnswerBytes),
        ]),
      ),
    );
  }

  const { twoLibraries } = tier;
  if (twoLibraries) {
    parts.push(
      `#### Two Libraries: ${count(tier.items)} Items in My Library and ${count(twoLibraries.groupItems)} Items in the group Library`,
      ...partTables(tier.items, twoLibraryPart(twoLibraries)),
    );
  }
  return parts.join("\n\n");
}

/** The summary of one record, as a comment on the release pull request. */
export function formatSummary(record: MeasurementRecord): string {
  const checks = record.tiers.flatMap((tier) => evaluateTier(tier));
  const failed = checks.filter((check) => check.status === "failed");
  const thresholds = checks.filter((check) => check.status !== "recorded");

  const verdict =
    failed.length === 0
      ? `**Result: passed.** All ${thresholds.length} thresholds hold.`
      : `**Result: FAILED.** ${failed.length} of ${thresholds.length} thresholds failed.`;

  const parts = [
    "## ZotLit Query measurement record",
    [
      `Measured ${record.startedAt} in a visible Obsidian window.`,
      ...record.environment,
    ].join("\n"),
    verdict,
    `Thresholds: 99th percentile slice at most ${THRESHOLDS.slice.p99Ms} ms and no slice above ${THRESHOLDS.slice.maxMs} ms, for execution slices and encoding steps in either process, and for renderer timer gaps when execution uses workers; cancel request to settlement within ${THRESHOLDS.cancelMs} ms; median \`limit 100\` total of five runs within ${THRESHOLDS.totalMs.selective[10_000]} ms for selective queries, and ${THRESHOLDS.totalMs.other[10_000]} ms (10,000 Items) or ${THRESHOLDS.totalMs.other[50_000]} ms (50,000 Items) for the others. Totals at 100,000 Items, of \`limit=all\`, and of the queries over two Libraries are recorded.`,
  ];
  if (failed.length > 0) {
    parts.push(
      [
        "### Failed thresholds",
        ...failed.map(
          (check) =>
            `- ${count(check.tier)} Items, ${check.kind}, \`${check.subject}\`: ${check.detail}`,
        ),
      ].join("\n"),
    );
  }
  if (record.notes.length > 0) {
    parts.push(
      ["### Findings", ...record.notes.map((note) => `- ${note}`)].join("\n"),
    );
  }
  parts.push(...record.tiers.map((tier) => tierSection(tier)));
  parts.push(`Raw output: \`${record.rawPath}\``);
  return `${parts.join("\n\n")}\n`;
}
