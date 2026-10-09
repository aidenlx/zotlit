import { expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";

import { ATTACHMENTS, collectQuery } from ".";
import { describeAttachmentQuery } from "./describe-attachment-query";
import { describeQueryVocabulary } from "./schema";
import { runEffect } from "./test-helpers";

it("publishes executable Attachment fields, parent paths, defaults and Sortable Fields in the single catalog", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const described = await runEffect(describeAttachmentQuery(), {
    client: scenario.db,
  });
  if (described.exit._tag === "Failure")
    throw new Error(String(described.exit.cause));
  const schema = described.exit.value;
  expect(describeQueryVocabulary().datasets.attachments).toMatchObject({
    defaults: {
      fields: [
        "title",
        "contentType",
        "linkMode",
        "path",
        "exists",
        "item.title",
        "item.citationKey",
      ],
      sort: [{ field: "dateModified", direction: "desc" }],
    },
  });
  expect(schema.fields.find((field) => field.path === "item")).toMatchObject({
    relation: "items",
  });
  expect(
    schema.fields
      .filter((field) => field.sort)
      .map((field) => field.path)
      .sort(),
  ).toEqual([
    "contentType",
    "dateAdded",
    "dateModified",
    "item.date",
    "item.dateModified",
    "item.title",
    "linkMode",
    "title",
  ]);
  expect(
    schema.fields.filter((field) => !field.path.startsWith("item.")),
  ).toMatchSnapshot();
  const projected = await runEffect(
    collectQuery(ATTACHMENTS, {
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
