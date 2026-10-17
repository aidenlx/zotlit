import { Exit } from "effect";
import { expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";

import { collectQuery, ITEMS, ATTACHMENTS, ANNOTATIONS } from ".";
import { runEffect } from "./test-helpers";

it("warns about an unknown Collection path and suggests its exact case", async () => {
  using scenario = openScenarioDatabase();
  const { exit } = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter: 'collections.within("thesis")',
      fields: [],
    }),
    { client: scenario.db },
  );
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
  expect(exit.value.rows).toEqual([]);
  expect(exit.value.warnings).toMatchObject([
    {
      code: "unknown-collection",
      severity: "warning",
      found: "thesis",
    },
  ]);
  expect(exit.value.warnings[0]!.suggestions[0]).toBe("Thesis");
  expect(exit.value.warnings[0]!.hint).toContain(
    "zotlit:query-values kind=collections",
  );
});

it.each([
  [ITEMS, 'collections.contains("thesis")'],
  [ITEMS, '!collections.within("thesis")'],
  [ITEMS, 'true || collections.within("thesis")'],
  [ATTACHMENTS, 'item.collections.within("thesis")'],
  [ANNOTATIONS, 'item.collections.contains("thesis")'],
  [ANNOTATIONS, 'attachment.item.collections.within("thesis")'],
  [
    ITEMS,
    'attachments.filter(value.item.collections.within("thesis")).length > 0',
  ],
  [
    ITEMS,
    'annotations.filter(value.attachment.item.collections.contains("thesis")).length > 0',
  ],
  [
    ATTACHMENTS,
    'annotations.filter(value.item.collections.within("thesis")).length > 0',
  ],
  [ITEMS, 'collections.within("thesis") || collections.contains("thesis")'],
])("warns once for the literal in %s: %s", async (dataset, filter) => {
  using scenario = openScenarioDatabase();
  const { exit } = await runEffect(
    collectQuery(dataset, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter,
      fields: [],
    }),
    { client: scenario.db },
  );
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
  expect(exit.value.warnings).toMatchObject([
    { code: "unknown-collection", found: "thesis" },
  ]);
});

it("suggests paths by the full path and the final segment", async () => {
  using scenario = openScenarioDatabase();
  scenario.sqlite
    .prepare(
      "insert into collections (collectionName, libraryID, key) values (?, ?, ?)",
    )
    .run("Query thesis", SCENARIO_LIBRARIES.personal.libraryID, "QTHESIS2");
  for (const [literal, suggestion] of [
    ["Query/Thesis", "Query thesis"],
    ["Other/Methods", "Thesis/Methods"],
  ]) {
    const { exit } = await runEffect(
      collectQuery(ITEMS, {
        libraries: [SCENARIO_LIBRARIES.personal],
        filter: `collections.within(${JSON.stringify(literal)})`,
        fields: [],
      }),
      { client: scenario.db },
    );
    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(exit.value.warnings[0]!.suggestions).toContain(suggestion);
  }
});

it("lists other Libraries after every near path", async () => {
  using scenario = openScenarioDatabase();
  const { exit } = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter: 'collections.within("Methods")',
      fields: [],
    }),
    { client: scenario.db },
  );
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
  // The live personal paths are Thesis, Thesis/Methods, Teaching, and
  // Teaching/Methods. The two Methods leaves match exactly and rank by whole
  // path distance (7, 9); Thesis (5) is nearer than Teaching (6). The group
  // Library alone holds the path "Methods".
  expect(exit.value.warnings[0]!.suggestions).toEqual([
    "Thesis/Methods",
    "Teaching/Methods",
    "Thesis",
    "library=group:4815",
  ]);
});

it.each([
  [SCENARIO_LIBRARIES.personal],
  [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group],
])(
  "does not warn when a Target Library holds the path: %j",
  async (...libraries) => {
    using scenario = openScenarioDatabase();
    const { exit, events } = await runEffect(
      collectQuery(ITEMS, {
        libraries,
        filter: 'collections.within("Thesis")',
        fields: ["collections"],
      }),
      { client: scenario.db },
    );
    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(exit.value.warnings).toEqual([]);
    expect(
      events.filter(
        (event) =>
          event.type === "statement" &&
          event.statement.reader === "collection-paths",
      ),
    ).toHaveLength(libraries.length);
  },
);

it("accepts a path held only by the second Target Library", async () => {
  using scenario = openScenarioDatabase();
  const { exit } = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group],
      filter: 'collections.contains("Methods")',
      fields: [],
    }),
    { client: scenario.db },
  );
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
  expect(exit.value.warnings).toEqual([]);
  // GRP2BK22 is the one group Item filed in the root Collection "Methods";
  // the personal Methods Collections sit below Thesis and Teaching.
  expect(exit.value.rows!.map((row) => row.indexedKey)).toEqual([
    "GRP2BK22g4815",
  ]);
});

it.each([
  [ANNOTATIONS, 'attachment.item.collections.within("Thesis")'],
  [ANNOTATIONS, 'attachment.item.collections.contains("Thesis")'],
  [ANNOTATIONS, '!attachment.item.collections.within("Thesis")'],
  [ANNOTATIONS, 'true || attachment.item.collections.within("Thesis")'],
  [
    ITEMS,
    'annotations.filter(value.attachment.item.collections.within("Thesis")).length > 0',
  ],
  [
    ATTACHMENTS,
    'annotations.filter(value.attachment.item.collections.contains("Thesis")).length > 0',
  ],
  [
    ITEMS,
    'attachments.filter(value.annotations.filter(value.attachment.item.collections.within("Thesis")).length > 0).length > 0',
  ],
])(
  "reuses Collection paths reached through Annotation Attachments in %s: %s",
  async (dataset, filter) => {
    using scenario = openScenarioDatabase();
    const { exit, events } = await runEffect(
      collectQuery(dataset, {
        libraries: [SCENARIO_LIBRARIES.personal],
        filter,
        fields: [],
      }),
      { client: scenario.db },
    );
    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(exit.value.warnings).toEqual([]);
    expect(
      events.filter(
        (event) =>
          event.type === "statement" &&
          event.statement.reader === "collection-paths",
      ),
    ).toHaveLength(1);
  },
);
