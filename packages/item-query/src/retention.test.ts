// The rows a limited query retains, counted with V8's collector: a `WeakRef`
// on each row that a statement returns, and a forced collection at each
// statement. No test reads wall time.
//
// This file runs without V8's optimizing compilers. A compilation job holds the
// closure it compiles until the job ends, and the closure of a page or a chunk
// holds its rows, so with the compilers on a finished page can stay in memory
// for the time of one job. That time depends on the load of the machine; it is
// not a reference of the engine.
import { Exit } from "effect";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BULK_FIFTH_TAG,
  BULK_LIBRARY,
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
  seedBulkLibrary,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { queryItems } from ".";
import type { ItemQueryRequest } from ".";
import { runEffect } from "./test-helpers";

setFlagsFromString("--no-opt");
setFlagsFromString("--no-maglev");
setFlagsFromString("--expose-gc");
const collectGarbage = runInNewContext("gc") as () => void;

/** The bulk Library: 2,600 top-level Items, 520 of them with `BULK_FIFTH_TAG`. */
const BULK_ITEMS = 2600;

let scenario: ScenarioDatabase;

beforeAll(() => {
  scenario = openScenarioDatabase();
  seedBulkLibrary(scenario.sqlite, BULK_ITEMS);
});

afterAll(() => {
  scenario.close();
});

/** A request of the bulk Library, or of the Libraries it names. */
type Request = Omit<ItemQueryRequest, "libraries"> &
  Partial<Pick<ItemQueryRequest, "libraries">>;

const byTitle = [{ field: "title", direction: "asc" }] as const;

/** The readers whose rows are the rows of the query universe. */
const READS_UNIVERSE = new Set(["scan-page", "universe-rows"]);

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
    async ({ request, items }) => {
      // The rows of the query universe and the rows of the hydrate statements
      // that the collector has not freed.
      const scanned: WeakRef<object>[] = [];
      const hydrated: WeakRef<{ itemID: number }>[] = [];
      const samples: { at: string; rows: number; hydratedItems: number }[] = [];

      const limited = await runEffect(
        queryItems({ libraries: [BULK_LIBRARY], ...request }),
        {
          client: scenario.db,
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
        },
      );

      if (!Exit.isSuccess(limited.exit))
        throw new Error(String(limited.exit.cause));
      expect(limited.exit.value).toMatchObject({
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
