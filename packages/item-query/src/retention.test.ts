// The rows a limited query retains, counted with V8's collector: a `WeakRef`
// on each row that a statement returns, and a forced collection at each
// statement. No test reads wall time.
//
// This file runs without V8's optimizing compilers. A compilation job holds the
// closure it compiles until the job ends, and the closure of a page or a chunk
// holds its rows, so with the compilers on a finished page can stay in memory
// for the time of one job. That time depends on the load of the machine; it is
// not a reference of the engine.
import { Effect, Exit } from "effect";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BULK_FIFTH_TAG,
  BULK_LIBRARY,
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
  seedBulkLibrary,
  seedBulkAttachments,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { ATTACHMENTS, collectQuery, consumeQuery, ITEMS } from ".";
import type { ItemQueryRequest } from ".";
import { runEffect } from "./test-helpers";

setFlagsFromString("--no-opt");
setFlagsFromString("--no-maglev");
setFlagsFromString("--expose-gc");
const collectGarbage = runInNewContext("gc") as () => void;

/** The bulk Library: 2,600 top-level Items, 520 of them with `BULK_FIFTH_TAG`. */
const BULK_ITEMS = 2600;

let scenario: ScenarioDatabase;
let attachments: ScenarioDatabase;

beforeAll(() => {
  scenario = openScenarioDatabase();
  seedBulkLibrary(scenario.sqlite, BULK_ITEMS);
  attachments = openScenarioDatabase();
  seedBulkLibrary(attachments.sqlite, BULK_ITEMS);
  seedBulkAttachments(attachments.sqlite, BULK_ITEMS);
});

afterAll(() => {
  scenario.close();
  attachments.close();
});

/** A request of the bulk Library, or of the Libraries it names. */
type Request = Omit<ItemQueryRequest, "libraries"> &
  Partial<Pick<ItemQueryRequest, "libraries">>;

const byTitle = [{ field: "title", direction: "asc" }] as const;

/** The readers whose rows are the rows of the query universe. */
const READS_UNIVERSE = new Set([
  "scan-page",
  "universe-rows",
  "attachment-scan-page",
  "attachment-universe-rows",
]);

describe("the rows a limited query retains", () => {
  const LIMIT = 10;
  const QUERIES: readonly {
    name: string;
    request: Request;
    items: number;
    attachment?: boolean;
    relation?: boolean;
    groups?: number;
  }[] = [
    {
      name: "a selective Relation List candidate set",
      attachment: true,
      relation: true,
      request: {
        filter:
          'attachments.filter(value.contentType == "text/html").length >= 1',
        fields: ["title"],
        limit: LIMIT,
      },
      items: 520,
    },
    {
      name: "a grouped scan of two Libraries",
      request: {
        libraries: [SCENARIO_LIBRARIES.personal, BULK_LIBRARY],
        fields: ["title"],
        group: "library",
        limit: LIMIT,
      },
      items: 10 + BULK_ITEMS,
      groups: 2,
    },
    {
      name: "an Attachment scan",
      attachment: true,
      request: { fields: ["title"], limit: LIMIT },
      items: BULK_ITEMS,
    },
    {
      name: "an Attachment candidate set",
      attachment: true,
      request: {
        filter: 'contentType == "text/html"',
        fields: ["title"],
        limit: LIMIT,
      },
      items: 520,
    },
    ...[
      'tags.contains("bulk-fifth")',
      'linkMode == "linked_url"',
      'item.collections.contains("Bulk collection")',
    ].map((filter) => ({
      name: `an Attachment candidate for ${filter}`,
      attachment: true,
      request: { filter, fields: ["title"], limit: LIMIT },
      items: 520,
    })),
    ...[
      'indexedKey == "ATT22222g2718"',
      '["ATT22222g2718"].contains(indexedKey)',
      'item.indexedKey == "BLK22222g2718"',
      '["BLK22222g2718"].contains(item.indexedKey)',
    ].map((filter) => ({
      name: `an Attachment Indexed Key candidate for ${filter}`,
      attachment: true,
      request: { filter, fields: ["title"], limit: LIMIT },
      items: 1,
    })),
    {
      name: "an Attachment key candidate",
      attachment: true,
      request: { filter: 'key == "ATT22222"', fields: ["title"], limit: LIMIT },
      items: 1,
    },
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
    {
      name: "a scan of two Libraries",
      // Each of the first rows by title has a title.
      request: {
        libraries: [SCENARIO_LIBRARIES.personal, BULK_LIBRARY],
        fields: ["title"],
        sort: byTitle,
        limit: LIMIT,
      },
      items: 10 + BULK_ITEMS,
    },
  ];

  it.each(QUERIES)(
    "holds the limit plus one row, one page, and one hydrate chunk at most in $name",
    async ({ request, items, attachment, relation, groups = 1 }) => {
      // The rows of the query universe and the rows of the hydrate statements
      // that the collector has not freed.
      const scanned: WeakRef<object>[] = [];
      const hydrated: WeakRef<{ itemID: number }>[] = [];
      const samples: { at: string; rows: number; hydratedItems: number }[] = [];

      const limited = await runEffect(
        collectQuery(relation ? ITEMS : attachment ? ATTACHMENTS : ITEMS, {
          libraries: [BULK_LIBRARY],
          ...request,
        }),
        {
          client: attachment ? attachments.db : scenario.db,
          keepStatements: false,
          onEvent: (event) => {
            if (event.type !== "statement") return;
            // Free what the engine has released, then count what it holds with
            // the rows of this statement. The first collection can end a marking
            // cycle that began earlier and keeps what was live at its start.
            collectGarbage();
            collectGarbage();
            const { reader, rows } = event.statement;
            const kept =
              reader === "hydrate-chunk" || reader === "attachment-details"
                ? hydrated
                : scanned;
            if (
              reader === "hydrate-chunk" ||
              reader === "attachment-details" ||
              READS_UNIVERSE.has(reader)
            ) {
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
        },
      );

      if (!Exit.isSuccess(limited.exit))
        throw new Error(String(limited.exit.cause));
      expect(limited.exit.value).toMatchObject({
        returnedCount: Math.min(LIMIT * groups, items),
        truncated: items > LIMIT * groups,
      });
      expect(scanned).toHaveLength(items);
      const most = (values: number[]) => Math.max(0, ...values);
      // The collector sees the rows: one page is in memory while it is read.
      expect(most(samples.map((entry) => entry.rows))).toBeGreaterThanOrEqual(
        Math.min(items, 500),
      );
      expect(most(samples.map((entry) => entry.rows))).toBeLessThanOrEqual(
        (LIMIT + 1) * groups + 500,
      );
      expect(
        most(samples.map((entry) => entry.hydratedItems)),
      ).toBeLessThanOrEqual(250);
      // The projection starts with the matches only: the pages are released.
      expect(samples.at(-1)).toEqual({
        at: attachment && !relation ? "attachment-details" : "hydrate-chunk",
        rows: groups === 1 ? Math.min(LIMIT + 1, items) : LIMIT * groups + 1,
        hydratedItems: groups === 1 ? Math.min(LIMIT, items) : 9,
      });
    },
  );
});

it.each([undefined, "library"])(
  "incremental delivery retains one projected batch (group: %s)",
  async (group) => {
    const projected: WeakRef<object>[] = [];
    let peak = 0;
    const run = await runEffect(
      consumeQuery(
        ITEMS,
        {
          libraries: [BULK_LIBRARY],
          fields: ["title", "tags"],
          group,
          limit: null,
        },
        (summary) =>
          Effect.succeed({
            write: (rows) =>
              Effect.sync(() => {
                collectGarbage();
                collectGarbage();
                for (const row of rows) projected.push(new WeakRef(row));
                peak = Math.max(
                  peak,
                  projected.filter((row) => row.deref()).length,
                );
              }),
            end: () => Effect.succeed(summary),
          }),
      ),
      {
        client: scenario.db,
        keepStatements: false,
        tuning: { hydrateChunkSize: 100 },
      },
    );
    expect(Exit.isSuccess(run.exit) && run.exit.value.returnedCount).toBe(
      BULK_ITEMS,
    );
    expect(projected).toHaveLength(BULK_ITEMS);
    expect(peak).toBeLessThanOrEqual(100);
  },
);

it("releases a paper's file records with each chunk of a limited query", async () => {
  const related: WeakRef<object>[] = [];
  let peak = 0;
  const run = await runEffect(
    collectQuery(ITEMS, {
      libraries: [BULK_LIBRARY],
      filter:
        'attachments.filter(value.contentType == "application/pdf").length > 0',
      fields: [],
      limit: 10,
    }),
    {
      client: attachments.db,
      keepStatements: false,
      onEvent: (event) => {
        if (event.type !== "statement") return;
        collectGarbage();
        collectGarbage();
        if (event.statement.reader === "item-attachments") {
          for (const row of event.statement.rows)
            related.push(new WeakRef(row as object));
        }
        peak = Math.max(peak, related.filter((row) => row.deref()).length);
      },
    },
  );
  expect(run.exit._tag).toBe("Success");
  expect(related).toHaveLength(BULK_ITEMS);
  expect(peak).toBe(250);
  await new Promise<void>((resolve) => setImmediate(resolve));
  collectGarbage();
  collectGarbage();
  expect(related.filter((row) => row.deref())).toEqual([]);
});

it("keeps the limit plus one row per group when papers fan out to many Tag groups", async () => {
  // Each bulk paper has the Tags "bulk" and "bulk-fifth" of the seed, and two
  // of 300 Tags: paper i has t<i % 300> and t<(i + 1) % 300>.
  const TAGS = 300;
  using source = openScenarioDatabase();
  seedBulkLibrary(source.sqlite, BULK_ITEMS);
  const itemIDs = source.sqlite
    .prepare("select itemID from items where libraryID = ? order by itemID")
    .all(BULK_LIBRARY.libraryID)
    .map((row) => Number(row.itemID));
  expect(itemIDs).toHaveLength(BULK_ITEMS);
  source.sqlite.exec("begin");
  const tagIDs = Array.from({ length: TAGS }, (_, index) =>
    Number(
      source.sqlite
        .prepare("insert into tags (name) values (?)")
        .run(`t${String(index).padStart(3, "0")}`).lastInsertRowid,
    ),
  );
  const tag = source.sqlite.prepare(
    "insert into itemTags (itemID, tagID, type) values (?, ?, 0)",
  );
  for (const [index, itemID] of itemIDs.entries()) {
    tag.run(itemID, tagIDs[index % TAGS]!);
    tag.run(itemID, tagIDs[(index + 1) % TAGS]!);
  }
  source.sqlite.exec("commit");

  const LIMIT = 1;
  const GROUPS = TAGS + 2;
  const scanned: WeakRef<object>[] = [];
  let retained = 0;
  const run = await runEffect(
    consumeQuery(
      ITEMS,
      {
        libraries: [BULK_LIBRARY],
        group: "tags[].name",
        fields: [],
        limit: LIMIT,
      },
      // Begin runs once after the scan pass, before the projection pass.
      (summary) =>
        Effect.sync(() => {
          collectGarbage();
          collectGarbage();
          retained = scanned.filter((row) => row.deref()).length;
          return {
            write: () => Effect.void,
            end: () => Effect.succeed(summary),
          };
        }),
    ),
    {
      client: source.db,
      keepStatements: false,
      onEvent: (event) => {
        if (event.type !== "statement") return;
        const { reader, rows } = event.statement;
        if (READS_UNIVERSE.has(reader))
          for (const row of rows) scanned.push(new WeakRef(row as never));
      },
    },
  );
  if (!Exit.isSuccess(run.exit)) throw new Error(String(run.exit.cause));
  const result = run.exit.value;
  expect(scanned).toHaveLength(BULK_ITEMS);
  // Papers with index i % 300 == r: 9 for r < 200, 8 otherwise (2,600 papers).
  const papers = (residue: number) => (residue < 200 ? 9 : 8);
  expect(result.groups!.map(({ value, count }) => [value, count])).toEqual([
    ["bulk", BULK_ITEMS],
    ["bulk-fifth", 520],
    ...Array.from({ length: TAGS }, (_, index) => [
      `t${String(index).padStart(3, "0")}`,
      papers(index) + papers((index + TAGS - 1) % TAGS),
    ]),
  ]);
  expect(result).toMatchObject({
    totalCount: BULK_ITEMS,
    returnedCount: GROUPS,
    truncated: true,
  });
  expect(retained).toBeGreaterThan(0);
  expect(retained).toBeLessThanOrEqual((LIMIT + 1) * GROUPS);
});
