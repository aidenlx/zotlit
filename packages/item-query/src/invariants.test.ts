// The deterministic invariants that keep the Obsidian window responsive. No
// test reads wall time: each one counts the statements and the pauses that the
// two observer services report.
import { Cause, Exit } from "effect";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BULK_FIFTH_TAG,
  BULK_LIBRARY,
  BULK_TAG,
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
  seedBulkLibrary,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { queryItems } from ".";
import type { ItemQueryRequest, QueryResult } from ".";
import { runEffect } from "./test-helpers";
import type { Run, RunEvent, RunOptions } from "./test-helpers";

/**
 * The bulk Library: 2,600 `items` rows, all of them top-level Items, so the
 * candidate cap of the production tuning is 650 Items. Every Item carries
 * `BULK_TAG` (above the cap); 520 Items carry `BULK_FIFTH_TAG` (within it).
 */
const BULK_ITEMS = 2600;
const BULK_CAP = 650;

let scenario: ScenarioDatabase;

beforeAll(() => {
  scenario = openScenarioDatabase();
  seedBulkLibrary(scenario.sqlite, BULK_ITEMS);
});

afterAll(() => {
  scenario.close();
});

type Request = Omit<ItemQueryRequest, "library">;

function run(
  request: Request,
  options: Omit<RunOptions, "client"> & {
    library?: ItemQueryRequest["library"];
  } = {},
) {
  const { library = BULK_LIBRARY, ...rest } = options;
  return runEffect(queryItems({ ...request, library }), {
    client: scenario.db,
    ...rest,
  });
}

function resultOf(of: Run<QueryResult, unknown>): QueryResult {
  if (!Exit.isSuccess(of.exit)) throw new Error(String(of.exit.cause));
  return of.exit.value;
}

/** The Items each statement of one reader read, in statement order. */
function itemsRead(events: readonly RunEvent[], reader: string): number[] {
  return events.flatMap((event) => {
    if (event.type !== "statement" || event.statement.reader !== reader) {
      return [];
    }
    const { rows } = event.statement;
    // A hydrate statement returns one row for each value: count its Items.
    return reader === "hydrate-chunk"
      ? new Set(rows.map((row) => (row as { itemID: number }).itemID)).size
      : rows.length;
  });
}

const byTitle = [{ field: "title", direction: "asc" }] as const;

/** One query for each path of the plan, at the production tuning. */
const PLAN_PATHS: readonly {
  name: string;
  request: Request;
  /** The Items that each statement of a reader reads, in order. */
  reads: Record<string, number[]>;
}[] = [
  {
    name: "a limited scan that hydrates the returned rows only",
    request: { fields: ["title"], limit: 10 },
    reads: {
      "scan-page": [500, 500, 500, 500, 500, 100],
      "hydrate-chunk": [10],
    },
  },
  {
    name: "a limited scan that hydrates every Item for the filter and the sort",
    request: {
      filter: 'title.contains("Bulk")',
      fields: ["title", "tags"],
      sort: byTitle,
      limit: 300,
    },
    reads: {
      "scan-page": [500, 500, 500, 500, 500, 100],
      "hydrate-chunk": [
        250, 250, 250, 250, 250, 250, 250, 250, 250, 250, 100,
        // The projection: the title and the Tags of 300 rows.
        250, 250, 50, 50,
      ],
    },
  },
  {
    name: "an unlimited scan",
    request: { fields: ["title"], limit: null },
    reads: {
      "scan-page": [500, 500, 500, 500, 500, 100],
      "hydrate-chunk": [250, 250, 250, 250, 250, 250, 250, 250, 250, 250, 100],
    },
  },
  {
    name: "a candidate set within the cap",
    request: {
      filter: `tags.contains("${BULK_FIFTH_TAG}")`,
      fields: ["title"],
      sort: byTitle,
      limit: null,
    },
    reads: {
      "candidate-set": [520],
      "universe-rows": [500, 20],
      // The Tags and the title of each chunk, then the title of each row.
      "hydrate-chunk": [250, 250, 250, 250, 20, 20, 250, 250, 20],
    },
  },
  {
    name: "a candidate set above the cap, which falls back to the scan",
    request: {
      filter: `tags.contains("${BULK_TAG}")`,
      fields: [],
      limit: 10,
    },
    reads: {
      "candidate-set": [BULK_CAP + 1],
      "scan-page": [500, 500, 500, 500, 500, 100],
      "hydrate-chunk": [250, 250, 250, 250, 250, 250, 250, 250, 250, 250, 100],
    },
  },
  {
    name: "two candidate sets that && intersects",
    request: {
      filter: `tags.contains("${BULK_FIFTH_TAG}") && key == "BLK22222"`,
      fields: ["title"],
      limit: 10,
    },
    reads: {
      "candidate-set": [520, 1],
      "universe-rows": [1],
      "hydrate-chunk": [1, 1],
    },
  },
];

describe("the Items one statement reads", () => {
  it.each(PLAN_PATHS)(
    "reads at most 500 Item rows in $name",
    async ({ request, reads }) => {
      const { events } = await run(request);

      for (const reader of [
        "scan-page",
        "universe-rows",
        "hydrate-chunk",
        "candidate-set",
      ]) {
        expect(itemsRead(events, reader), reader).toEqual(reads[reader] ?? []);
      }
      // A candidate statement reads Item IDs only, the cap plus one at most.
      for (const reader of ["scan-page", "universe-rows", "hydrate-chunk"]) {
        expect(Math.max(0, ...itemsRead(events, reader))).toBeLessThanOrEqual(
          500,
        );
      }
      expect(
        Math.max(0, ...itemsRead(events, "candidate-set")),
      ).toBeLessThanOrEqual(BULK_CAP + 1);
    },
  );
});

describe("the pauses between two chunks", () => {
  it.each(PLAN_PATHS)(
    "pauses between every two statements of $name",
    async ({ request }) => {
      const { events } = await run(request);

      const statements = events.filter((event) => event.type === "statement");
      const withoutPause = events.filter(
        (event, index) =>
          event.type === "statement" && events[index + 1]?.type === "statement",
      );
      expect(statements.length).toBeGreaterThan(2);
      expect(withoutPause).toEqual([]);
    },
  );

  it("merges the sorted runs of an unlimited query in steps of the merge step size at most", async () => {
    // 520 matches in runs of 250, 250, and 20 rows: one merge moves 500 rows
    // and the next one 520.
    const request: Request = {
      filter: `tags.contains("${BULK_FIFTH_TAG}")`,
      fields: [],
      sort: byTitle,
      limit: null,
    };
    await run(request);

    const oneStepEach = await run(request, { tuning: { mergeStepSize: 520 } });
    const stepsOf100 = await run(request, { tuning: { mergeStepSize: 100 } });
    const stepsOfOne = await run(request, { tuning: { mergeStepSize: 1 } });

    expect(resultOf(stepsOf100)).toEqual(resultOf(oneStepEach));
    expect(resultOf(stepsOfOne)).toEqual(resultOf(oneStepEach));
    // Steps of 100 rows: 5 and 6 steps in place of 1 and 1. The test scheduler
    // pauses after each step.
    expect(stepsOf100.pauses - oneStepEach.pauses).toBeGreaterThanOrEqual(9);
    expect(stepsOfOne.pauses - oneStepEach.pauses).toBeGreaterThanOrEqual(1018);
  });
});

describe("the rows a limited query projects", () => {
  it("hydrates the returned rows only, not the row that proves truncation", async () => {
    const limited = await run({
      fields: ["title"],
      sort: [{ field: "dateModified", direction: "desc" }],
      limit: 10,
    });

    const result = resultOf(limited);
    expect(result).toMatchObject({ returnedCount: 10, truncated: true });
    expect(result.rows.map((row) => row.values.title)).toEqual([
      "Bulk item 02599",
      "Bulk item 02598",
      "Bulk item 02597",
      "Bulk item 02596",
      "Bulk item 02595",
      "Bulk item 02594",
      "Bulk item 02593",
      "Bulk item 02592",
      "Bulk item 02591",
      "Bulk item 02590",
    ]);
    // The sort reads the scan rows, so every hydrate statement is projection.
    const hydrated = limited.events.flatMap((event) =>
      event.type === "statement" && event.statement.reader === "hydrate-chunk"
        ? event.statement.rows.map((row) => (row as { value: string }).value)
        : [],
    );
    expect(new Set(hydrated)).toEqual(
      new Set(result.rows.map((row) => row.values.title)),
    );
    expect(hydrated).toHaveLength(10);
  });
});

// V8's collector, to count the rows that the engine still holds.
setFlagsFromString("--expose-gc");
const collectGarbage = runInNewContext("gc") as () => void;

describe("the rows a limited query retains", () => {
  const LIMIT = 10;
  const QUERIES: readonly { name: string; request: Request; items: number }[] =
    [
      {
        name: "a scan that hydrates the returned rows only",
        request: { fields: ["title"], limit: LIMIT },
        items: BULK_ITEMS,
      },
      {
        name: "a scan that hydrates every Item for the sort",
        request: { fields: ["title", "tags"], sort: byTitle, limit: LIMIT },
        items: BULK_ITEMS,
      },
      {
        name: "a candidate set",
        request: {
          filter: `tags.contains("${BULK_FIFTH_TAG}")`,
          fields: ["title"],
          sort: byTitle,
          limit: LIMIT,
        },
        items: 520,
      },
    ];

  it.each(QUERIES)(
    "holds the limit plus one row, one page, and one hydrate chunk at most in $name",
    async ({ request, items }) => {
      // The rows of the query universe and the rows of the hydrate statements
      // that the collector has not freed.
      const scanned: WeakRef<object>[] = [];
      const hydrated: WeakRef<{ itemID: number }>[] = [];
      const samples: { at: string; rows: number; hydratedItems: number }[] = [];

      const limited = await run(request, {
        keepStatements: false,
        onEvent: (event) => {
          if (event.type !== "statement") return;
          // Free what the engine has released, then count what it holds with
          // the rows of this statement. The first collection can end a marking
          // cycle that began earlier and keeps what was live at its start.
          collectGarbage();
          collectGarbage();
          const { reader, rows } = event.statement;
          const kept = reader === "hydrate-chunk" ? hydrated : scanned;
          if (reader === "hydrate-chunk" || READS_UNIVERSE.has(reader)) {
            for (const row of rows) kept.push(new WeakRef(row as never));
          }
          samples.push({
            at: reader,
            rows: scanned.filter((row) => row.deref()).length,
            hydratedItems: new Set(
              hydrated.flatMap((row) => row.deref()?.itemID ?? []),
            ).size,
          });
        },
      });

      expect(resultOf(limited)).toMatchObject({
        returnedCount: LIMIT,
        truncated: true,
      });
      expect(scanned).toHaveLength(items);
      const most = (values: number[]) => Math.max(0, ...values);
      // The collector sees the rows: one page is in memory while it is read.
      expect(most(samples.map((entry) => entry.rows))).toBeGreaterThanOrEqual(
        Math.min(items, 500),
      );
      expect(most(samples.map((entry) => entry.rows))).toBeLessThanOrEqual(
        LIMIT + 1 + 500,
      );
      expect(
        most(samples.map((entry) => entry.hydratedItems)),
      ).toBeLessThanOrEqual(250);
      // The projection starts with the matches only: the pages are released.
      expect(samples.at(-1)).toEqual({
        at: "hydrate-chunk",
        rows: LIMIT + 1,
        hydratedItems: LIMIT,
      });
    },
  );
});

/** The readers whose rows are the rows of the query universe. */
const READS_UNIVERSE = new Set(["scan-page", "universe-rows"]);

describe("a cancel request", () => {
  const { personal } = SCENARIO_LIBRARIES;
  /** Small chunks: many statements and pauses on the scenario Library. */
  const tuning = {
    capRatio: 1,
    scanPageSize: 3,
    hydrateChunkSize: 2,
    mergeStepSize: 2,
  };
  const QUERIES: readonly { name: string; request: Request }[] = [
    {
      name: "a limited scan",
      request: { fields: ["title", "creators"], sort: byTitle, limit: 4 },
    },
    {
      name: "an unlimited scan with a merge",
      request: { fields: ["title"], sort: byTitle, limit: null },
    },
    {
      name: "candidate sets",
      request: {
        filter: 'tags.contains("methods") || itemType == "book"',
        fields: ["title", "tags"],
        sort: byTitle,
        limit: null,
      },
    },
  ];

  /** Run the query and cancel it at the event at `index`. */
  async function cancelAt(
    request: Request,
    index: number,
    cancel: (controller: AbortController) => void,
  ) {
    const controller = new AbortController();
    let seen = 0;
    const cancelled = await run(request, {
      library: personal,
      tuning,
      signal: controller.signal,
      onEvent: () => {
        if (seen++ === index) cancel(controller);
      },
    });
    return { ...cancelled, after: cancelled.events.slice(index + 1) };
  }

  it.each(QUERIES)(
    "starts no statement after a cancel request that comes in a statement of $name",
    async ({ request }) => {
      const complete = await run(request, { library: personal, tuning });
      resultOf(complete);
      const statements = complete.events.flatMap((event, index) =>
        event.type === "statement" ? [index] : [],
      );
      expect(statements.length).toBeGreaterThan(8);

      for (const index of statements) {
        const { exit, after } = await cancelAt(request, index, (controller) =>
          controller.abort(),
        );

        expect(
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
        ).toBe(true);
        expect(after.filter((event) => event.type === "statement")).toEqual([]);
      }
    },
  );

  it.each(QUERIES)(
    "starts no statement after a cancel request that comes in a pause of $name",
    async ({ request }) => {
      const complete = await run(request, { library: personal, tuning });
      const pauses = complete.events.flatMap((event, index) =>
        event.type === "pause" ? [index] : [],
      );
      expect(pauses.length).toBeGreaterThan(20);

      for (const index of pauses) {
        // The microtask runs when the slice has ended and the fiber waits.
        const { exit, after } = await cancelAt(request, index, (controller) =>
          queueMicrotask(() => controller.abort()),
        );

        expect(
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
        ).toBe(true);
        // The interrupted fiber can take one more pause before it settles.
        expect(after.filter((event) => event.type === "statement")).toEqual([]);
        expect(after.length).toBeLessThanOrEqual(1);
      }
    },
  );
});
