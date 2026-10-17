import { Exit } from "effect";
import { afterAll, beforeAll, expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { ATTACHMENTS, collectQuery } from ".";
import type { ItemQueryRequest, ItemQuerySchema } from ".";
import { describeAttachmentQuery } from "./describe-attachment-query";
import { describeQueryVocabulary } from "./schema";
import { faultCode, runEffect } from "./test-helpers";

// Every test here only reads the scenario.
let scenario: ScenarioDatabase;

beforeAll(() => {
  scenario = openScenarioDatabase({ annotations: true });
});

afterAll(() => {
  scenario.close();
});

async function schema(): Promise<ItemQuerySchema> {
  const { exit } = await runEffect(describeAttachmentQuery(), {
    client: scenario.db,
  });
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
  return exit.value;
}

it("publishes Attachment fields, parent paths and defaults in the single catalog", async () => {
  const { fields, defaults } = await schema();
  const entry = (path: string) => fields.find((field) => field.path === path);

  expect(describeQueryVocabulary().datasets.attachments.defaults).toEqual({
    fields: ATTACHMENTS.defaultFields,
    sort: ATTACHMENTS.defaultSort.map(({ field, direction }) => ({
      field,
      direction,
    })),
    limit: null,
  });
  expect(defaults).toEqual(
    describeQueryVocabulary().datasets.attachments.defaults,
  );
  expect(entry("item")).toMatchObject({ relation: "items" });
  expect(entry("annotations")).toMatchObject({
    relation: "annotations",
    filter: "list",
  });
  expect(entry("annotations.length")).toMatchObject({ filter: "number" });
  // A list element's type depends on the Attachment.
  expect(entry("annotations[0]")).toMatchObject({ filter: "any" });
  expect(entry("fileType")).toMatchObject({
    valueForms: ["pdf", "epub", "web", "other"],
  });
});

it("accepts every field and Projection Path in the use its capabilities list, and rejects every other use", async () => {
  const { fields, customFields } = await schema();
  const failures: string[] = [];
  const check = async (
    label: string,
    request: Omit<ItemQueryRequest, "libraries">,
    accepted: boolean,
  ) => {
    const code = await faultCode(ATTACHMENTS, scenario.db, request);
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

  expect(fields.some((field) => field.sort)).toBe(true);
  expect(failures).toEqual([]);
});

it("projects every Projection Path it lists in one query", async () => {
  const { fields, customFields } = await schema();
  const projected = await runEffect(
    collectQuery(ATTACHMENTS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      limit: 1,
      fields: [...fields, ...customFields]
        .filter((field) => field.projection)
        .map((field) => field.path),
    }),
    { client: scenario.db },
  );
  if (projected.exit._tag === "Failure")
    throw new Error(String(projected.exit.cause));
  expect(projected.exit.value.returnedCount).toBe(1);
});
