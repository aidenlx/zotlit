// The pure half of the Item Query measurement script: the thresholds of the
// performance acceptance criteria (spec #1314), their evaluation, and the
// summary for the release pull request. `item-query-measure.ts` produces the measurements.

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

/** One run of one query, as the measurement command reports it. */
export interface RunSample {
  totalMs: number;
  slices: readonly number[];
  /** The readers of the statements in the longest slice. */
  worstSliceReaders: readonly string[];
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
  worstSliceMs: number;
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
  /** Peak heap of the engine above the heap before the run, largest of the runs. */
  peakBytes: number;
  /** Heap above the start after the handler built its answer. */
  afterAnswerBytes: number;
}

export interface TierMeasurement {
  /** Top-level Items in the Library. */
  items: number;
  queries: readonly QueryMeasurement[];
  cancels: readonly CancelMeasurement[];
  missedCancels: readonly MissedCancel[];
  heaps: readonly HeapMeasurement[];
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
  kind: "slices" | "total" | "cancel";
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

/** Every threshold of one tier, each passed, failed, or recorded. */
export function evaluateTier(tier: TierMeasurement): Check[] {
  const checks: Check[] = [];
  for (const query of tier.queries) {
    const slices = pooledSlices(query);
    const p99 = percentile(slices, 99);
    const max = Math.max(0, ...slices);
    checks.push({
      tier: tier.items,
      kind: "slices",
      subject: query.id,
      detail: `p99 ${ms(p99)} ms (limit ${THRESHOLDS.slice.p99Ms}), max ${ms(max)} ms (limit ${THRESHOLDS.slice.maxMs})`,
      status:
        p99 <= THRESHOLDS.slice.p99Ms && max <= THRESHOLDS.slice.maxMs
          ? "passed"
          : "failed",
    });
    const total = median(query.runs.map((run) => run.totalMs));
    const budget = totalBudgetMs(query.class, tier.items);
    checks.push({
      tier: tier.items,
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
  for (const cancel of tier.cancels) {
    checks.push({
      tier: tier.items,
      kind: "cancel",
      subject: `${cancel.delivery}: ${cancel.query}`,
      detail: `${ms(cancel.latencyMs)} ms (limit ${THRESHOLDS.cancelMs})`,
      status: cancel.latencyMs <= THRESHOLDS.cancelMs ? "passed" : "failed",
    });
  }
  // A kind of request with no measured run proves nothing about the limit.
  const missed = Map.groupBy(tier.missedCancels, (cancel) => cancel.delivery);
  for (const [delivery, requests] of missed) {
    if (tier.cancels.some((cancel) => cancel.delivery === delivery)) continue;
    checks.push({
      tier: tier.items,
      kind: "cancel",
      subject: `${delivery}: not measured`,
      detail: `none of ${requests.length} cancel requests reached a running query (${requests.map((request) => request.outcome).join(", ")}); run the measurement again`,
      status: "failed",
    });
  }
  return checks;
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

function tierSection(tier: TierMeasurement): string {
  const checks = evaluateTier(tier);
  const statusOf = (kind: Check["kind"], subject: string): Status =>
    checks.find((check) => check.kind === kind && check.subject === subject)!
      .status;

  const queries = table(
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
    ],
    tier.queries.map((query) => {
      const slices = pooledSlices(query);
      const budget = totalBudgetMs(query.class, tier.items);
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
      ];
    }),
  );

  const parts = [`### ${count(tier.items)} Items`, queries];

  if (tier.cancels.length > 0) {
    parts.push(
      table(
        [
          "Cancel request",
          "Query",
          "Request to settlement (ms)",
          `Limit ${THRESHOLDS.cancelMs} ms`,
          "CLI transport (ms)",
          "Worst slice (ms)",
        ],
        tier.cancels.map((cancel) => [
          cancel.delivery,
          `\`${cancel.query}\``,
          ms(cancel.latencyMs),
          MARK[statusOf("cancel", `${cancel.delivery}: ${cancel.query}`)],
          cancel.transportMs === undefined ? "-" : ms(cancel.transportMs),
          ms(cancel.worstSliceMs),
        ]),
      ),
    );
  }

  if (tier.heaps.length > 0) {
    parts.push(
      table(
        [
          "Peak heap",
          "Rows",
          "Engine peak above start (MB)",
          "MB for each 10,000 rows",
          "After the answer (MB)",
        ],
        tier.heaps.map((heap) => [
          `\`${heap.query}\``,
          count(heap.returnedCount),
          megabytes(heap.peakBytes),
          heap.class === "all" && heap.returnedCount > 0
            ? megabytes((heap.peakBytes / heap.returnedCount) * 10_000)
            : "-",
          megabytes(heap.afterAnswerBytes),
        ]),
      ),
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
    "## Item Query measurement record",
    [
      `Measured ${record.startedAt} in a visible Obsidian window.`,
      ...record.environment,
    ].join("\n"),
    verdict,
    `Thresholds: 99th percentile slice at most ${THRESHOLDS.slice.p99Ms} ms and no slice above ${THRESHOLDS.slice.maxMs} ms; cancel request to settlement within ${THRESHOLDS.cancelMs} ms; median \`limit 100\` total of five runs within ${THRESHOLDS.totalMs.selective[10_000]} ms for selective queries, and ${THRESHOLDS.totalMs.other[10_000]} ms (10,000 Items) or ${THRESHOLDS.totalMs.other[50_000]} ms (50,000 Items) for the others. Totals at 100,000 Items and of \`limit=all\` are recorded.`,
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
