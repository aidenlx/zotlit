import { Cause, Effect } from "effect";
import { expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";

import {
  collectQuery,
  ITEMS,
  ATTACHMENTS,
  ANNOTATIONS,
  AttachmentFileResolver,
} from ".";
import { runEffect } from "./test-helpers";

it("finds papers with no usable PDF on this machine", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter:
        'attachments.filter(value.contentType == "application/pdf" && value.exists).isEmpty()',
      fields: ["title", "attachments[].path"],
      sort: [],
    }).pipe(
      Effect.provideService(AttachmentFileResolver, (attachment) =>
        Effect.succeed({
          path: attachment.key === "PDF2LIVE" ? "/paper.pdf" : null,
          exists: attachment.key === "PDF2LIVE",
        }),
      ),
    ),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw Cause.squash(exit.cause);
  expect(exit.value.rows!.length).toBeGreaterThan(0);
  expect(exit.value.rows!.map((row) => row.indexedKey)).not.toContain(
    "ART2FULL",
  );
  expect(
    exit.value.rows!.every((row) =>
      Array.isArray(row.values["attachments[].path"]),
    ),
  ).toBe(true);
});

it("finds papers with yellow marks inside their files, with value and index bound at each level", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter:
        'attachments.filter(index == 0 && value.annotations.filter(index == 0 && value.color == "#ffd400" && value.tags.contains("method")).length > 0).length > 0',
      fields: ["attachments[].annotations[].text", "annotations.length"],
      sort: [],
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw Cause.squash(exit.cause);
  expect(exit.value.rows!.map((row) => row.indexedKey)).toEqual(["ART2FULL"]);
  expect(exit.value.rows![0]!.values["annotations.length"]).toBe(12);
  expect(
    exit.value.rows![0]!.values["attachments[].annotations[].text"],
  ).toEqual([
    [
      "A <i>formatted</i> excerpt",
      "A <i>formatted</i> excerpt",
      "Linked excerpt",
      "Linked excerpt",
      "Linked excerpt",
      "Linked excerpt",
    ],
    [
      "an exact match",
      "A <i>formatted</i> excerpt",
      "A <i>formatted</i> excerpt",
      "A <i>formatted</i> excerpt",
      "A <i>formatted</i> excerpt",
      "A <i>formatted</i> excerpt",
    ],
    [],
    [],
  ]);
});

it("reaches a mark's file and paper from a Relation List", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter:
        'annotations.filter(value.attachment.title == "Full Text PDF" && value.item.title == title).length > 0',
      fields: [
        "attachments",
        "annotations[0]",
        "annotations[].attachment.tags",
        "attachments[0].item",
      ],
      sort: [],
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw Cause.squash(exit.cause);
  expect(exit.value.rows!.map((row) => row.indexedKey)).toEqual(["ART2FULL"]);
  expect(exit.value.rows![0]!.values["annotations[0]"]).toEqual({
    indexedKey: "ANN2LINK",
    type: "highlight",
    text: "A <i>formatted</i> excerpt",
    comment: "<b>Comment</b>",
    pageLabel: "iv",
    pageIndex: 0,
  });
  expect(exit.value.rows![0]!.values["attachments[0].item"]).toEqual({
    indexedKey: "ART2FULL",
    title: "Exact Matching in Literature Review",
    citationKey: null,
  });
});

it.each([
  [
    "papers in a Collection with no highlight yet",
    'collections.within("Thesis") && annotations.filter(value.type == "highlight").isEmpty()',
    ["CHP2YEAR"],
  ],
  [
    "papers with more than one PDF",
    'attachments.filter(value.contentType == "application/pdf").length > 1',
    ["ART2FULL"],
  ],
  [
    "papers with marks tagged method",
    'annotations.filter(value.tags.contains("method") && value.dateModified.year == 2024).length > 0',
    ["ART2FULL"],
  ],
  [
    "papers with no Attachment",
    '!attachments && key == "RPT2NDTE"',
    ["RPT2NDTE"],
  ],
  [
    "papers whose Attachment list is empty",
    'attachments.isEmpty() && key == "RPT2NDTE"',
    ["RPT2NDTE"],
  ],
  [
    "papers with marks reached through a map",
    'attachments.map(value.annotations).flat().filter(value.color == "#ffd400").length > 0',
    ["ART2FULL"],
  ],
] as const)("finds %s", async (_question, filter, keys) => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter,
      fields: [],
      sort: [],
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw Cause.squash(exit.cause);
  expect(exit.value.rows!.map((row) => row.indexedKey)).toEqual(keys);
});

it("lists the number of marks on each file", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ATTACHMENTS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      fields: ["annotations.length", "item"],
      sort: [],
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw Cause.squash(exit.cause);
  expect(
    exit.value.rows!.map((row) => [
      row.indexedKey,
      row.values["annotations.length"],
    ]),
  ).toEqual([
    ["PDF2LINK", 6],
    ["PDF2LIVE", 6],
    ["URL2LIVE", 0],
    ["WEB2LIVE", 0],
  ]);
  expect(exit.value.rows![0]!.values.item).toEqual({
    indexedKey: "ART2FULL",
    title: "Exact Matching in Literature Review",
    citationKey: null,
  });
});

it("keeps missing paths in place and projects fixed summaries for files and marks", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter: 'key == "ART2FULL"',
      sort: [],
      fields: [
        "attachments",
        "attachments[].path",
        "annotations",
        "annotations[].text",
        "attachments[4].path",
      ],
    }).pipe(
      Effect.provideService(AttachmentFileResolver, (attachment) =>
        Effect.succeed({
          path: attachment.key === "PDF2LIVE" ? "/paper.pdf" : null,
          exists: attachment.key === "PDF2LIVE",
        }),
      ),
    ),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw Cause.squash(exit.cause);
  const values = exit.value.rows![0]!.values;
  expect(values["attachments[].path"]).toEqual([
    null,
    "/paper.pdf",
    null,
    null,
  ]);
  expect(values["attachments[4].path"]).toBeNull();
  expect(values.attachments).toEqual([
    {
      indexedKey: "PDF2LINK",
      title: "linkedAttachment",
      contentType: "application/pdf",
      linkMode: "linked_file",
      path: null,
      exists: false,
    },
    {
      indexedKey: "PDF2LIVE",
      title: "Full Text PDF",
      contentType: "application/pdf",
      linkMode: "imported_file",
      path: "/paper.pdf",
      exists: true,
    },
    {
      indexedKey: "URL2LIVE",
      title: "linkedUrlAttachment",
      contentType: "text/html",
      linkMode: "linked_url",
      path: null,
      exists: false,
    },
    {
      indexedKey: "WEB2LIVE",
      title: "snapshotAttachment",
      contentType: "text/html",
      linkMode: "imported_url",
      path: null,
      exists: false,
    },
  ]);
  expect(values.annotations).toHaveLength(12);
  for (const record of values.annotations as Record<string, unknown>[])
    expect(Object.keys(record)).toEqual([
      "indexedKey",
      "type",
      "text",
      "comment",
      "pageLabel",
      "pageIndex",
    ]);
  expect(values["annotations[].text"]).toHaveLength(12);
});

it.each(["annotations.length", "attachments[].title"])(
  "explains why a paper cannot be sorted by %s",
  async (field) => {
    using scenario = openScenarioDatabase({ annotations: true });
    const { exit } = await runEffect(
      collectQuery(ITEMS, {
        libraries: [SCENARIO_LIBRARIES.personal],
        sort: [{ field, direction: "desc" }],
      }),
      { client: scenario.db },
    );
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure")
      expect(Cause.squash(exit.cause)).toMatchObject({
        code: "unsortable-field",
      });
  },
);

it("uses a paper's custom review status while reading its files", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter:
        'attachments.filter(value.item.custom["review.status"] == "done").length > 0',
      fields: ['attachments[].item.custom["review.status"]'],
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw Cause.squash(exit.cause);
  expect(exit.value.rows!.map((row) => row.indexedKey)).toEqual(["ART2FULL"]);
  expect(
    exit.value.rows![0]!.values['attachments[].item.custom["review.status"]'],
  ).toEqual(["done", "done", "done", "done"]);
});

it("recognizes the same file through repeated list reads", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter:
        "attachments && attachments.contains(attachments[0]) && attachments == attachments",
      fields: [],
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw Cause.squash(exit.cause);
  expect(exit.value.rows!.map((row) => row.indexedKey)).toEqual(["ART2FULL"]);
});

it.each([
  [ATTACHMENTS, 'annotations[].item.custom["missing.review"]'],
  [ANNOTATIONS, 'attachment.item.custom["missing.review"]'],
] as const)(
  "checks the source field in %s through %s",
  async (dataset, field) => {
    using scenario = openScenarioDatabase({ annotations: true });
    const { exit } = await runEffect(
      collectQuery(dataset, {
        libraries: [SCENARIO_LIBRARIES.personal],
        fields: [field],
      }),
      { client: scenario.db },
    );
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure")
      expect(Cause.squash(exit.cause)).toMatchObject({ code: "unknown-field" });
  },
);
