import { Cause } from "effect";
import { expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";

import { ANNOTATION_SCENARIO_QUERIES } from "./annotation-scenario-queries";
import { queryAnnotations } from "./query-annotations";
import type { RunOptions } from "./test-helpers";
import { runEffect } from "./test-helpers";

it("returns the reading record of one Item, with three identities and default fields", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    queryAnnotations({
      libraries: [SCENARIO_LIBRARIES.personal],
      item: ["ART2FULL"],
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  expect(exit.value.returnedCount).toBe(12);
  expect(exit.value.rows.map((row) => row.indexedKey)).toEqual([
    "ANN2LINK",
    "ANN2BAD2",
    "ANL2IMAG",
    "ANL2INK2",
    "ANL2UNDR",
    "ANL2TEXT",
    "ANN2HGHT",
    "ANN2NOTE",
    "ANN2IMAG",
    "ANN2INK2",
    "ANN2UNDR",
    "ANN2TEXT",
  ]);
  expect(new Set(exit.value.rows.map((row) => row.values.type))).toEqual(
    new Set(["highlight", "underline", "note", "image", "ink", "text"]),
  );
  expect(exit.value.rows[2]?.values.colorName).toBeNull();
  expect(exit.value.rows[10]).toMatchObject({
    indexedKey: "ANN2UNDR",
    attachmentIndexedKey: "PDF2LIVE",
    itemIndexedKey: "ART2FULL",
    values: {
      type: "underline",
      text: "A <i>formatted</i> excerpt",
      comment: "<b>Comment</b>",
      colorName: "yellow",
      pageIndex: 0,
      tags: ["method"],
      "item.title": "Exact Matching in Literature Review",
      attachment: {
        indexedKey: "PDF2LIVE",
        title: "Full Text PDF",
        linkMode: "imported_file",
      },
    },
  });
  expect(exit.value.rows[1]?.values.pageIndex).toBeNull();
  for (const row of exit.value.rows)
    expect(row.values).not.toHaveProperty("position");
});

it("projects each PDF position kind and preserves an unknown stored position", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    queryAnnotations({
      libraries: [SCENARIO_LIBRARIES.personal],
      attachment: ["PDF2LIVE", "PDF2LINK"],
      fields: ["position"],
      limit: null,
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  const positions = Object.fromEntries(
    exit.value.rows.map((row) => [row.indexedKey, row.values.position]),
  );

  expect(positions).toMatchObject({
    ANN2IMAG: {
      kind: "pdf-rects",
      pageIndex: 0,
      rects: [[0, 0, 1, 1]],
    },
    ANN2INK2: {
      kind: "pdf-ink",
      pageIndex: 0,
      width: 2,
      paths: [[0, 0, 1, 1]],
    },
    ANN2TEXT: {
      kind: "pdf-text",
      pageIndex: 0,
      rects: [[0, 0, 1, 1]],
      fontSize: 12,
      rotation: 0,
    },
    ANN2BAD2: { kind: "unknown", raw: "invalid JSON" },
  });
});

it("limits all Libraries as one set and projects only identities for fields=[]", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const request = {
    libraries: [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group],
    fields: [],
    limit: 2,
  };
  const found = await runEffect(queryAnnotations(request), {
    client: scenario.db,
    tuning: { scanPageSize: 2, hydrateChunkSize: 1 },
  });
  if (found.exit._tag === "Failure") throw new Error(String(found.exit.cause));
  expect(found.exit.value).toMatchObject({
    returnedCount: 2,
    truncated: true,
    rows: [
      {
        indexedKey: "ANN2GRUPg4815",
        attachmentIndexedKey: "PDF2GRUPg4815",
        itemIndexedKey: "ART2FULLg4815",
        values: {},
      },
      {
        indexedKey: "ANN2LINK",
        attachmentIndexedKey: "PDF2LINK",
        itemIndexedKey: "ART2FULL",
        values: {},
      },
    ],
  });
  const scanned = await runEffect(queryAnnotations(request), {
    client: scenario.db,
    tuning: { forceScan: true },
  });
  expect(scanned.exit).toEqual(found.exit);
});

it.each([
  [{ fields: ["missing"] }, "unknown-field"],
  [{ fields: ["attachment.missing"] }, "unknown-path"],
  [{ limit: 0 }, "invalid-limit"],
])(
  "reports a typed invalid request before reading: %j",
  async (options, code) => {
    const found = await runEffect(
      queryAnnotations({
        libraries: [SCENARIO_LIBRARIES.personal],
        ...options,
      }),
    );
    expect(found.exit).toMatchObject({ _tag: "Failure" });
    if (found.exit._tag !== "Failure") throw new Error("Expected failure");
    expect(String(found.exit.cause)).toContain("ItemQueryError");
    expect(Cause.squash(found.exit.cause)).toMatchObject({ code });
    expect(found.events.filter((event) => event.type === "statement")).toEqual(
      [],
    );
  },
);

it("combines Annotation fields with parent dates, Tags, and projections", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    queryAnnotations({
      libraries: [SCENARIO_LIBRARIES.personal],
      filter:
        'type == "underline" && tags.contains("method") && item.title.contains("Exact Matching") && item.date.year == 2020',
      fields: ["item.title", "item.date.year", "item.tags"],
      sort: [{ field: "pageIndex", direction: "asc" }],
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  expect(exit.value.rows.map((row) => row.indexedKey)).toEqual(["ANN2UNDR"]);
  expect(exit.value.rows[0]?.values["item.date.year"]).toBe(2020);
});

it("reads parent custom fields, relations, timestamps and identities through their Item semantics", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    queryAnnotations({
      libraries: [SCENARIO_LIBRARIES.personal],
      item: ["ART2FULL"],
      filter:
        'item.custom["review.status"] == "done" && item.mood == "calm" && item.tags.contains("methods") && item.collections.within("Thesis") && item.dateModified.year == 2024',
      fields: [
        "item.indexedKey",
        'item.custom["review.status"]',
        "item.creators[0].family",
        "item.tags[0].name",
        "item.dateModified",
      ],
      limit: 1,
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  expect(exit.value.returnedCount).toBe(1);
  expect(exit.value.rows[0]?.values).toMatchObject({
    "item.indexedKey": "ART2FULL",
    'item.custom["review.status"]': "done",
    "item.creators[0].family": "Lovelace",
  });
  expect(
    JSON.parse(JSON.stringify(exit.value.rows[0]?.values["item.dateModified"])),
  ).toBe("2024-06-01T10:00:00Z");
});

it("matches the forced scan for every Annotation scenario, Library combination, cap, and chunk size", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  for (const libraries of [
    [SCENARIO_LIBRARIES.personal],
    [SCENARIO_LIBRARIES.group],
    [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group],
  ]) {
    for (const request of ANNOTATION_SCENARIO_QUERIES) {
      const run = async (tuning: RunOptions["tuning"]) => {
        const { exit } = await runEffect(
          queryAnnotations({ ...request, libraries }),
          { client: scenario.db, tuning },
        );
        return JSON.parse(JSON.stringify(exit));
      };
      const expected = await run({ forceScan: true });
      for (const tuning of [
        {},
        { capRatio: 1 },
        { capRatio: 0 },
        { capRatio: 0.1 },
        { capRatio: 1, scanPageSize: 3, hydrateChunkSize: 2 },
        { scanPageSize: 1, hydrateChunkSize: 1, mergeStepSize: 1 },
      ]) {
        expect({
          request,
          libraries,
          tuning,
          outcome: await run(tuning),
        }).toEqual({ request, libraries, tuning, outcome: expected });
      }
    }
  }
}, 30000);
