import { Cause, Effect } from "effect";
import { expect, it } from "vitest";

import {
  BULK_LIBRARY,
  seedBulkLibrary,
  seedBulkAttachments,
  seedBulkAnnotations,
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

// Failure modes: rejected identities, bare keys with a suffix, parent identities
// from the wrong Library, and numeric rather than text ordering of group IDs.
it.each([
  [ITEMS, "ART2FULL", "ART2FULL"],
  [ATTACHMENTS, "PDF2LIVE", "PDF2GRUP"],
  [ANNOTATIONS, "ANN2HGHT", "ANN2GRUP"],
] as const)(
  "projects and sorts keys in %s across Target Libraries",
  async (dataset, personalKey, groupKey) => {
    const parentKey = "ART2FULL";
    using scenario = openScenarioDatabase({ annotations: true });
    scenario.sqlite
      .prepare("update items set key = ? where key = ? and libraryID = ?")
      .run(personalKey, groupKey, SCENARIO_LIBRARIES.group.libraryID);
    const fields = [
      "indexedKey",
      "key",
      ...(dataset === ITEMS ? [] : ["item.indexedKey", "item.key"]),
    ];
    for (const direction of ["asc", "desc"] as const) {
      for (const field of [
        "indexedKey",
        "key",
        ...(dataset === ITEMS ? [] : ["item.indexedKey", "item.key"]),
      ]) {
        const { exit } = await runEffect(
          collectQuery(dataset, {
            libraries: [SCENARIO_LIBRARIES.group, SCENARIO_LIBRARIES.personal],
            filter: `key == "${personalKey}"`,
            fields,
            sort: [{ field, direction }],
          }),
          { client: scenario.db },
        );
        if (exit._tag === "Failure") throw Cause.squash(exit.cause);
        const expected = [
          {
            indexedKey: personalKey,
            key: personalKey,
            ...(dataset === ITEMS
              ? {}
              : { "item.indexedKey": parentKey, "item.key": parentKey }),
          },
          {
            indexedKey: `${personalKey}g4815`,
            key: personalKey,
            ...(dataset === ITEMS
              ? {}
              : {
                  "item.indexedKey": `${parentKey}g4815`,
                  "item.key": parentKey,
                }),
          },
        ];
        if (direction === "desc" && field.endsWith("indexedKey"))
          expected.reverse();
        expect(exit.value.rows!.map((row) => row.values)).toEqual(expected);
      }
    }
  },
);

it("projects keys through Relation Lists and parents", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.group],
      filter: 'key == "ART2FULL"',
      fields: [
        "attachments[].key",
        "attachments[].indexedKey",
        "annotations[].key",
        "annotations[].indexedKey",
        "annotations[].attachment.key",
        "annotations[].attachment.indexedKey",
        "attachments[].item.key",
      ],
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw Cause.squash(exit.cause);
  expect(exit.value.rows![0]!.values).toEqual({
    "attachments[].key": ["PDF2GRUP"],
    "attachments[].indexedKey": ["PDF2GRUPg4815"],
    "annotations[].key": ["ANN2GRUP"],
    "annotations[].indexedKey": ["ANN2GRUPg4815"],
    "annotations[].attachment.key": ["PDF2GRUP"],
    "annotations[].attachment.indexedKey": ["PDF2GRUPg4815"],
    "attachments[].item.key": ["ART2FULL"],
  });
});

it("orders parent Indexed Keys as text including group suffixes", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  scenario.sqlite
    .prepare("update items set key = 'PDF2LIVE' where key = 'PDF2GRUP'")
    .run();
  for (const field of ["item.indexedKey", "attachment.indexedKey"]) {
    const { exit } = await runEffect(
      collectQuery(ANNOTATIONS, {
        libraries: [
          { ...SCENARIO_LIBRARIES.personal, groupID: 9 },
          { ...SCENARIO_LIBRARIES.group, groupID: 10 },
        ],
        filter: '["ANN2HGHT", "ANN2GRUP"].contains(key)',
        fields: [field, "attachment.key"],
        sort: [{ field, direction: "asc" }],
      }),
      { client: scenario.db },
    );
    if (exit._tag === "Failure") throw Cause.squash(exit.cause);
    expect(exit.value.rows!.map((row) => row.indexedKey)).toEqual([
      "ANN2GRUPg10",
      "ANN2HGHTg9",
    ]);
    expect(exit.value.rows!.map((row) => row.values[field])).toEqual(
      field === "item.indexedKey"
        ? ["ART2FULLg10", "ART2FULLg9"]
        : ["PDF2LIVEg10", "PDF2LIVEg9"],
    );
  }
});

it("reads file types through Relation Lists and Annotation parents", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const items = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter: 'attachments.filter(value.fileType == "web").length > 0',
      fields: ["attachments[].fileType", "annotations[].attachment.fileType"],
    }),
    { client: scenario.db },
  );
  if (items.exit._tag === "Failure") throw Cause.squash(items.exit.cause);
  expect(items.exit.value.rows).toHaveLength(1);
  expect(items.exit.value.rows![0]!.values["attachments[].fileType"]).toEqual([
    "pdf",
    "pdf",
    "web",
    "web",
  ]);
  expect(
    items.exit.value.rows![0]!.values["annotations[].attachment.fileType"],
  ).toEqual(Array(12).fill("pdf"));
  const annotations = await runEffect(
    collectQuery(ANNOTATIONS, {
      libraries: [SCENARIO_LIBRARIES.group],
      filter: 'attachment.fileType == "pdf"',
      fields: ["attachment.fileType"],
      group: "attachment.fileType",
    }),
    { client: scenario.db },
  );
  if (annotations.exit._tag === "Failure")
    throw Cause.squash(annotations.exit.cause);
  expect(annotations.exit.value.groups).toMatchObject([
    {
      value: "pdf",
      count: 1,
      rows: [{ values: { "attachment.fileType": "pdf" } }],
    },
  ]);
});

it("groups papers by each tag name across two Libraries, with overlapping counts and a null group", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group],
      group: "tags[].name",
      fields: [],
      sort: [],
      limit: 2,
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw Cause.squash(exit.cause);
  expect(
    exit.value.groups!.map(({ value, count, rows }) => [
      value,
      count,
      rows.map((row) => row.indexedKey),
    ]),
  ).toEqual([
    ["100%_raw\\path", 1, ["UNI2CDE2"]],
    ["eclair", 1, ["UNI2CDE2"]],
    ["Éclair", 1, ["UNI2CDE2"]],
    ["group-only", 1, ["GRP2BK22g4815"]],
    ["methods", 2, ["ALS2CNFL", "ART2FULL"]],
    ["tie", 3, ["TIE2AAAA", "TIE2BBBB"]],
    ["to-read", 3, ["ART2FULL", "ART2FULLg4815"]],
    ["To-Read", 1, ["ART2FULL"]],
    [null, 3, ["CHP2YEAR", "CNF2TEXT"]],
  ]);
  // Twelve papers match; their group counts add up to sixteen.
  expect(exit.value).toMatchObject({
    totalCount: 12,
    returnedCount: 13,
    truncated: true,
  });
});

it("puts a paper in a file-type group once, however many files of that type it has", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group],
      group: "attachments[].fileType",
      fields: ["attachments[].fileType"],
      sort: [],
      limit: null,
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw Cause.squash(exit.cause);
  expect(
    exit.value.groups!.map(({ value, count, rows }) => [
      value,
      count,
      rows.length,
    ]),
  ).toEqual([
    ["pdf", 2, 2],
    ["web", 1, 1],
    [null, 10, 10],
  ]);
  expect(exit.value.groups![0]!.rows.map((row) => row.indexedKey)).toEqual([
    "ART2FULL",
    "ART2FULLg4815",
  ]);
  // The group path names its Relation List, so the list is hydrated.
  expect(exit.value.groups![1]!.rows[0]!.values).toEqual({
    "attachments[].fileType": ["pdf", "pdf", "web", "web"],
  });
  // ART2FULL has PDF and web files, so it is in two groups.
  expect(exit.value).toMatchObject({
    totalCount: 12,
    returnedCount: 13,
    truncated: false,
  });
});

const DATASETS = {
  items: ITEMS,
  attachments: ATTACHMENTS,
  annotations: ANNOTATIONS,
};

it.each([
  {
    dataset: "items",
    group: "collections[]",
    groups: [
      ["Methods", 1],
      ["Teaching/Methods", 1],
      ["Thesis", 1],
      ["Thesis/Methods", 2],
      [null, 8],
    ],
    totalCount: 12,
  },
  {
    dataset: "attachments",
    group: "tags[]",
    groups: [
      ["attachment-method", 1],
      [null, 4],
    ],
    totalCount: 5,
  },
  {
    dataset: "attachments",
    group: "item.collections[]",
    groups: [
      ["Thesis/Methods", 4],
      [null, 1],
    ],
    totalCount: 5,
  },
  {
    dataset: "annotations",
    group: "item.tags[].name",
    groups: [
      ["methods", 12],
      ["to-read", 13],
      ["To-Read", 12],
    ],
    totalCount: 13,
  },
  {
    dataset: "annotations",
    group: "tags[]",
    groups: [
      ["method", 8],
      [null, 5],
    ],
    totalCount: 13,
  },
] as const)(
  "groups the records of $dataset by the element path $group",
  async ({ dataset, group, groups, totalCount }) => {
    using scenario = openScenarioDatabase({ annotations: true });
    const { exit } = await runEffect(
      collectQuery(DATASETS[dataset], {
        libraries: [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group],
        group,
        fields: [],
        limit: 1,
      }),
      { client: scenario.db },
    );
    if (exit._tag === "Failure") throw Cause.squash(exit.cause);
    expect(
      exit.value.groups!.map(({ value, count }) => [value, count]),
    ).toEqual(groups);
    expect(exit.value.totalCount).toBe(totalCount);
    expect(exit.value.returnedCount).toBe(groups.length);
  },
);

const TAG_FIELDS = ["group='tags[].name'", "group='tags[].type'"];
it.each([
  { dataset: "items", group: "tags", hint: "<field>", suggestions: TAG_FIELDS },
  {
    dataset: "attachments",
    group: "tags",
    hint: "group='tags[]'",
    suggestions: ["group='tags[]'"],
  },
  {
    dataset: "items",
    group: "collections",
    hint: "group='collections[]'",
    suggestions: ["group='collections[]'"],
  },
  {
    dataset: "attachments",
    group: "item.collections",
    hint: "group='item.collections[]'",
    suggestions: ["group='item.collections[]'"],
  },
  {
    dataset: "annotations",
    group: "item.tags",
    hint: "<field>",
    suggestions: ["group='item.tags[].name'", "group='item.tags[].type'"],
  },
  {
    dataset: "items",
    group: "tags[]",
    hint: "<field>",
    suggestions: TAG_FIELDS,
  },
] as const)(
  "rejects the $dataset group path $group and names its element path",
  async ({ dataset, group, hint, suggestions }) => {
    const { exit } = await runEffect(
      collectQuery(DATASETS[dataset], { libraries: [], group }),
    );
    if (exit._tag !== "Failure") throw new Error("Expected a request Fault");
    const error = Cause.findErrorOption(exit.cause);
    if (error._tag === "None") throw Cause.squash(exit.cause);
    expect(error.value).toMatchObject({
      code: "invalid-group",
      location: { argument: "group" },
      diagnostic: { suggestions },
    });
    expect(
      (error.value as unknown as { diagnostic: { hint: string } }).diagnostic
        .hint,
    ).toContain(hint);
  },
);

it("names a field of each element for a Relation List of records", async () => {
  const { exit } = await runEffect(
    collectQuery(ITEMS, { libraries: [], group: "attachments" }),
  );
  if (exit._tag !== "Failure") throw new Error("Expected a request Fault");
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None") throw Cause.squash(exit.cause);
  expect(error.value).toMatchObject({ code: "invalid-group" });
  const { diagnostic } = error.value as unknown as {
    diagnostic: { hint: string; suggestions: string[] };
  };
  expect(diagnostic.hint).toContain("group='attachments[].<field>'");
  expect(diagnostic.suggestions).toContain("group='attachments[].fileType'");
  expect(diagnostic.suggestions).toContain("group='attachments[].contentType'");
});

it("rejects a group path with two [] and names the one-[] rule", async () => {
  const { exit } = await runEffect(
    collectQuery(ITEMS, { libraries: [], group: "attachments[].tags[]" }),
  );
  if (exit._tag !== "Failure") throw new Error("Expected a request Fault");
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None") throw Cause.squash(exit.cause);
  expect(error.value).toMatchObject({
    code: "invalid-group",
    diagnostic: { found: "2 []", expected: ["one []"] },
  });
});

// Failure modes: many elements on one paper bypass the parent cap, a budget
// grows with match count, or an incomplete candidate set changes the result.
it.each([3_000, 10_000])(
  "bounds Relation List candidate statements with %i elements on one paper",
  async (count) => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, count);
    seedBulkAttachments(scenario.sqlite, count);
    seedBulkAnnotations(scenario.sqlite, count);
    scenario.sqlite.exec(`
    update itemAttachments set parentItemID = (select itemID from items where key = 'BLK22222')
    where itemID in (select itemID from items where libraryID = 3);
    insert into itemTags (itemID, tagID, type)
    select itemID, (select tagID from tags where name = 'bulk'), 0
    from items where libraryID = 3 and itemTypeID in
      (select itemTypeID from itemTypesCombined where typeName in ('attachment', 'annotation'));
  `);
    for (const [dataset, relation] of [
      [ITEMS, "annotations"],
      [ITEMS, "attachments"],
      [ATTACHMENTS, "annotations"],
    ] as const) {
      const query = collectQuery(dataset, {
        libraries: [BULK_LIBRARY],
        fields: [],
        sort: [],
        filter: `${relation}.filter(value.tags.contains("bulk")).length > 0`,
      });
      const actual = await runEffect(query, { client: scenario.db });
      const scan = await runEffect(query, {
        client: scenario.db,
        tuning: { forceScan: true },
      });
      expect(actual.exit).toEqual(scan.exit);
      expect(actual.exit).toMatchObject({
        _tag: "Success",
        value: { returnedCount: 1 },
      });
      const statements = actual.events.filter(
        (event) =>
          event.type === "statement" &&
          event.statement.reader.endsWith("candidate-set"),
      );
      expect(statements).toHaveLength(12);
    }
  },
);
