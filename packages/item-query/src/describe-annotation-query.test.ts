import { Exit } from "effect";
import { afterAll, beforeAll, expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { ANNOTATIONS, collectQuery } from ".";
import type { ItemQueryRequest } from ".";
import { describeAnnotationQuery } from "./describe-annotation-query";
import { faultCode, runEffect } from "./test-helpers";

// Every test here only reads the scenario.
let scenario: ScenarioDatabase;

beforeAll(() => {
  scenario = openScenarioDatabase({ annotations: true });
});

afterAll(() => {
  scenario.close();
});

async function describeSchema() {
  const { exit } = await runEffect(describeAnnotationQuery(), {
    client: scenario.db,
  });
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
  return exit.value;
}

it("accepts every field and Projection Path in the use its capabilities list, and rejects every other use", async () => {
  const { fields, customFields } = await describeSchema();
  const failures: string[] = [];
  const check = async (
    label: string,
    request: Omit<ItemQueryRequest, "libraries">,
    accepted: boolean,
  ) => {
    const code = await faultCode(ANNOTATIONS, scenario.db, request);
    if ((code === null) !== accepted)
      failures.push(`${label}: ${code ?? "accepted"}`);
  };

  for (const field of [...fields, ...customFields]) {
    const { path } = field;
    await check(`fields ${path}`, { fields: [path] }, field.projection);
    await check(
      `sort ${path}`,
      { sort: [{ field: path, direction: "asc" }] },
      field.sort,
    );
    await check(`group ${path}`, { group: path }, field.group);
    await check(`filter ${path}`, { filter: path }, field.filter !== null);
  }

  expect(failures).toEqual([]);
});

it("publishes executable Annotation and parent Projection Paths with active-source custom fields", async () => {
  const schema = await describeSchema();
  expect(schema).toHaveProperty("projectionPathGrammar.each.syntax", "[]");
  expect(schema.fields).toContainEqual({
    path: "item.creators[].fullName",
    type: "array",
    filter: null,
    projection: true,
    group: true,
    sort: false,
  });
  expect(schema.fields).toContainEqual({
    path: "position.rects[][]",
    type: "array",
    filter: null,
    projection: true,
    group: false,
    sort: false,
  });
  expect(schema.fields.find((field) => field.path === "library"))
    .toMatchInlineSnapshot(`
      {
        "filter": "string",
        "group": true,
        "path": "library",
        "projection": true,
        "sort": false,
        "type": "string",
        "valueForms": [
          "personal",
          "group:<groupID>",
        ],
      }
    `);
  expect(schema.customFields).toContainEqual(
    expect.objectContaining({
      path: 'item.custom["review.status"]',
      projection: true,
      filter: "string",
    }),
  );
  expect(schema.fields).toContainEqual(
    expect.objectContaining({ path: "item.date.year", filter: "number" }),
  );
  expect(schema.fields).toContainEqual(
    expect.objectContaining({ path: "item.tags", filter: "list" }),
  );
  expect(schema.fields).toContainEqual(
    expect.objectContaining({ path: "attachment.indexedKey", sort: true }),
  );
  for (const path of [
    "key",
    "indexedKey",
    "item.key",
    "item.indexedKey",
    "attachment.key",
    "attachment.indexedKey",
  ])
    expect(schema.fields).toContainEqual(
      expect.objectContaining({ path, projection: true, sort: true }),
    );
  expect(schema.fields).toContainEqual(
    expect.objectContaining({
      path: "attachment.fileType",
      projection: true,
      filter: "string",
      group: true,
      valueForms: ["pdf", "epub", "web", "other"],
    }),
  );
  expect(schema.defaults.fields).not.toContain("position");
  expect(Object.keys(schema.positionKinds)).toEqual([
    "pdf-rects",
    "pdf-ink",
    "pdf-text",
    "epub-cfi",
    "snapshot-css",
    "snapshot-text",
    "unknown",
  ]);
  expect(schema.fields).toContainEqual(
    expect.objectContaining({ path: "position.raw", type: "any" }),
  );
  expect(schema.positionKinds.unknown).toMatchObject({
    keys: { raw: { kind: "json" } },
  });
  const projected = await runEffect(
    collectQuery(ANNOTATIONS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      limit: 1,
      fields: [...schema.fields, ...schema.customFields]
        .filter((field) => field.projection)
        .map((field) => field.path),
    }),
    { client: scenario.db },
  );
  if (projected.exit._tag === "Failure")
    throw new Error(String(projected.exit.cause));
  expect(projected.exit.value.returnedCount).toBe(1);
  expect(projected.exit.value.warnings).toEqual([]);
});
