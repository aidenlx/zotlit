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

it.each([
  [ITEMS, 'custom["review.status"]'],
  [ATTACHMENTS, 'item.custom["review.status"]'],
  [ANNOTATIONS, 'item.custom["review.status"]'],
  [ITEMS, 'attachments[0].item.custom["review.status"]'],
] as const)(
  "reads the source vocabulary once when %s groups by %s",
  async (dataset, group) => {
    using scenario = openScenarioDatabase({ annotations: true });
    const { exit, events } = await runEffect(
      collectQuery(dataset, {
        libraries: [SCENARIO_LIBRARIES.personal],
        group,
        fields: [],
        sort: [],
      }),
      { client: scenario.db },
    );
    if (exit._tag === "Failure") throw Cause.squash(exit.cause);
    expect(exit.value.groups!.some((group) => group.value === "done")).toBe(
      true,
    );
    const statements = events.flatMap((event) =>
      event.type === "statement" &&
      event.statement.reader === "field-vocabulary"
        ? [event.statement]
        : [],
    );
    expect(statements).toHaveLength(2);
  },
);

it.each([
  'if(true, attachments, []).filter(value.title == "Full Text PDF").length > 0',
  'if(false, [], attachments).filter(value.title == "Full Text PDF").length > 0',
  'if(false, attachments, annotations[0].item.attachments).filter(value.title == "Full Text PDF").length > 0',
  'if(true, annotations[0].item.attachments, attachments).filter(value.title == "Full Text PDF").length > 0',
])("keeps record navigation and hydration through %s", async (filter) => {
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
  expect(exit.value.rows!.map((row) => row.indexedKey)).toEqual(["ART2FULL"]);
});

it("reports a typed Fault for record navigation through incompatible conditional lists", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter:
        'if(true, attachments, annotations).filter(value.title == "Full Text PDF").length > 0',
      fields: [],
    }),
    { client: scenario.db },
  );
  expect(exit._tag).toBe("Failure");
  if (exit._tag === "Failure")
    expect(Cause.squash(exit.cause)).toMatchObject({
      code: "unknown-property",
    });
});

it.each([
  'annotations.filter(value.color == "yellow").length > 0',
  'annotations.filter("yellow" == value.color).length > 0',
  'attachments.filter(value.annotations.filter(value.color == "yellow").length > 0).length > 0',
  'attachments.map(value.annotations).flat().filter(value.color == "yellow").length > 0',
])("keeps Annotation color aliases inside %s", async (filter) => {
  using scenario = openScenarioDatabase({ annotations: true });
  const libraries = [SCENARIO_LIBRARIES.personal];
  const marks = await runEffect(
    collectQuery(ANNOTATIONS, {
      libraries,
      filter: 'color == "yellow"',
      fields: [],
      sort: [],
    }),
    { client: scenario.db },
  );
  if (marks.exit._tag === "Failure") throw Cause.squash(marks.exit.cause);
  const expected = [
    ...new Set(marks.exit.value.rows!.map((row) => row.itemIndexedKey)),
  ];
  expect(expected).toEqual(["ART2FULL"]);
  const { exit } = await runEffect(
    collectQuery(ITEMS, {
      libraries,
      filter,
      fields: [],
      sort: [],
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw Cause.squash(exit.cause);
  expect(exit.value.rows!.map((row) => row.indexedKey)).toEqual(expected);
});

it.each([
  'attachments.filter(value.indexedKey == "PDF2LIVEg118").length > 0',
  'attachments.filter("PDF2LIVEg118" == value.indexedKey).length > 0',
  'attachments.filter(["PDF2LIVEg118"].contains(value.indexedKey)).length > 0',
  'attachments.filter(value.item.indexedKey == "ART2FULLg118").length > 0',
  'attachments.filter(value.annotations.filter(value.indexedKey == "ANN2HGHTg118").length > 0).length > 0',
  'annotations.filter(value.attachment.indexedKey == "PDF2LIVEg118").length > 0',
  'annotations.filter(value.item.attachments.filter(value.indexedKey == "PDF2LIVEg118").length > 0).length > 0',
])("warns for an out-of-scope Indexed Key inside %s", async (filter) => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter,
      fields: [],
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw Cause.squash(exit.cause);
  expect(exit.value.rows).toEqual([]);
  expect(exit.value.warnings).toMatchObject([
    {
      code: "key-outside-target-libraries",
      severity: "warning",
    },
  ]);
  expect(exit.value.warnings).toHaveLength(1);
  expect(exit.value.warnings[0]!.message).toContain("group:118");
  expect(exit.value.warnings[0]!.hint).toContain("personal,group:118");
});

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

it("reads fewer rows for a selective relation filter than its forced scan", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const request = {
    libraries: [SCENARIO_LIBRARIES.personal],
    filter: 'annotations.filter(value.tags.contains("method")).length > 0',
    fields: [],
    sort: [],
  };
  const planned = await runEffect(collectQuery(ITEMS, request), {
    client: scenario.db,
  });
  const scanned = await runEffect(collectQuery(ITEMS, request), {
    client: scenario.db,
    tuning: { forceScan: true },
  });
  expect(planned.exit).toEqual(scanned.exit);
  const rows = (events: typeof planned.events) =>
    events.flatMap((event) =>
      event.type === "statement" &&
      ["scan-page", "universe-rows"].includes(event.statement.reader)
        ? event.statement.rows
        : [],
    ).length;
  expect(rows(planned.events)).toBeLessThan(rows(scanned.events));
  expect(
    planned.events.some(
      (event) =>
        event.type === "statement" &&
        event.statement.reader === "relation-candidate-set",
    ),
  ).toBe(true);
});

it.each([
  'attachments.filter(value.item.collections.contains("Thesis/Methods")).length > 0',
  'annotations.filter(value.item.collections.within("Thesis")).length >= 1',
  'attachments.filter(value.annotations.filter(value.item.collections.within("Thesis")).length > 0).length > 0',
])("lowers parent Collection paths inside %s", async (filter) => {
  using scenario = openScenarioDatabase({ annotations: true });
  const request = {
    libraries: [SCENARIO_LIBRARIES.personal],
    filter,
    fields: [],
    sort: [],
  };
  const actual = await runEffect(collectQuery(ITEMS, request), {
    client: scenario.db,
  });
  const scan = await runEffect(collectQuery(ITEMS, request), {
    client: scenario.db,
    tuning: { forceScan: true },
  });
  expect(actual.exit).toEqual(scan.exit);
  expect(
    actual.events.some(
      (event) =>
        event.type === "statement" &&
        event.statement.reader === "relation-candidate-set",
    ),
  ).toBe(true);
});

it.each([
  [
    ITEMS,
    'attachments.filter(value.tags.contains("downloaded")).length > 0',
    "attachment-candidate-set",
  ],
  [
    ITEMS,
    'attachments.filter(value.indexedKey == "PDF2LIVE").length >= 1',
    "attachment-candidate-set",
  ],
  [
    ITEMS,
    '!attachments.filter(value.contentType == "application/pdf").isEmpty()',
    "attachment-candidate-set",
  ],
  [
    ITEMS,
    'attachments.filter(value.linkMode == "linked_file").length > 0',
    "attachment-candidate-set",
  ],
  [
    ITEMS,
    'annotations.filter(value.color == "#ffd400").length >= 1',
    "annotation-candidate-set",
  ],
  [
    ITEMS,
    '!annotations.filter(value.type == "highlight").isEmpty()',
    "annotation-candidate-set",
  ],
  [
    ATTACHMENTS,
    'annotations.filter(value.key == "ANN2HGHT").length > 0',
    "annotation-candidate-set",
  ],
  [
    ATTACHMENTS,
    'annotations.filter(value.tags.contains("method")).length >= 1',
    "annotation-candidate-set",
  ],
  [
    ATTACHMENTS,
    '!annotations.filter(value.color == "#ffd400").isEmpty()',
    "annotation-candidate-set",
  ],
] as const)(
  "uses the element dataset's reader for %s %s",
  async (dataset, filter, reader) => {
    using scenario = openScenarioDatabase({ annotations: true });
    const request = {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter,
      fields: [],
      sort: [],
    };
    const actual = await runEffect(collectQuery(dataset, request), {
      client: scenario.db,
    });
    const scan = await runEffect(collectQuery(dataset, request), {
      client: scenario.db,
      tuning: { forceScan: true },
    });
    expect(actual.exit).toEqual(scan.exit);
    expect(
      actual.events.some(
        (event) =>
          event.type === "statement" && event.statement.reader === reader,
      ),
    ).toBe(true);
  },
);

it.each([
  "attachments.filter(value.exists).length > 0",
  'annotations.filter(value.tags.contains("method")).isEmpty()',
  '!(annotations.filter(value.tags.contains("method")).length > 0)',
  'annotations.filter(value.tags.contains("method")).length > 1',
  'annotations.filter(value.tags.contains("method")).length >= 2',
  'annotations.filter(key == "ART2FULL").length > 0',
  'annotations.filter(value.type == "highlight" || index == 0).length > 0',
])("keeps the scan for %s", async (filter) => {
  using scenario = openScenarioDatabase({ annotations: true });
  const actual = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter,
      fields: [],
      sort: [],
    }),
    { client: scenario.db },
  );
  if (actual.exit._tag === "Failure") throw Cause.squash(actual.exit.cause);
  expect(
    actual.events.some(
      (event) =>
        event.type === "statement" && event.statement.reader === "scan-page",
    ),
  ).toBe(true);
  expect(
    actual.events.some(
      (event) =>
        event.type === "statement" &&
        event.statement.reader.endsWith("candidate-set"),
    ),
  ).toBe(false);
});
