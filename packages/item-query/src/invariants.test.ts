// The deterministic invariants that keep the Obsidian window responsive. No
// test reads wall time: each one counts the statements and the pauses that the
// two observer services report. The rows a limited query retains are in
// `retention.test.ts`.
import { Cause, Exit } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BULK_FIFTH_TAG,
  BULK_LIBRARY,
  BULK_TAG,
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
  seedBulkLibrary,
  seedBulkAnnotations,
  seedBulkAttachments,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { ANNOTATIONS, ATTACHMENTS, collectQuery, ITEMS } from ".";
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
let annotations: ScenarioDatabase;
let attachments: ScenarioDatabase;

beforeAll(async () => {
  scenario = openScenarioDatabase();
  seedBulkLibrary(scenario.sqlite, BULK_ITEMS);
  // The first statement on a copy runs the layout check. Its two statements
  // are in the events of that run only, so each test starts after it.
  resultOf(await run({ fields: [], limit: 1 }));
  attachments = openScenarioDatabase();
  seedBulkLibrary(attachments.sqlite, BULK_ITEMS);
  seedBulkAttachments(attachments.sqlite, BULK_ITEMS);
  resultOf(await run({ fields: [], limit: 1 }, { attachment: true }));
  annotations = openScenarioDatabase();
  seedBulkLibrary(annotations.sqlite, BULK_ITEMS);
  seedBulkAnnotations(annotations.sqlite, BULK_ITEMS);
  resultOf(await run({ fields: [], limit: 1 }, { annotation: true }));
});

afterAll(() => {
  scenario.close();
  annotations.close();
  attachments.close();
});

type Request = Omit<ItemQueryRequest, "libraries">;

function run(
  request: Request,
  options: Omit<RunOptions, "client"> & {
    libraries?: ItemQueryRequest["libraries"];
    annotation?: boolean;
    attachment?: boolean;
    relation?: boolean;
  } = {},
) {
  const {
    libraries = [BULK_LIBRARY],
    annotation = false,
    attachment = false,
    relation = false,
    ...rest
  } = options;
  return runEffect(
    collectQuery(
      relation
        ? ITEMS
        : attachment
          ? ATTACHMENTS
          : annotation
            ? ANNOTATIONS
            : ITEMS,
      {
        ...request,
        libraries,
      },
    ),
    {
      client: attachment
        ? attachments.db
        : annotation
          ? annotations.db
          : scenario.db,
      ...rest,
    },
  );
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
    return reader.endsWith("hydrate-chunk")
      ? new Set(rows.map((row) => (row as { itemID: number }).itemID)).size
      : rows.length;
  });
}

const byTitle = [{ field: "title", direction: "asc" }] as const;

/** One query for each path of the plan, at the production tuning. */
const PLAN_PATHS: readonly {
  name: string;
  request: Request;
  annotation?: boolean;
  attachment?: boolean;
  relation?: boolean;
  parentCandidates?: boolean;
  result?: Pick<QueryResult, "returnedCount" | "truncated">;
  /** @default the bulk Library */
  libraries?: ItemQueryRequest["libraries"];
  /** The Items that each statement of a reader reads, in order. */
  reads: Record<string, number[]>;
}[] = [
  {
    name: "an Item relation candidate through an Attachment key",
    attachment: true,
    relation: true,
    request: {
      filter: 'attachments.filter(value.key == "ATT22222").length > 0',
      fields: ["title"],
      limit: 10,
    },
    result: { returnedCount: 1, truncated: false },
    reads: {
      "attachment-candidate-set": [1],
      "universe-rows": [1],
      "hydrate-chunk": [1],
    },
  },
  {
    name: "a grouped scan",
    request: { group: "library", fields: ["title"], limit: 10 },
    reads: {
      "scan-page": [500, 500, 500, 500, 500, 100],
      "hydrate-chunk": [10],
    },
  },
  {
    name: "Attachment Indexed Key list",
    attachment: true,
    request: {
      filter: '["ATT22222g2718", "ATT22223g2718"].contains(indexedKey)',
      fields: ["title"],
      limit: 10,
    },
    reads: {
      "attachment-candidate-set": [2],
      "attachment-universe-rows": [2],
      "attachment-details": [2],
    },
  },
  ...[
    'indexedKey == "ATT22222g2718"',
    'item.indexedKey == "BLK22222g2718"',
    '["BLK22222g2718"].contains(item.indexedKey)',
  ].map((filter) => ({
    name: `Attachment Indexed Key ${filter}`,
    parentCandidates: !filter.startsWith("indexedKey"),
    attachment: true,
    request: { filter, fields: ["title"], limit: 10 },
    reads: {
      "attachment-candidate-set": [1],
      "attachment-universe-rows": [1],
      "attachment-details": [1],
    },
  })),
  {
    name: "Attachment default scan",
    attachment: true,
    request: { fields: ["title"], limit: 10 },
    reads: {
      "attachment-scan-page": [500, 500, 500, 500, 500, 100],
      "attachment-details": [10],
    },
  },
  ...[
    'tags.contains("bulk-fifth")',
    'contentType == "text/html"',
    'linkMode == "linked_url"',
  ].map((filter) => ({
    name: `Attachment candidate ${filter}`,
    attachment: true,
    request: { filter, fields: ["title"], limit: 10 },
    reads: {
      "attachment-candidate-set": [520],
      "attachment-universe-rows": [500, 20],
      ...(filter.startsWith("tags")
        ? { "attachment-tags": [250, 250, 20], "attachment-details": [10] }
        : { "attachment-details": [250, 250, 20, 10] }),
    },
  })),
  {
    name: "Attachment key candidate",
    attachment: true,
    request: { filter: 'key == "ATT22222"', fields: ["title"], limit: 10 },
    reads: {
      "attachment-candidate-set": [1],
      "attachment-universe-rows": [1],
      "attachment-details": [1],
    },
  },
  {
    name: "Attachment parent Collection candidate",
    parentCandidates: true,
    attachment: true,
    request: {
      filter: 'item.collections.contains("Bulk collection")',
      fields: ["title"],
      limit: 10,
    },
    reads: {
      "attachment-candidate-set": [520],
      "attachment-universe-rows": [500, 20],
      "hydrate-chunk": [250, 250, 20],
      "attachment-details": [10],
    },
  },
  {
    name: "Attachment cap fallback",
    attachment: true,
    request: {
      filter: 'contentType == "application/pdf"',
      fields: ["title"],
      limit: 10,
    },
    reads: {
      "attachment-candidate-set": [651],
      "attachment-scan-page": [500, 500, 500, 500, 500, 100],
      "attachment-details": [
        250, 250, 250, 250, 250, 250, 250, 250, 250, 250, 100, 10,
      ],
    },
  },

  {
    name: "an Indexed Key list within the candidate cap",
    request: {
      filter: '["BLK22222g2718", "BLK22223g2718"].contains(indexedKey)',
      fields: [],
      limit: 10,
    },
    reads: { "candidate-set": [2], "universe-rows": [2] },
  },
  {
    name: "an Annotation Indexed Key within the candidate cap",
    annotation: true,
    request: {
      filter: 'indexedKey == "ANN22222g2718"',
      fields: ["text"],
      limit: 10,
    },
    result: { returnedCount: 1, truncated: false },
    reads: {
      "annotation-candidate-set": [1],
      "annotation-universe-rows": [1],
      "annotation-details": [1],
    },
  },
  ...[
    'item.indexedKey == "BLK22222g2718"',
    '["BULKPDF2g2718"].contains(attachment.indexedKey)',
  ].map((filter) => ({
    name: `an Annotation parent selection above the candidate cap: ${filter}`,
    parentCandidates: true,
    annotation: true,
    request: { filter, fields: ["text"], limit: 10 },
    reads: {
      "annotation-candidate-set": [BULK_CAP + 1],
      "annotation-scan-page": [500, 500, 500, 500, 500, 100],
      "annotation-details": [10],
    },
  })),
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
  {
    name: "a limited scan of two Libraries",
    libraries: [SCENARIO_LIBRARIES.personal, BULK_LIBRARY],
    request: { fields: ["title"], limit: 10 },
    reads: {
      // The 10 Items of the personal Library, then the bulk Library.
      "scan-page": [10, 500, 500, 500, 500, 500, 100],
      // The 10 newest Items are the personal ones; one of them has no title.
      "hydrate-chunk": [9],
    },
  },
  {
    name: "a candidate set in one Library and the scan in the other",
    libraries: [SCENARIO_LIBRARIES.personal, BULK_LIBRARY],
    request: {
      filter: `tags.contains("to-read") || tags.contains("${BULK_TAG}")`,
      fields: [],
      limit: 10,
    },
    reads: {
      // The personal Library has 15 `items` rows and a cap of 3: its union of
      // 3 and 0 Items is within it. The bulk union of 0 and 651 is above 650.
      "candidate-set": [3, 0, 0, BULK_CAP + 1],
      // One of the three personal candidates is in the trash.
      "universe-rows": [2],
      "scan-page": [500, 500, 500, 500, 500, 100],
      "hydrate-chunk": [
        2, 250, 250, 250, 250, 250, 250, 250, 250, 250, 250, 100,
      ],
    },
  },
  {
    name: "a limited Annotation scan",
    annotation: true,
    request: { fields: ["text"], limit: 10 },
    reads: {
      // The scan pass reads the scan rows only; the projection loads details.
      "annotation-scan-page": [500, 500, 500, 500, 500, 100],
      "annotation-details": [10],
    },
  },
  {
    name: "an Annotation candidate set within the cap",
    annotation: true,
    request: { filter: 'type == "image"', fields: ["text"], limit: 10 },
    reads: {
      "annotation-candidate-set": [520],
      "annotation-universe-rows": [500, 20],
      "annotation-details": [250, 250, 20, 10],
    },
  },
  {
    name: "an Annotation candidate set above the cap",
    annotation: true,
    request: { filter: 'type == "highlight"', fields: ["text"], limit: 10 },
    reads: {
      "annotation-candidate-set": [BULK_CAP + 1],
      "annotation-scan-page": [500, 500, 500, 500, 500, 100],
      "annotation-details": [
        250, 250, 250, 250, 250, 250, 250, 250, 250, 250, 100, 10,
      ],
    },
  },
];

describe("the Items one statement reads", () => {
  it.each(PLAN_PATHS)(
    "reads at most 500 Item rows in $name",
    async ({
      request,
      libraries,
      reads,
      annotation,
      attachment,
      relation,
      parentCandidates,
    }) => {
      const { events, exit } = await run(request, {
        libraries,
        annotation,
        attachment,
        relation,
      });
      expect(Exit.isSuccess(exit)).toBe(true);

      for (const reader of [
        "scan-page",
        "universe-rows",
        "hydrate-chunk",
        "candidate-set",
        "attachment-scan-page",
        "attachment-universe-rows",
        "attachment-details",
        "attachment-tags",
        "annotation-scan-page",
        "annotation-universe-rows",
        "annotation-details",
        "annotation-tags",
        "annotation-attachment-titles",
        "attachment-candidate-set",
        "annotation-candidate-set",
      ]) {
        if (parentCandidates && reader.endsWith("candidate-set")) continue;
        expect(itemsRead(events, reader), reader).toEqual(reads[reader] ?? []);
      }
      if (parentCandidates) {
        // Parent Record candidates now page through the relation reader. Keep
        // the same expansion count and check the bounds of every intermediate read.
        const reader = attachment
          ? "attachment-candidate-set"
          : "annotation-candidate-set";
        expect(
          itemsRead(events, "relation-candidate-set").reduce(
            (a, b) => a + b,
            0,
          ),
        ).toBe(reads[reader]!.reduce((a, b) => a + b, 0));
        for (const reader of [
          "candidate-set",
          "attachment-candidate-set",
          "relation-candidate-set",
        ])
          expect(Math.max(0, ...itemsRead(events, reader))).toBeLessThanOrEqual(
            500,
          );
      }
      // A candidate statement reads Item IDs only, the cap plus one at most.
      for (const reader of [
        "scan-page",
        "universe-rows",
        "hydrate-chunk",
        "attachment-scan-page",
        "attachment-universe-rows",
        "attachment-details",
        "attachment-tags",
        "annotation-scan-page",
        "annotation-universe-rows",
        "annotation-details",
        "annotation-tags",
        "annotation-attachment-titles",
      ]) {
        expect(Math.max(0, ...itemsRead(events, reader))).toBeLessThanOrEqual(
          500,
        );
      }
      expect(
        Math.max(
          0,
          ...itemsRead(
            events,
            attachment
              ? "attachment-candidate-set"
              : annotation
                ? "annotation-candidate-set"
                : "candidate-set",
          ),
        ),
      ).toBeLessThanOrEqual(BULK_CAP + 1);
    },
  );
});

describe("the pauses between two chunks", () => {
  it.each(PLAN_PATHS)(
    "pauses between every two statements of $name",
    async ({ request, libraries, annotation, attachment, relation }) => {
      const { events } = await run(request, {
        libraries,
        annotation,
        attachment,
        relation,
      });

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
    expect(result.rows!.map((row) => row.values.title)).toEqual([
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
      new Set(result.rows!.map((row) => row.values.title)),
    );
    expect(hydrated).toHaveLength(10);
  });

  it("hydrates the returned rows of two Libraries only", async () => {
    const libraries = [SCENARIO_LIBRARIES.personal, BULK_LIBRARY];
    const limited = await run(
      { fields: ["title"], sort: byTitle, limit: 4 },
      { libraries },
    );

    const result = resultOf(limited);
    expect(result).toMatchObject({ returnedCount: 4, truncated: true });
    // Two personal titles come before the bulk titles.
    expect(result.rows!.map((row) => row.values.title)).toEqual([
      "A Chapter on Sampling",
      "Alias Conflict",
      "Bulk item 00000",
      "Bulk item 00001",
    ]);
    // The sort hydrates every Item; the last statement is the projection.
    const projected = limited.events
      .flatMap((event) =>
        event.type === "statement" && event.statement.reader === "hydrate-chunk"
          ? [event.statement.rows as { value: string }[]]
          : [],
      )
      .at(-1)!;
    expect(new Set(projected.map((row) => row.value))).toEqual(
      new Set(result.rows!.map((row) => row.values.title)),
    );
    expect(projected).toHaveLength(4);
  });
});

describe("a cancel request", () => {
  const { personal, group } = SCENARIO_LIBRARIES;
  /** Small chunks: many statements and pauses on the scenario Library. */
  const tuning = {
    capRatio: 1,
    scanPageSize: 3,
    hydrateChunkSize: 2,
    mergeStepSize: 2,
  };
  const QUERIES: readonly {
    name: string;
    request: Request;
    /** The plan reads a candidate set in place of the Library scan. */
    candidates: boolean;
    /** @default the personal Library */
    libraries?: ItemQueryRequest["libraries"];
  }[] = [
    {
      name: "a limited scan",
      candidates: false,
      request: { fields: ["title", "creators"], sort: byTitle, limit: 4 },
    },
    {
      name: "an unlimited scan with a merge",
      candidates: false,
      request: { fields: ["title"], sort: byTitle, limit: null },
    },
    {
      name: "candidate sets",
      candidates: true,
      request: {
        // Each branch lowers to a candidate set.
        filter:
          'tags.contains("methods") || collections.contains("Thesis/Methods")',
        fields: ["title", "tags"],
        sort: byTitle,
        limit: null,
      },
    },
    {
      name: "a limited scan of two Libraries",
      candidates: false,
      libraries: [personal, group],
      request: { fields: ["title", "creators"], sort: byTitle, limit: 4 },
    },
    {
      name: "candidate sets of two Libraries",
      candidates: true,
      libraries: [personal, group],
      request: {
        // `to-read` and `Methods` are in both Libraries.
        filter: 'tags.contains("to-read") || collections.contains("Methods")',
        fields: ["title", "tags"],
        sort: byTitle,
        limit: null,
      },
    },
  ];

  /** Each pause batch has the standard per-test budget. */
  const PAUSE_CANCEL_TIMEOUT_MS = 5_000;

  /** Run the query and cancel it at the event at `index`. */
  async function cancelAt(
    { request, libraries = [personal] }: (typeof QUERIES)[number],
    index: number,
    cancel: (controller: AbortController) => void,
  ) {
    const controller = new AbortController();
    let seen = 0;
    const cancelled = await run(request, {
      libraries,
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
    async (query) => {
      const { request, candidates, libraries = [personal] } = query;
      const complete = await run(request, { libraries, tuning });
      resultOf(complete);
      expect(itemsRead(complete.events, "candidate-set").length > 0).toBe(
        candidates,
      );
      const statements = complete.events.flatMap((event, index) =>
        event.type === "statement" ? [index] : [],
      );
      expect(statements.length).toBeGreaterThan(8);

      for (const index of statements) {
        const { exit, after } = await cancelAt(query, index, (controller) =>
          controller.abort(),
        );

        expect(
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
        ).toBe(true);
        expect(after.filter((event) => event.type === "statement")).toEqual([]);
      }
    },
  );

  describe.each(QUERIES)("cancellation in a pause of $name", (query) => {
    let pauses: number[];

    beforeAll(async () => {
      const { request, libraries = [personal] } = query;
      const complete = await run(request, { libraries, tuning });
      pauses = complete.events.flatMap((event, index) =>
        event.type === "pause" ? [index] : [],
      );
      expect(pauses.length).toBeGreaterThan(20);
    });

    // Every pause is tested once. Separate budgets bound the quadratic sweep
    // of real MessageChannel tasks without changing the cancellation points.
    it.each([0, 1, 2, 3, 4, 5, 6, 7])(
      "starts no statement after a cancel request in pause batch %i",
      async (batch) => {
        for (const index of pauses.filter((_, i) => i % 8 === batch)) {
          // The microtask runs when the slice has ended and the fiber waits.
          const { exit, after } = await cancelAt(query, index, (controller) =>
            queueMicrotask(() => controller.abort()),
          );

          expect(
            Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
          ).toBe(true);
          // The interrupted fiber can take one more pause before it settles.
          expect(after.filter((event) => event.type === "statement")).toEqual(
            [],
          );
          expect(after.length).toBeLessThanOrEqual(1);
        }
      },
      PAUSE_CANCEL_TIMEOUT_MS,
    );
  });
});

// Annotation projection reads follow the full scan/filter pass. The final
// details statement must contain exactly the rows returned to the caller.
describe("Annotation projection and active cancellation", () => {
  const paths = PLAN_PATHS.filter((path) => path.annotation);
  it("returns every Annotation candidate across a full universe chunk", async () => {
    const request: Request = {
      filter: 'type == "image"',
      fields: ["text"],
      limit: null,
    };
    const candidates = resultOf(await run(request, { annotation: true }));
    expect(candidates).toMatchObject({ returnedCount: 520, truncated: false });
    const scan = resultOf(
      await run(request, { annotation: true, tuning: { forceScan: true } }),
    );
    expect(candidates).toEqual(scan);
  });
  it.each(paths)(
    "projects only the returned rows in $name",
    async ({ request, result: expected }) => {
      const complete = await run(request, { annotation: true });
      const result = resultOf(complete);
      expect(result).toMatchObject(
        expected ?? { returnedCount: 10, truncated: true },
      );
      const details = complete.events
        .flatMap((event) =>
          event.type === "statement" &&
          event.statement.reader === "annotation-details" &&
          event.statement.rows.some((row) => "text" in (row as object))
            ? [event.statement.rows as { text: string }[]]
            : [],
        )
        .at(-1)!;
      expect(details).toHaveLength(result.returnedCount);
      expect(details.map((row) => row.text)).toEqual(
        result.rows!.map((row) => row.values.text),
      );
    },
  );

  describe.each(paths)("active cancellation in $name", ({ request }) => {
    const options = { annotation: true };
    let checkpoints: Map<string, number>;

    beforeAll(async () => {
      const complete = await run(request, options);
      resultOf(complete);
      checkpoints = new Map<string, number>();
      for (const [index, event] of complete.events.entries()) {
        if (
          event.type === "statement" &&
          event.statement.reader.startsWith("annotation-")
        ) {
          const first = `${event.statement.reader}-first`;
          if (!checkpoints.has(first)) checkpoints.set(first, index);
          checkpoints.set(event.statement.reader, index);
          const pause = complete.events.findIndex(
            (next, nextIndex) => nextIndex > index && next.type === "pause",
          );
          if (pause !== -1)
            checkpoints.set(`${event.statement.reader}-pause`, pause);
        }
      }
      expect(checkpoints.has("annotation-details")).toBe(true);
    });

    it.each(["first", "last", "pause"])(
      "starts no statement after cancellation at each reader's %s checkpoint",
      async (checkpoint) => {
        for (const [name, index] of checkpoints) {
          const role = name.endsWith("-first")
            ? "first"
            : name.endsWith("-pause")
              ? "pause"
              : "last";
          if (role !== checkpoint) continue;
          const controller = new AbortController();
          let seen = 0;
          const cancelled = await run(request, {
            ...options,
            signal: controller.signal,
            onEvent: (event) => {
              if (seen++ === index) {
                if (event.type === "pause")
                  queueMicrotask(() => controller.abort());
                else controller.abort();
              }
            },
          });
          expect(
            Exit.isFailure(cancelled.exit) &&
              Cause.hasInterruptsOnly(cancelled.exit.cause),
          ).toBe(true);
          expect(
            cancelled.events
              .slice(index + 1)
              .filter((event) => event.type === "statement"),
          ).toEqual([]);
        }
      },
    );
  });
});

describe("Attachment active cancellation", () => {
  describe.each(PLAN_PATHS.filter((path) => path.attachment))(
    "active cancellation in $name",
    ({ request, relation }) => {
      const options = { relation, attachment: true };
      let checkpoints: Map<string, number>;

      beforeAll(async () => {
        const complete = await run(request, options);
        resultOf(complete);
        checkpoints = new Map<string, number>();
        for (const [index, event] of complete.events.entries()) {
          if (
            event.type === "statement" &&
            (relation || event.statement.reader.startsWith("attachment-"))
          ) {
            const first = `${event.statement.reader}-first`;
            if (!checkpoints.has(first)) checkpoints.set(first, index);
            checkpoints.set(event.statement.reader, index);
            const pause = complete.events.findIndex(
              (next, nextIndex) => nextIndex > index && next.type === "pause",
            );
            if (pause !== -1)
              checkpoints.set(`${event.statement.reader}-pause`, pause);
          }
        }
        expect(
          checkpoints.has(
            relation ? "relation-candidate-set" : "attachment-details",
          ),
        ).toBe(true);
      });

      it.each(["first", "last", "pause"])(
        "starts no statement after cancellation at each reader's %s checkpoint",
        async (checkpoint) => {
          for (const [name, index] of checkpoints) {
            const role = name.endsWith("-first")
              ? "first"
              : name.endsWith("-pause")
                ? "pause"
                : "last";
            if (role !== checkpoint) continue;
            const controller = new AbortController();
            let seen = 0;
            const cancelled = await run(request, {
              ...options,
              signal: controller.signal,
              onEvent: (event) => {
                if (seen++ === index) {
                  if (event.type === "pause")
                    queueMicrotask(() => controller.abort());
                  else controller.abort();
                }
              },
            });
            expect(
              Exit.isFailure(cancelled.exit) &&
                Cause.hasInterruptsOnly(cancelled.exit.cause),
            ).toBe(true);
            expect(
              cancelled.events
                .slice(index + 1)
                .filter((event) => event.type === "statement"),
            ).toEqual([]);
          }
        },
      );
    },
  );
});

it.each([
  {
    dataset: ITEMS,
    field: "attachments",
    reader: "item-attachments",
    chunks: 5,
  },
  {
    dataset: ITEMS,
    field: "annotations",
    reader: "item-annotations",
    chunks: 5,
  },
  {
    dataset: ATTACHMENTS,
    field: "annotations",
    reader: "attachment-annotations",
    chunks: 2,
  },
] as const)(
  "loads only the named Relation List on $dataset.id: $field",
  async ({ dataset, field, reader, chunks }) => {
    using source = openScenarioDatabase({ annotations: true });
    const request = {
      libraries: [SCENARIO_LIBRARIES.personal],
      fields: [],
      sort: [],
    };
    const tuning = { scanPageSize: 4, hydrateChunkSize: 2 };
    const bare = await runEffect(collectQuery(dataset, request), {
      client: source.db,
      tuning,
    });
    expect(bare.exit._tag).toBe("Success");
    const named = await runEffect(
      collectQuery(dataset, { ...request, filter: `${field}.length >= 0` }),
      { client: source.db, tuning },
    );
    expect(named.exit._tag).toBe("Success");
    const relationReaders = new Set([
      "item-attachments",
      "item-annotations",
      "attachment-annotations",
    ]);
    const reads = (events: readonly RunEvent[]) =>
      events.flatMap((event) =>
        event.type === "statement" &&
        relationReaders.has(event.statement.reader)
          ? [event.statement.reader]
          : [],
      );
    expect(reads(bare.events)).toEqual([]);
    expect(reads(named.events)).toEqual(
      Array.from({ length: chunks }, () => reader),
    );
    expect(
      named.events.flatMap((event) =>
        event.type === "statement" &&
        [
          "attachment-details",
          "annotation-details",
          "annotation-tags",
        ].includes(event.statement.reader)
          ? [event.statement.reader]
          : [],
      ),
    ).toEqual([]);
  },
);

it("reads a mark's sibling list once even when its paper has several hydrate chunks of marks", async () => {
  const { exit, events } = await runEffect(
    collectQuery(ITEMS, {
      libraries: [BULK_LIBRARY],
      filter:
        "annotations.filter(value.attachment.annotations.filter(value.text).length > 0).length > 0",
      fields: [],
      limit: 1,
    }),
    { client: annotations.db },
  );
  expect(exit._tag).toBe("Success");
  expect(
    events.filter(
      (event) =>
        event.type === "statement" &&
        event.statement.reader === "attachment-annotations",
    ),
  ).toHaveLength(1);
  expect(
    events.filter(
      (event) =>
        event.type === "statement" &&
        event.statement.reader === "annotation-details",
    ),
  ).toHaveLength(11);
}, 30000);

describe("Relation List candidate bounds", () => {
  // Failure modes: one parent materializes all of its children, the parent cap
  // truncates a valid result, or the reader continues after cap fallback.
  it.each([0, 1])(
    "bounds matching child pages before the distinct-parent cap (ratio %s)",
    async (capRatio) => {
      const query = collectQuery(ITEMS, {
        libraries: [BULK_LIBRARY],
        filter: 'annotations.filter(value.type == "highlight").length > 0',
        fields: [],
        limit: 1,
      });
      const actual = await runEffect(query, {
        client: annotations.db,
        tuning: { capRatio },
      });
      const scan = await runEffect(query, {
        client: annotations.db,
        tuning: { forceScan: true },
      });
      expect(resultOf(actual)).toEqual(resultOf(scan));
      expect(resultOf(actual).returnedCount).toBe(1);
      const pages = itemsRead(actual.events, "annotation-candidate-set");
      expect(pages.length).toBeGreaterThan(0);
      expect(pages.every((size) => size <= 500)).toBe(true);
      expect(pages.reduce((sum, count) => sum + count, 0)).toBe(
        capRatio === 0 ? 500 : 2080,
      );
      expect(itemsRead(actual.events, "scan-page").length > 0).toBe(
        capRatio === 0,
      );
    },
  );
  it.each([
    [ITEMS, 'annotations.filter(value.tags.contains("method")).length > 0'],
    [
      ATTACHMENTS,
      '!annotations.filter(value.tags.contains("method")).isEmpty()',
    ],
    [
      ITEMS,
      'attachments.filter(value.annotations.filter(value.tags.contains("method")).length >= 1).length > 0',
    ],
  ] as const)(
    "starts no statement after cancellation in %s %s",
    async (dataset, filter) => {
      using source = openScenarioDatabase({ annotations: true });
      const query = collectQuery(dataset, {
        libraries: [SCENARIO_LIBRARIES.personal],
        filter,
        fields: [],
        limit: 1,
      });
      const options = {
        client: source.db,
        tuning: { capRatio: 1, hydrateChunkSize: 2 },
      };
      // Keep layout checks outside cancellation event indices.
      resultOf(await runEffect(query, options));
      const complete = await runEffect(query, options);
      expect(
        itemsRead(complete.events, "relation-candidate-set").length,
      ).toBeGreaterThan(0);
      for (const [index, event] of complete.events.entries()) {
        const controller = new AbortController();
        let seen = 0;
        const cancelled = await runEffect(query, {
          ...options,
          signal: controller.signal,
          onEvent: () => {
            if (seen++ !== index) return;
            if (event.type === "pause")
              queueMicrotask(() => controller.abort());
            else controller.abort();
          },
        });
        expect(
          Exit.isFailure(cancelled.exit) &&
            Cause.hasInterruptsOnly(cancelled.exit.cause),
        ).toBe(true);
        expect(
          cancelled.events
            .slice(index + 1)
            .filter((event) => event.type === "statement"),
        ).toEqual([]);
      }
    },
  );

  it("caps distinct parents after mapping more than one chunk of matching marks", async () => {
    const query = collectQuery(ITEMS, {
      libraries: [BULK_LIBRARY],
      filter:
        'attachments.filter(value.annotations.filter(value.type == "highlight").length > 0).length > 0',
      fields: [],
      limit: 10,
    });
    const actual = await runEffect(query, { client: annotations.db });
    const scan = await runEffect(query, {
      client: annotations.db,
      tuning: { forceScan: true },
    });
    expect(resultOf(actual)).toEqual(resultOf(scan));
    expect(resultOf(actual).returnedCount).toBe(1);
    expect(itemsRead(actual.events, "scan-page")).toEqual([]);
    expect(itemsRead(actual.events, "universe-rows")).toEqual([1]);
    expect(itemsRead(actual.events, "relation-candidate-set")).toEqual([
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    ]);
    expect(itemsRead(actual.events, "annotation-candidate-set")).toEqual([
      500, 500, 500, 500, 80,
    ]);
  });

  it("falls back when distinct parent candidates exceed the cap", async () => {
    const request = {
      filter:
        'attachments.filter(value.contentType == "application/pdf").length > 0',
      fields: [],
      limit: 10,
    };
    const actual = await run(request, { attachment: true, relation: true });
    const scan = await run(request, {
      attachment: true,
      relation: true,
      tuning: { forceScan: true },
    });
    expect(resultOf(actual)).toEqual(resultOf(scan));
    expect(itemsRead(actual.events, "scan-page")).toEqual([
      500, 500, 500, 500, 500, 100,
    ]);
    expect(itemsRead(actual.events, "universe-rows")).toEqual([]);
  });

  it("needs no relation hydration when the candidate set proves the filter empty", async () => {
    const actual = await run(
      {
        filter: 'attachments.filter(value.key == "MISSING2").length > 0',
        fields: [],
        limit: 10,
      },
      { attachment: true, relation: true },
    );
    expect(resultOf(actual).returnedCount).toBe(0);
    for (const reader of [
      "scan-page",
      "universe-rows",
      "item-attachments",
      "item-annotations",
      "attachment-annotations",
      "attachment-details",
      "annotation-details",
    ])
      expect(itemsRead(actual.events, reader), reader).toEqual([]);
    expect(itemsRead(actual.events, "attachment-candidate-set")).toEqual([0]);
  });
});

it("reads fewer Attachment rows for a selective Parent Record Tag across candidate pages", async () => {
  const request = {
    fields: [],
    filter: `item.tags.contains("${BULK_FIFTH_TAG}")`,
  };
  const actual = await run(request, { attachment: true });
  const scan = await run(request, {
    attachment: true,
    tuning: { forceScan: true },
  });
  expect(resultOf(actual)).toEqual(resultOf(scan));
  expect(resultOf(actual).returnedCount).toBe(520);
  expect(itemsRead(actual.events, "attachment-scan-page")).toEqual([]);
  expect(
    itemsRead(actual.events, "attachment-universe-rows").reduce(
      (a, b) => a + b,
      0,
    ),
  ).toBeLessThan(
    itemsRead(scan.events, "attachment-scan-page").reduce((a, b) => a + b, 0),
  );
});

it("reads fewer Annotation rows through a selective nested Parent Record Collection", async () => {
  using source = openScenarioDatabase({ annotations: true });
  seedBulkLibrary(source.sqlite, BULK_ITEMS);
  seedBulkAnnotations(source.sqlite, BULK_ITEMS);
  // Add the bulk records to the personal Library so its candidate cap includes them.
  source.sqlite
    .prepare("update items set libraryID = ? where libraryID = ?")
    .run(SCENARIO_LIBRARIES.personal.libraryID, BULK_LIBRARY.libraryID);
  const query = collectQuery(ANNOTATIONS, {
    libraries: [SCENARIO_LIBRARIES.personal],
    fields: [],
    filter: 'attachment.item.collections.within("Thesis")',
  });
  const actual = await runEffect(query, { client: source.db });
  const scan = await runEffect(query, {
    client: source.db,
    tuning: { forceScan: true },
  });
  expect(resultOf(actual)).toEqual(resultOf(scan));
  expect(resultOf(actual).returnedCount).toBe(12);
  expect(itemsRead(actual.events, "annotation-scan-page")).toEqual([]);
  expect(
    itemsRead(actual.events, "annotation-universe-rows").reduce(
      (a, b) => a + b,
      0,
    ),
  ).toBeLessThan(
    itemsRead(scan.events, "annotation-scan-page").reduce((a, b) => a + b, 0),
  );
});

it("pages reversed Parent Records through the cap before using the Annotation scan", async () => {
  const request = { fields: [], filter: 'attachment.item.key == "BLK22222"' };
  const actual = await run(request, { annotation: true });
  const scan = await run(request, {
    annotation: true,
    tuning: { forceScan: true },
  });
  expect(resultOf(actual)).toEqual(resultOf(scan));
  expect(resultOf(actual).returnedCount).toBe(BULK_ITEMS);
  expect(itemsRead(actual.events, "relation-candidate-set")).toEqual([
    1, 500, 151,
  ]);
  expect(
    itemsRead(actual.events, "annotation-scan-page").length,
  ).toBeGreaterThan(0);
});
