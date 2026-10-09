import { expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";

import { describeAnnotationQuery } from "./describe-annotation-query";
import { queryAnnotations } from "./query-annotations";
import { runEffect } from "./test-helpers";

it("publishes executable Annotation and parent Projection Paths with active-source custom fields", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const described = await runEffect(describeAnnotationQuery(), {
    client: scenario.db,
  });
  if (described.exit._tag === "Failure")
    throw new Error(String(described.exit.cause));
  const schema = described.exit.value;
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
    queryAnnotations({
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
});
