// Failure mode: a worker slice can cross several Annotation pages after its budget.
import { expect, it } from "vitest";

import {
  BULK_LIBRARY,
  openScenarioDatabase,
  seedBulkAnnotations,
  seedBulkLibrary,
} from "@zotlit/db/test-scenario";

import { ANNOTATIONS, collectQuery, ITEMS } from ".";
import { ItemQueryScheduler } from "./scheduler";
import { runEffect } from "./test-helpers";

it.each([ITEMS, ANNOTATIONS])(
  "checks the slice budget between $id scan statements",
  async (dataset) => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, 3_000);
    seedBulkAnnotations(scenario.sqlite, 3_000);
    let clock = 0;
    let start = 0;
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
            clock +=
              event.statement.reader === "annotation-scan-page"
                ? event.statement.rows.length < 500
                  ? 10
                  : 1
                : 0.05;
          } else {
            slices.push(clock - start);
            start = clock;
          }
        },
      },
    );
    slices.push(clock - start);
    expect(actual.exit._tag).toBe("Success");
    expect(Math.max(...slices)).toBeLessThanOrEqual(16);
  },
);
