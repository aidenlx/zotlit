import { describe, expect, it } from "vitest";

import {
  evaluateTier,
  failedEngineChecks,
  formatSummary,
  median,
  percentile,
  totalBudgetMs,
} from "./item-query-record.ts";
import type {
  MeasurementRecord,
  QueryMeasurement,
  TierMeasurement,
} from "./item-query-record.ts";

function query(
  overrides: Partial<QueryMeasurement> & Pick<QueryMeasurement, "id">,
): QueryMeasurement {
  return {
    class: "other",
    args: { limit: "100" },
    returnedCount: 100,
    runs: [
      {
        totalMs: 10,
        slices: [4, 8],
        worstSliceReaders: ["scan-page"],
        answerSteps: [1],
      },
    ],
    ...overrides,
  };
}

function tier(overrides: Partial<TierMeasurement> = {}): TierMeasurement {
  return {
    items: 10_000,
    queries: [],
    cancels: [],
    missedCancels: [],
    heaps: [],
    ...overrides,
  };
}

const statuses = (measured: TierMeasurement) =>
  evaluateTier(measured).map(
    ({ kind, subject, status }) => `${kind} ${subject}: ${status}`,
  );

describe("percentile", () => {
  it("gives the nearest-rank value", () => {
    const hundred = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(hundred, 99)).toBe(99);
    expect(percentile(hundred, 100)).toBe(100);
    expect(percentile([5, 1, 3], 50)).toBe(3);
  });

  it("gives the largest value of a small sample for the 99th percentile", () => {
    expect(percentile([2, 40, 3], 99)).toBe(40);
  });
});

describe("median", () => {
  it("gives the middle of an odd count and the mean of the middle pair of an even count", () => {
    expect(median([9, 1, 5, 3, 7])).toBe(5);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("total-time budget", () => {
  it("is 50 ms for a selective query at 10,000 and 50,000 Items", () => {
    expect(totalBudgetMs("selective", 10_000)).toBe(50);
    expect(totalBudgetMs("selective", 50_000)).toBe(50);
  });

  it("is 150 ms at 10,000 and 750 ms at 50,000 Items for another limited query", () => {
    expect(totalBudgetMs("other", 10_000)).toBe(150);
    expect(totalBudgetMs("other", 50_000)).toBe(750);
  });

  it("is absent at 100,000 Items and for limit=all", () => {
    expect(totalBudgetMs("selective", 100_000)).toBeUndefined();
    expect(totalBudgetMs("other", 100_000)).toBeUndefined();
    expect(totalBudgetMs("all", 10_000)).toBeUndefined();
  });
});

describe("threshold evaluation", () => {
  it("judges the median total of the runs against the budget of the class", () => {
    const totals = (...values: number[]) =>
      values.map((totalMs) => ({
        totalMs,
        slices: [1],
        worstSliceReaders: [],
        answerSteps: [1],
      }));
    expect(
      statuses(
        tier({
          queries: [
            // One slow run of five leaves the median inside the budget.
            query({
              id: "tag",
              class: "selective",
              runs: totals(20, 30, 40, 50, 900),
            }),
            query({
              id: "key",
              class: "selective",
              runs: totals(51, 51, 51, 1, 1),
            }),
            query({ id: "scan", runs: totals(150, 150, 150, 150, 150) }),
          ],
        }),
      ).filter((line) => line.startsWith("total")),
    ).toEqual(["total tag: passed", "total key: failed", "total scan: passed"]);
  });

  it("records a total at 100,000 Items and of limit=all", () => {
    const slow = [
      { totalMs: 9000, slices: [1], worstSliceReaders: [], answerSteps: [1] },
    ];
    expect(
      statuses(
        tier({ items: 100_000, queries: [query({ id: "scan", runs: slow })] }),
      ),
    ).toContain("total scan: recorded");
    expect(
      statuses(
        tier({ queries: [query({ id: "export", class: "all", runs: slow })] }),
      ),
    ).toContain("total export: recorded");
  });

  it("fails the slices of a query on one slice above 32 ms in any run", () => {
    const steady = Array.from({ length: 300 }, () => 8);
    expect(
      statuses(
        tier({
          items: 100_000,
          queries: [
            query({
              id: "export",
              class: "all",
              runs: [
                {
                  totalMs: 1,
                  slices: steady,
                  worstSliceReaders: [],
                  answerSteps: [1],
                },
                {
                  totalMs: 1,
                  slices: [...steady, 32.5],
                  worstSliceReaders: [],
                  answerSteps: [1],
                },
              ],
            }),
          ],
        }),
      ),
    ).toContain("slices export: failed");
  });

  it("fails the slices of a query when the 99th percentile is above 16 ms", () => {
    // 3 of 100 slices at 20 ms: no slice breaks 32 ms, the percentile does.
    const slices = [...Array.from({ length: 97 }, () => 8), 20, 20, 20];
    expect(
      statuses(
        tier({
          queries: [
            query({
              id: "scan",
              runs: [
                { totalMs: 1, slices, worstSliceReaders: [], answerSteps: [1] },
              ],
            }),
          ],
        }),
      ),
    ).toContain("slices scan: failed");
  });

  it("passes slices at the limits", () => {
    const slices = [...Array.from({ length: 199 }, () => 16), 32];
    expect(
      statuses(
        tier({
          queries: [
            query({
              id: "scan",
              runs: [
                { totalMs: 1, slices, worstSliceReaders: [], answerSteps: [1] },
              ],
            }),
          ],
        }),
      ),
    ).toContain("slices scan: passed");
  });

  it("holds the steps of the answer to the slice limits", () => {
    const answer = (longest: number) => [
      {
        totalMs: 10,
        slices: [1],
        worstSliceReaders: [],
        answerSteps: [...Array.from({ length: 99 }, () => 8), longest],
      },
    ];
    expect(
      statuses(
        tier({
          queries: [
            query({ id: "short", class: "all", runs: answer(32) }),
            query({ id: "long", class: "all", runs: answer(32.1) }),
          ],
        }),
      ).filter((status) => status.startsWith("answer")),
    ).toEqual(["answer short: passed", "answer long: failed"]);
  });

  it("counts for the scan only the failed engine checks of the queries that read scan pages", () => {
    const run = (slices: number[], answerSteps: number[]) => [
      { totalMs: 10, slices, worstSliceReaders: [], answerSteps },
    ];
    const measured = tier({
      queries: [
        // The engine holds its limits; one step of the answer is long.
        query({ id: "export", class: "all", runs: run([8], [4, 90]) }),
        query({ id: "scan", runs: run([8, 40], [1]) }),
        query({ id: "key", runs: run([8, 40], [1]) }),
      ],
    });

    expect(
      failedEngineChecks(measured, new Set(["export", "scan"])).map(
        ({ kind, subject }) => `${kind} ${subject}`,
      ),
    ).toEqual(["slices scan"]);
  });

  it("judges each cancel against 50 ms from request to settlement", () => {
    expect(
      statuses(
        tier({
          cancels: [
            {
              delivery: "timer",
              query: "export",
              latencyMs: 50,
              worstSliceMs: 9,
            },
            {
              delivery: "cli",
              query: "export",
              latencyMs: 50.1,
              transportMs: 85,
              worstSliceMs: 9,
            },
          ],
        }),
      ),
    ).toEqual(["cancel timer: export: passed", "cancel cli: export: failed"]);
  });

  it("fails a kind of cancel request of which no request reached a running query", () => {
    const measured = tier({
      cancels: [
        { delivery: "timer", query: "export", latencyMs: 9, worstSliceMs: 9 },
      ],
      missedCancels: [
        { delivery: "timer", query: "export at 90%", outcome: "answered" },
        { delivery: "cli", query: "export", outcome: "answered" },
        { delivery: "cli", query: "export", outcome: "failed" },
      ],
    });

    expect(statuses(measured)).toEqual([
      "cancel timer: export: passed",
      "cancel cli: not measured: failed",
    ]);
    expect(
      formatSummary({
        startedAt: "2026-10-05T08:00:00Z",
        environment: [],
        notes: [],
        rawPath: "raw.json",
        tiers: [measured],
      }),
    ).toContain("**Result: FAILED.** 1 of 2 thresholds failed.");
  });
});

describe("queries over two Libraries", () => {
  const run = (totalMs: number, slices: number[]) => [
    { totalMs, slices, worstSliceReaders: [], answerSteps: [1] },
  ];

  it("holds them to the slice limits and records their totals", () => {
    const measured = tier({
      twoLibraries: {
        groupItems: 10_000,
        queries: [
          // Above the 150 ms budget of a limited query of one Library.
          query({ id: "two-scan", runs: run(9000, [8, 16]) }),
          query({ id: "two-all", class: "all", runs: run(9000, [8, 32.5]) }),
        ],
        cancels: [],
        missedCancels: [],
      },
    });

    expect(statuses(measured)).toEqual([
      "slices two-scan: passed",
      "answer two-scan: passed",
      "total two-scan: recorded",
      "slices two-all: failed",
      "answer two-all: passed",
      "total two-all: recorded",
    ]);
  });

  it("judges their cancels against 50 ms from request to settlement", () => {
    const cancel = (latencyMs: number) => ({
      delivery: "timer" as const,
      query: `two-all at ${latencyMs}`,
      latencyMs,
      worstSliceMs: 9,
    });
    expect(
      statuses(
        tier({
          twoLibraries: {
            groupItems: 10_000,
            queries: [],
            cancels: [cancel(50), cancel(50.1)],
            missedCancels: [],
          },
        }),
      ),
    ).toEqual([
      "cancel timer: two-all at 50: passed",
      "cancel timer: two-all at 50.1: failed",
    ]);
  });

  it("fails when no cancel request reached a running query of two Libraries, whatever the cancels of one Library measured", () => {
    expect(
      statuses(
        tier({
          cancels: [
            { delivery: "timer", query: "all", latencyMs: 9, worstSliceMs: 9 },
          ],
          twoLibraries: {
            groupItems: 10_000,
            queries: [],
            cancels: [],
            missedCancels: [
              { delivery: "timer", query: "two-all", outcome: "answered" },
            ],
          },
        }),
      ),
    ).toEqual([
      "cancel timer: all: passed",
      "cancel timer: not measured, two Libraries: failed",
    ]);
  });

  it("stand in the summary under their own heading, with the verdict over both parts", () => {
    const summary = formatSummary({
      startedAt: "2026-10-05T08:00:00Z",
      environment: [],
      notes: [],
      rawPath: "raw.json",
      tiers: [
        tier({
          items: 50_000,
          queries: [query({ id: "scan" })],
          twoLibraries: {
            groupItems: 50_000,
            queries: [
              query({
                id: "two-all",
                class: "all",
                returnedCount: 100_000,
                runs: [...run(900, [8, 40]), ...run(1100, [9])],
              }),
            ],
            cancels: [
              {
                delivery: "timer",
                query: "two-all at 50%",
                latencyMs: 12.34,
                worstSliceMs: 9,
              },
            ],
            missedCancels: [],
          },
        }),
      ],
    });

    expect(summary).toContain("**Result: FAILED.** 1 of 6 thresholds failed.");
    expect(summary).toContain(
      "- 50,000 Items, slices, `two-all`: p99 40.0 ms (limit 16), max 40.0 ms (limit 32)",
    );
    expect(summary).toContain(
      "#### Two Libraries: 50,000 Items in My Library and 50,000 Items in the group Library",
    );
    expect(summary).toContain(
      "| `two-all` | all | 100,000 | 1000 | - | recorded | 3 | 40.0 | 40.0 | **FAIL** | 40.0, 9.0 |",
    );
    expect(summary).toContain(
      "| timer | `two-all at 50%` | 12.3 | pass | - | 9.0 |",
    );
  });
});

describe("summary", () => {
  const record: MeasurementRecord = {
    startedAt: "2026-10-05T08:00:00Z",
    environment: ["Machine: macOS arm64."],
    notes: ["Keyset paging meets the budgets."],
    rawPath: ".scratch/item-query-measure/raw.json",
    tiers: [
      tier({
        queries: [
          query({
            id: "tag-rare",
            class: "selective",
            returnedCount: 10,
            runs: [
              {
                totalMs: 12,
                slices: [3, 9.25],
                worstSliceReaders: [],
                answerSteps: [1],
              },
              {
                totalMs: 60,
                slices: [2, 40],
                worstSliceReaders: [],
                answerSteps: [1],
              },
              {
                totalMs: 14,
                slices: [5],
                worstSliceReaders: [],
                answerSteps: [1],
              },
            ],
          }),
        ],
        cancels: [
          {
            delivery: "cli",
            query: "export",
            latencyMs: 12.34,
            transportMs: 85,
            worstSliceMs: 9,
          },
        ],
        heaps: [
          {
            query: "export",
            class: "all",
            returnedCount: 20_000,
            peakBytes: 40 * 1024 * 1024,
            afterAnswerBytes: 64 * 1024 * 1024,
          },
        ],
      }),
    ],
  };
  const summary = formatSummary(record);

  it("reports the worst slice of every run and marks each threshold", () => {
    expect(summary).toContain(
      "| `tag-rare` | selective | 10 | 14.0 | 50 | pass | 5 | 40.0 | 40.0 | **FAIL** | 9.3, 40.0, 5.0 |",
    );
    expect(summary).toContain("| cli | `export` | 12.3 | pass | 85.0 | 9.0 |");
  });

  it("leads with the verdict and lists each failed threshold", () => {
    expect(summary).toContain("**Result: FAILED.** 1 of 4 thresholds failed.");
    expect(summary).toContain(
      "- 10,000 Items, slices, `tag-rare`: p99 40.0 ms (limit 16), max 40.0 ms (limit 32)",
    );
  });

  it("gives the heap of limit=all for each 10,000 rows", () => {
    expect(summary).toContain("| `export` | 20,000 | 40.0 | 20.0 | 64.0 |");
  });

  it("states the passed verdict, the findings, and the raw output path", () => {
    const passed = formatSummary({
      ...record,
      tiers: [tier({ queries: [query({ id: "scan" })] })],
    });
    expect(passed).toContain("**Result: passed.** All 3 thresholds hold.");
    expect(passed).toContain("- Keyset paging meets the budgets.");
    expect(passed).toContain(
      "Raw output: `.scratch/item-query-measure/raw.json`",
    );
  });
});
