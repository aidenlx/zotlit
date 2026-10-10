import { expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";

import { ANNOTATIONS, collectQuery } from ".";
import { describeAnnotationQuery } from "./describe-annotation-query";
import { runEffect } from "./test-helpers";

it("publishes executable Annotation and parent Projection Paths with active-source custom fields", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const described = await runEffect(describeAnnotationQuery(), {
    client: scenario.db,
  });
  if (described.exit._tag === "Failure")
    throw new Error(String(described.exit.cause));
  const schema = described.exit.value;
  expect(schema).toHaveProperty("projectionPathGrammar.each.syntax", "[]");
  expect(schema.fields).toContainEqual({
    path: "item.creators[].fullName",
    type: "array",
    filter: null,
    projection: true,
    group: false,
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
