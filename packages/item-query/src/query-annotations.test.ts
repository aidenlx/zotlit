import { Cause, Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import {
  ANNOTATIONS,
  AttachmentFileResolver,
  collectQuery,
  consumeQuery,
} from ".";
import type { ItemQueryRequest } from ".";
import { ANNOTATION_SCENARIO_QUERIES } from "./annotation-scenario-queries";
import { ItemQueryError } from "./error";
import type { RunOptions } from "./test-helpers";
import { runEffect } from "./test-helpers";

it("projects every parent creator and Annotation Tag with []", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ANNOTATIONS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter: 'attachment.indexedKey == "PDF2LIVE" && type == "underline"',
      fields: ["item.creators[].fullName", "tags[]"],
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  expect(exit.value.rows!).toEqual([
    {
      indexedKey: "ANN2UNDR",
      attachmentIndexedKey: "PDF2LIVE",
      itemIndexedKey: "ART2FULL",
      values: {
        "item.creators[].fullName": [
          "Ada Lovelace",
          "World Health Organization",
        ],
        "tags[]": ["method"],
      },
    },
  ]);
});

it("returns the reading record of one Item, with three identities and default fields", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ANNOTATIONS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter: 'item.indexedKey == "ART2FULL"',
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  expect(exit.value.returnedCount).toBe(12);
  expect(exit.value.rows!.map((row) => row.indexedKey)).toEqual([
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
  expect(new Set(exit.value.rows!.map((row) => row.values.type))).toEqual(
    new Set(["highlight", "underline", "note", "image", "ink", "text"]),
  );
  expect(exit.value.rows![2]?.values.colorName).toBeNull();
  expect(exit.value.rows![10]).toMatchObject({
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
  expect(exit.value.rows![1]?.values.pageIndex).toBeNull();
  for (const row of exit.value.rows!)
    expect(row.values).not.toHaveProperty("position");
});

it("filters and projects the Library selector of Annotations with the same bare key", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  scenario.sqlite
    .prepare(
      "update items set key = 'ANN2HGHT' where key = 'ANN2GRUP' and libraryID = ?",
    )
    .run(SCENARIO_LIBRARIES.group.libraryID);
  const request = {
    libraries: [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group],
    fields: ["library", "item.library"],
    sort: [],
  };
  const query = async (filter?: string) => {
    const { exit } = await runEffect(
      collectQuery(ANNOTATIONS, { ...request, ...(filter && { filter }) }),
      { client: scenario.db },
    );
    if (exit._tag === "Failure") throw new Error(String(exit.cause));
    return exit.value.rows!;
  };
  for (const [filter, expected] of [
    ['indexedKey == "ANN2HGHT"', ["ANN2HGHT"]],
    ['indexedKey == "ANN2HGHTg4815"', ["ANN2HGHTg4815"]],
    ['key == "ANN2HGHT"', ["ANN2HGHT", "ANN2HGHTg4815"]],
  ] as const) {
    const selected = await query(filter);
    expect(selected.map((row) => row.indexedKey)).toEqual(expected);
    const { exit } = await runEffect(
      collectQuery(ANNOTATIONS, { ...request, filter }),
      { client: scenario.db, tuning: { forceScan: true } },
    );
    if (exit._tag === "Failure") throw new Error(String(exit.cause));
    expect(exit.value.rows!).toEqual(selected);
  }
  const rows = await query();
  expect(rows.find((row) => row.indexedKey === "ANN2HGHT")?.values).toEqual({
    library: "personal",
    "item.library": "personal",
  });
  expect(
    rows.find((row) => row.indexedKey === "ANN2HGHTg4815")?.values,
  ).toEqual({ library: "group:4815", "item.library": "group:4815" });
  const personalRows = await query('library == "personal"');
  expect(personalRows).toHaveLength(rows.length - 1);
  expect(new Set(personalRows.map((row) => row.values.library))).toEqual(
    new Set(["personal"]),
  );
  for (const filter of ['library != "personal"', 'library == "group:4815"']) {
    expect(await query(filter)).toEqual([
      {
        indexedKey: "ANN2HGHTg4815",
        attachmentIndexedKey: "PDF2GRUPg4815",
        itemIndexedKey: "ART2FULLg4815",
        values: { library: "group:4815", "item.library": "group:4815" },
      },
    ]);
  }
});

it("projects each PDF position kind and preserves an unknown stored position", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ANNOTATIONS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter: '["PDF2LIVE", "PDF2LINK"].contains(attachment.indexedKey)',
      fields: ["position"],
      limit: null,
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  const positions = Object.fromEntries(
    exit.value.rows!.map((row) => [row.indexedKey, row.values.position]),
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
  const found = await runEffect(collectQuery(ANNOTATIONS, request), {
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
  const scanned = await runEffect(collectQuery(ANNOTATIONS, request), {
    client: scenario.db,
    tuning: { forceScan: true },
  });
  expect(scanned.exit).toEqual(found.exit);
});

it("combines Annotation fields with parent dates, Tags, and projections", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ANNOTATIONS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter:
        'type == "underline" && tags.contains("method") && item.title.contains("Exact Matching") && item.date.year == 2020',
      fields: ["item.title", "item.date.year", "item.tags"],
      sort: [{ field: "pageIndex", direction: "asc" }],
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  expect(exit.value.rows!.map((row) => row.indexedKey)).toEqual(["ANN2UNDR"]);
  expect(exit.value.rows![0]?.values["item.date.year"]).toBe(2020);
});

it("reads parent custom fields, relations, timestamps and identities through their Item semantics", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ANNOTATIONS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter:
        'item.indexedKey == "ART2FULL" && item.custom["review.status"] == "done" && item.mood == "calm" && item.tags.contains("methods") && item.collections.within("Thesis") && item.dateModified.year == 2024',
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
  expect(exit.value.rows![0]?.values).toMatchObject({
    "item.indexedKey": "ART2FULL",
    'item.custom["review.status"]': "done",
    "item.creators[0].family": "Lovelace",
  });
  expect(
    JSON.parse(
      JSON.stringify(exit.value.rows![0]?.values["item.dateModified"]),
    ),
  ).toBe("2024-06-01T10:00:00Z");
});

describe("Annotation parity with the forced scan", () => {
  let scenario: ScenarioDatabase;

  beforeAll(() => {
    scenario = openScenarioDatabase({ annotations: true });
  });
  afterAll(() => scenario.close());

  describe.each([
    { name: "personal", libraries: [SCENARIO_LIBRARIES.personal] },
    { name: "group", libraries: [SCENARIO_LIBRARIES.group] },
    {
      name: "both Libraries",
      libraries: [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group],
    },
  ])("$name", ({ libraries }) => {
    it.each(ANNOTATION_SCENARIO_QUERIES)("request %# %j", async (request) => {
      const run = async (tuning: RunOptions["tuning"]) => {
        const { exit } = await runEffect(
          collectQuery(ANNOTATIONS, { ...request, libraries }),
          { client: scenario.db, tuning },
        );
        if (exit._tag === "Success")
          return JSON.parse(JSON.stringify({ result: exit.value }));
        const failure = Cause.findErrorOption(exit.cause);
        if (failure._tag === "None") throw new Error(String(exit.cause));
        return JSON.parse(
          JSON.stringify({
            failure: Object.assign({}, failure.value, {
              message: failure.value.message,
            }),
          }),
        );
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
    });
  });
});

it("caps after parent expansion and uses a bounded Annotation candidate when available", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const run = (filter: string, capRatio: number) =>
    runEffect(
      collectQuery(ANNOTATIONS, {
        libraries: [SCENARIO_LIBRARIES.personal],
        filter,
        fields: [],
      }),
      { client: scenario.db, tuning: { capRatio } },
    );
  const overflow = await run('item.key == "ART2FULL"', 0.25);
  expect(overflow.exit).toMatchObject({
    _tag: "Success",
    value: { returnedCount: 12 },
  });
  const candidateReads = overflow.events.filter(
    (event) =>
      event.type === "statement" &&
      event.statement.reader === "parent-child-candidate-set",
  );
  expect(candidateReads).toHaveLength(1);
  expect(candidateReads[0]).toMatchObject({
    statement: { rows: expect.any(Array) },
  });
  expect(
    overflow.events.some(
      (event) =>
        event.type === "statement" &&
        event.statement.reader === "annotation-scan-page",
    ),
  ).toBe(true);
  const bounded = await run('type == "image"', 1);
  expect(bounded.exit).toMatchObject({
    _tag: "Success",
    value: { returnedCount: 2 },
  });
  expect(
    bounded.events.some(
      (event) =>
        event.type === "statement" &&
        event.statement.reader === "annotation-candidate-set",
    ),
  ).toBe(true);
  expect(
    bounded.events.some(
      (event) =>
        event.type === "statement" &&
        event.statement.reader === "annotation-scan-page",
    ),
  ).toBe(false);
});

it.each(["asc", "desc"] as const)(
  "keeps missing pages last and uses Sort Index then Indexed Key for a %s page sort",
  async (direction) => {
    using scenario = openScenarioDatabase({ annotations: true });
    const { exit } = await runEffect(
      collectQuery(ANNOTATIONS, {
        libraries: [SCENARIO_LIBRARIES.personal],
        filter: '["PDF2LIVE", "PDF2LINK"].contains(attachment.indexedKey)',
        fields: [],
        sort: [{ field: "pageIndex", direction }],
      }),
      { client: scenario.db },
    );
    if (exit._tag === "Failure") throw new Error(String(exit.cause));
    expect(exit.value.rows!.map((row) => row.indexedKey)).toEqual([
      "ANN2HGHT",
      "ANN2LINK",
      "ANN2NOTE",
      "ANL2IMAG",
      "ANN2IMAG",
      "ANL2INK2",
      "ANN2INK2",
      "ANL2UNDR",
      "ANN2UNDR",
      "ANL2TEXT",
      "ANN2TEXT",
      "ANN2BAD2",
    ]);
  },
);

it("reports a never-true comparison before returning an empty Annotation result", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ANNOTATIONS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter: 'tags == "figure"',
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  expect(exit.value).toMatchObject({
    returnedCount: 0,
    rows: [],
    warnings: [
      {
        code: "never-true",
        severity: "warning",
        suggestions: ['tags.contains("figure")'],
      },
    ],
  });
});

it("corrects a dotted parent custom field with the source spelling and item prefix", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const filter = 'item.review.status == "done"';
  const { exit } = await runEffect(
    collectQuery(ANNOTATIONS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter,
    }),
    { client: scenario.db },
  );
  if (exit._tag !== "Failure") throw new Error("Expected failure");
  const error = Cause.squash(exit.cause);
  if (!(error instanceof ItemQueryError)) throw error;
  expect(error.fault).toMatchObject({
    kind: "unknown",
    role: "custom-field",
    name: "review.status",
    dotted: true,
  });
  expect(error.diagnostic).toMatchObject({
    code: "unknown-field",
    excerpt: { at: "item.review.status" },
    suggestions: ['item.custom["review.status"]'],
  });
});

it("warns on definite cross-type inequality while preserving every evaluated match", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const request = { libraries: [SCENARIO_LIBRARIES.personal], fields: [] };
  const all = await runEffect(collectQuery(ANNOTATIONS, request), {
    client: scenario.db,
  });
  const comparison = await runEffect(
    collectQuery(ANNOTATIONS, { ...request, filter: 'tags != "figure"' }),
    { client: scenario.db },
  );
  if (all.exit._tag === "Failure" || comparison.exit._tag === "Failure")
    throw new Error("Expected success");
  expect(comparison.exit.value.rows!).toEqual(all.exit.value.rows!);
  expect(comparison.exit.value.warnings).toMatchObject([
    { code: "always-true", suggestions: ['!tags.contains("figure")'] },
  ]);
});

/** The readers of the scan pass and of the projection pass, in order. */
async function passReaders(
  request: Omit<ItemQueryRequest, "libraries">,
  resolve: (indexedKey: string) => void = () => {},
) {
  using scenario = openScenarioDatabase({ annotations: true });
  const scan: string[] = [];
  const projection: string[] = [];
  let projecting = false;
  const { exit } = await runEffect(
    Effect.provideService(
      consumeQuery(
        ANNOTATIONS,
        { libraries: [SCENARIO_LIBRARIES.personal], ...request },
        () =>
          Effect.sync(() => {
            projecting = true;
            return { write: () => Effect.void, end: () => Effect.void };
          }),
      ),
      AttachmentFileResolver,
      (attachment) =>
        Effect.sync(() => {
          resolve(attachment.indexedKey);
          return { path: "/file.pdf", exists: true };
        }),
    ),
    {
      client: scenario.db,
      onEvent: (event) => {
        if (event.type !== "statement") return;
        const { reader } = event.statement;
        if (reader === "layout" || reader === "field-vocabulary") return;
        (projecting ? projection : scan).push(reader);
      },
    },
  );
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  return { scan, projection };
}

describe("the statements of each pass", () => {
  it("runs no hydrate statement in the scan pass of an unfiltered query in the default order", async () => {
    const { scan } = await passReaders({});
    expect(scan).toEqual(["annotation-scan-page"]);
  });

  it("loads the Annotation Tags and nothing else in the scan pass of a Tag filter", async () => {
    const { scan } = await passReaders({
      filter: 'tags.contains("method")',
      fields: [],
    });
    // The Tag candidate set is above the cap of the Library: the scan reads it.
    expect(scan).toEqual([
      "annotation-row-count",
      "annotation-candidate-set",
      "annotation-candidate-set",
      "annotation-scan-page",
      "annotation-tags",
    ]);
  });

  it("loads the details of a text projection in the projection pass only", async () => {
    const { scan, projection } = await passReaders({ fields: ["text"] });
    expect(scan).toEqual(["annotation-scan-page"]);
    expect(projection).toEqual(["annotation-details"]);
  });

  it("loads the parent fields of a parent projection through the Item hydration", async () => {
    const { scan, projection } = await passReaders({ fields: ["item.title"] });
    expect(scan).toEqual(["annotation-scan-page"]);
    expect(projection).toEqual(["hydrate-chunk"]);
  });

  it("loads the Attachment title through the shared Attachment reader", async () => {
    const { projection } = await passReaders({ fields: ["attachment.title"] });
    expect(projection).toEqual(["attachment-details"]);
  });

  it("resolves the Attachment file of each returned row in the projection pass only", async () => {
    const resolved: string[] = [];
    const sorted = await passReaders(
      {
        fields: ["attachment.path"],
        sort: [{ field: "pageIndex", direction: "asc" }],
        limit: 2,
      },
      (key) => resolved.push(key),
    );
    expect(sorted.scan).toEqual(["annotation-scan-page", "annotation-details"]);
    expect(sorted.projection).toEqual(["attachment-details"]);
    expect(resolved).toHaveLength(2);
    const none: string[] = [];
    await passReaders({ fields: ["text"] }, (key) => none.push(key));
    expect(none).toEqual([]);
  });
});

// Failure modes: selecting the wrong parent, crossing Library scope, or dropping
// a warning when another branch matches. Each request also runs as a forced scan.
it.each([
  ['indexedKey == "ANN2HGHT"', ["ANN2HGHT"]],
  ['indexedKey == "ANN2GRUPg4815"', ["ANN2GRUPg4815"]],
  [
    '["ANN2HGHT", "ANN2GRUPg4815"].contains(indexedKey)',
    ["ANN2GRUPg4815", "ANN2HGHT"],
  ],
  ['item.indexedKey == "ART2FULLg4815"', ["ANN2GRUPg4815"]],
  ['attachment.indexedKey == "PDF2GRUPg4815"', ["ANN2GRUPg4815"]],
  ['["ART2FULLg4815"].contains(item.indexedKey)', ["ANN2GRUPg4815"]],
  ['["PDF2GRUPg4815"].contains(attachment.indexedKey)', ["ANN2GRUPg4815"]],
] as const)(
  "selects Annotations across two Libraries with %s",
  async (filter, expected) => {
    using scenario = openScenarioDatabase({ annotations: true });
    for (const forceScan of [false, true]) {
      const { exit } = await runEffect(
        collectQuery(ANNOTATIONS, {
          libraries: [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group],
          filter,
          fields: [],
          sort: [],
        }),
        { client: scenario.db, tuning: { forceScan } },
      );
      if (exit._tag === "Failure") throw new Error(String(exit.cause));
      expect(exit.value.rows!.map((row) => row.indexedKey).toSorted()).toEqual(
        expected,
      );
      expect(exit.value.warnings).toEqual([]);
    }
  },
);
it.each(["indexedKey", "item.indexedKey", "attachment.indexedKey"])(
  "keeps Target Libraries and warns for %s selections",
  async (field) => {
    using scenario = openScenarioDatabase({ annotations: true });
    const key =
      field === "indexedKey"
        ? "ANN2GRUPg4815"
        : field === "item.indexedKey"
          ? "ART2FULLg4815"
          : "PDF2GRUPg4815";
    for (const matching of [false, true]) {
      const request = {
        libraries: [SCENARIO_LIBRARIES.personal],
        filter: `${field} == "${key}"${matching ? ' || indexedKey == "ANN2HGHT"' : ""}`,
        fields: [],
      };
      for (const forceScan of [false, true]) {
        const { exit } = await runEffect(collectQuery(ANNOTATIONS, request), {
          client: scenario.db,
          tuning: { forceScan },
        });
        if (exit._tag === "Failure") throw new Error(String(exit.cause));
        expect(exit.value.rows!.map((row) => row.indexedKey)).toEqual(
          matching ? ["ANN2HGHT"] : [],
        );
        expect(exit.value.warnings).toMatchObject([
          {
            code: "key-outside-target-libraries",
            found: key,
            expected: ["group:4815"],
            suggestions: ["library=personal,group:4815"],
          },
        ]);
      }
    }
  },
);

// A bare Indexed Key names My Library even when only the group is read.
it.each(["indexedKey", "item.indexedKey", "attachment.indexedKey"])(
  "warns for a bare %s in a group-only list selection",
  async (field) => {
    using scenario = openScenarioDatabase({ annotations: true });
    const key =
      field === "indexedKey"
        ? "ANN2GRUP"
        : field === "item.indexedKey"
          ? "ART2FULL"
          : "PDF2GRUP";
    for (const forceScan of [false, true]) {
      const { exit } = await runEffect(
        collectQuery(ANNOTATIONS, {
          libraries: [SCENARIO_LIBRARIES.group],
          filter: `["${key}", "${key}g4815"].contains(${field})`,
          fields: [],
        }),
        { client: scenario.db, tuning: { forceScan } },
      );
      if (exit._tag === "Failure") throw new Error(String(exit.cause));
      expect(exit.value.rows!.map((row) => row.indexedKey)).toEqual([
        "ANN2GRUPg4815",
      ]);
      expect(exit.value.warnings).toMatchObject([
        {
          found: key,
          expected: ["personal"],
          suggestions: ["library=group:4815,personal"],
        },
      ]);
    }
  },
);

it("groups marks by a parent scalar with exact counts and the three most recent marks per paper", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ANNOTATIONS, {
      libraries: [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group],
      group: "item.indexedKey",
      fields: [],
      limit: 3,
      sort: [{ field: "dateModified", direction: "desc" }],
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  expect(exit.value).toMatchObject({
    totalCount: 13,
    returnedCount: 4,
    truncated: true,
  });
  expect(
    exit.value.groups?.map(({ value, count, rows }) => [
      value,
      count,
      rows.map((row) => row.indexedKey),
    ]),
  ).toEqual([
    ["ART2FULL", 12, ["ANN2LINK", "ANN2BAD2", "ANN2NOTE"]],
    ["ART2FULLg4815", 1, ["ANN2GRUPg4815"]],
  ]);
  expect(exit.value).not.toHaveProperty("rows");
});

it.each([
  "item.citationKey",
  "item.date.year",
  'item.custom["review.status"]',
  "colorName",
  "library",
])("groups Annotation scalar path %s without a limit", async (group) => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ANNOTATIONS, {
      libraries: [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group],
      group,
      fields: [group],
      limit: null,
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  expect(exit.value).toMatchObject({
    totalCount: 13,
    returnedCount: 13,
    truncated: false,
  });
  for (const bucket of exit.value.groups!) {
    expect(bucket.count).toBe(bucket.rows.length);
    for (const row of bucket.rows)
      expect(row.values[group]).toEqual(bucket.value);
  }
  if (group === "colorName")
    expect(exit.value.groups?.at(-1)?.value).toBeNull();
});

it.each(["tags", "item.tags[]", "item.tags", "attachment"])(
  "rejects an Annotation group path that is not scalar: %s",
  async (group) => {
    const { exit } = await runEffect(
      collectQuery(ANNOTATIONS, { libraries: [], group }),
    );
    if (exit._tag !== "Failure") throw new Error("Expected a request Fault");
    const error = Cause.findErrorOption(exit.cause);
    expect(error._tag === "Some" && error.value).toMatchObject({
      code: "invalid-group",
      location: { argument: "group" },
    });
    if (error._tag === "Some" && error.value instanceof ItemQueryError)
      expect(error.value.diagnostic.report.join("\n")).toContain("scalar");
  },
);

it.each([
  ['attachment.item.collections.within("Thesis")', 12],
  ['attachment.linkMode == "embedded_image"', 6],
  ['attachment.key == "PDF2LINK"', 6],
  ['attachment.indexedKey == "PDF2LINK"', 6],
  ['attachment.title == "linkedAttachment"', 6],
  ['attachment.contentType == "application/pdf"', 12],
  ['attachment.fileType == "pdf"', 12],
  ["attachment.path == null", 12],
  ["attachment.exists == false", 12],
  ['attachment.tags.contains("attachment-method")', 6],
  ['attachment.library == "personal"', 12],
  ["attachment.dateAdded == attachment.dateAdded", 12],
  ["attachment.dateModified == attachment.dateModified", 12],
  ["attachment.annotations.length > 0", 12],
])(
  "keeps Annotation Parent Records outside Attachment Query: %s",
  async (filter, returnedCount) => {
    using scenario = openScenarioDatabase({ annotations: true });
    scenario.sqlite
      .prepare(
        "update itemAttachments set linkMode = 4 where itemID in (select itemID from items where key = 'PDF2LINK')",
      )
      .run();
    const query = collectQuery(ANNOTATIONS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter,
      fields: [],
      sort: [],
    });
    const scan = await runEffect(query, {
      client: scenario.db,
      tuning: { forceScan: true },
    });
    expect(scan.exit).toMatchObject({
      _tag: "Success",
      value: { returnedCount },
    });
    for (const tuning of [
      {},
      { capRatio: 1 },
      { capRatio: 0 },
      { capRatio: 0.1 },
      { capRatio: 1, scanPageSize: 3, hydrateChunkSize: 2 },
      { scanPageSize: 1, hydrateChunkSize: 1, mergeStepSize: 1 },
    ]) {
      const actual = await runEffect(query, { client: scenario.db, tuning });
      expect(actual.exit).toEqual(scan.exit);
    }
  },
);
