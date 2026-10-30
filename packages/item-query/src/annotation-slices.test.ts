// Failure mode: a worker slice can cross several scan pages after its budget.
import { expect, it } from "vitest";

import {
  BULK_LIBRARY,
  openScenarioDatabase,
  seedBulkAnnotations,
  seedBulkLibrary,
} from "@zotlit/db/test-scenario";

import { ANNOTATIONS, collectQuery, ITEMS } from ".";
import { ItemQueryScheduler, SLICE_BUDGET_MS } from "./scheduler";
import { runEffect } from "./test-helpers";

/** The cost of one scan page; each other statement costs `OTHER_MS`. */
const PAGE_MS = 10;
const OTHER_MS = 0.05;

it.each([
  { dataset: ITEMS, reader: "scan-page" },
  { dataset: ANNOTATIONS, reader: "annotation-scan-page" },
])(
  "checks the slice budget between $reader statements",
  async ({ dataset, reader }) => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, 3_000);
    seedBulkAnnotations(scenario.sqlite, 3_000);
    let clock = 0;
    let start = 0;
    let pages = 0;
    const slices: number[] = [];
    const actual = await runEffect(
      collectQuery(dataset, {
        libraries: [BULK_LIBRARY],
        fields: [],
        sort: [],
        ...(dataset === ANNOTATIONS ? { group: "item.citationKey" } : {}),
      }),
      {
        client: scenario.db,
        scheduler: new ItemQueryScheduler({ now: () => clock }),
        onEvent: (event) => {
          if (event.type === "statement") {
            if (event.statement.reader === reader) pages += 1;
            clock += event.statement.reader === reader ? PAGE_MS : OTHER_MS;
          } else {
            slices.push(clock - start);
            start = clock;
          }
        },
      },
    );
    slices.push(clock - start);
    expect(actual.exit._tag).toBe("Success");
    // Two pages in one slice cost more than the budget and one page together.
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(actual.pauses).toBeGreaterThan(0);
    expect(Math.max(...slices)).toBeLessThan(SLICE_BUDGET_MS + PAGE_MS);
  },
);
