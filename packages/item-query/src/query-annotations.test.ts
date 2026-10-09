import { Cause } from "effect";
import { expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";

import { queryAnnotations } from "./query-annotations";
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
