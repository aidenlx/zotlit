import { Cause, Effect } from "effect";
import { expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";

import type { ItemQueryRequest } from ".";
import { ATTACHMENTS, AttachmentFileResolver, collectQuery } from ".";
import { runEffect } from "./test-helpers";

it("returns the files of one paper with Attachment defaults and parent identity", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ATTACHMENTS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter: 'item.key == "ART2FULL" && contentType == "application/pdf"',
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  expect(exit.value.rows!.map((row) => row.indexedKey)).toEqual([
    "PDF2LINK",
    "PDF2LIVE",
  ]);
  expect(exit.value.rows![1]).toEqual({
    indexedKey: "PDF2LIVE",
    itemIndexedKey: "ART2FULL",
    values: {
      title: "Full Text PDF",
      contentType: "application/pdf",
      linkMode: "imported_file",
      path: null,
      exists: false,
      "item.title": "Exact Matching in Literature Review",
      "item.citationKey": null,
    },
  });
});

it("projects all four link modes, null file rules, Tags, and parent fields", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ATTACHMENTS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      fields: [
        "key",
        "indexedKey",
        "library",
        "title",
        "contentType",
        "linkMode",
        "url",
        "path",
        "exists",
        "tags",
        'item.custom["review.status"]',
        "item.collections",
        "item.creators[].fullName",
      ],
      sort: [],
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  expect(exit.value.rows!.map((row) => row.indexedKey)).toEqual([
    "PDF2LINK",
    "PDF2LIVE",
    "URL2LIVE",
    "WEB2LIVE",
  ]);
  const rows = Object.fromEntries(
    exit.value.rows!.map((row) => [row.indexedKey, row.values]),
  );
  expect(rows.PDF2LINK).toMatchObject({
    linkMode: "linked_file",
    url: null,
    tags: ["attachment-method"],
  });
  expect(rows.PDF2LIVE).toMatchObject({
    linkMode: "imported_file",
    url: null,
    'item.custom["review.status"]': "done",
    "item.collections": ["Thesis/Methods"],
    "item.creators[].fullName": ["Ada Lovelace", "World Health Organization"],
  });
  expect(rows.URL2LIVE).toMatchObject({
    linkMode: "linked_url",
    url: "https://example.org/paper",
    path: null,
    exists: false,
  });
  expect(rows.WEB2LIVE).toMatchObject({
    linkMode: "imported_url",
    url: "https://example.org/snapshot",
  });
});

it("reads only the requested relations and resolves files only for path or exists", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const resolved: string[] = [];
  const query = (fields: string[], filter?: string) =>
    runEffect(
      collectQuery(ATTACHMENTS, {
        libraries: [SCENARIO_LIBRARIES.personal],
        fields,
        ...(filter && { filter }),
      }).pipe(
        Effect.provideService(AttachmentFileResolver, (attachment) =>
          Effect.sync(() => {
            resolved.push(attachment.key);
            return {
              path:
                attachment.key === "PDF2LINK" ? "/missing.pdf" : "/paper.pdf",
              exists: attachment.key !== "PDF2LINK",
            };
          }),
        ),
      ),
      { client: scenario.db },
    );
  const bare = await query(["key", "library"]);
  expect(bare.exit._tag).toBe("Success");
  expect(resolved).toEqual([]);
  expect(
    bare.events
      .filter((event) => event.type === "statement")
      .map((event) => event.statement.reader),
  ).not.toContain("attachment-details");
  for (const fields of [["title"], ["tags"], ["item.title"]]) {
    const run = await query(fields);
    const readers = run.events.flatMap((event) =>
      event.type === "statement" ? [event.statement.reader] : [],
    );
    expect(readers.includes("attachment-tags")).toBe(fields[0] === "tags");
    expect(readers.includes("hydrate-chunk")).toBe(fields[0] === "item.title");
  }
  expect(resolved).toEqual([]);
  const broken = await query(
    ["title", "path", "exists"],
    'linkMode == "linked_file" && !exists',
  );
  if (broken.exit._tag === "Failure")
    throw new Error(String(broken.exit.cause));
  expect(broken.exit.value.rows!).toEqual([
    {
      indexedKey: "PDF2LINK",
      itemIndexedKey: "ART2FULL",
      values: {
        title: "linkedAttachment",
        path: "/missing.pdf",
        exists: false,
      },
    },
  ]);
  resolved.length = 0;
  const urls = await query(
    ["path", "exists", "url"],
    'linkMode == "linked_url"',
  );
  if (urls.exit._tag === "Failure") throw new Error(String(urls.exit.cause));
  expect(urls.exit.value.rows![0]?.values).toEqual({
    path: null,
    exists: false,
    url: "https://example.org/paper",
  });
  expect(resolved).toEqual([]);
});

it("sorts parent scalar fields and rejects a file path sort", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const run = (sort: ItemQueryRequest["sort"]) =>
    runEffect(
      collectQuery(ATTACHMENTS, {
        libraries: [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group],
        sort,
        fields: [],
      }),
      { client: scenario.db },
    );
  const sorted = await run([
    { field: "item.date", direction: "desc" },
    { field: "title", direction: "asc" },
  ]);
  if (sorted.exit._tag === "Failure")
    throw new Error(String(sorted.exit.cause));
  expect(sorted.exit.value.rows!.map((row) => row.indexedKey)).toEqual([
    "PDF2LIVE",
    "PDF2GRUPg4815",
    "PDF2LINK",
    "URL2LIVE",
    "WEB2LIVE",
  ]);
  const rejected = await run([{ field: "path", direction: "asc" }]);
  expect(rejected.exit._tag).toBe("Failure");
  if (rejected.exit._tag === "Failure")
    expect(Cause.findErrorOption(rejected.exit.cause)).toMatchObject({
      value: { code: "unsortable-field" },
    });
});

it.each([
  ['key == "PDF2LIVE"', ["PDF2LIVE"]],
  ['indexedKey == "PDF2LINK"', ["PDF2LINK"]],
  ['library == "personal" && title == "linkedAttachment"', ["PDF2LINK"]],
  ['contentType == "text/html"', ["URL2LIVE", "WEB2LIVE"]],
  ['linkMode == "imported_url"', ["WEB2LIVE"]],
  ['url == "https://example.org/paper"', ["URL2LIVE"]],
  ['tags.contains("attachment-method")', ["PDF2LINK"]],
  ["dateAdded.year == 2020", ["PDF2LIVE"]],
  ["dateModified.year == 2020", ["PDF2LIVE"]],
  [
    'item.indexedKey == "ART2FULL" && item.collections.contains("Thesis/Methods")',
    ["PDF2LINK", "PDF2LIVE", "URL2LIVE", "WEB2LIVE"],
  ],
] as const)("filters Attachment fields: %s", async (filter, keys) => {
  using scenario = openScenarioDatabase({ annotations: true });
  const { exit } = await runEffect(
    collectQuery(ATTACHMENTS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter,
      fields: [],
      sort: [],
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  expect(exit.value.rows!.map((row) => row.indexedKey)).toEqual(keys);
});

it("keeps the Library and parent identity of the same Attachment key in two Libraries", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  scenario.sqlite
    .prepare("update items set key = 'PDF2LIVE' where key = 'PDF2GRUP'")
    .run();
  const { exit } = await runEffect(
    collectQuery(ATTACHMENTS, {
      libraries: [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group],
      filter: 'key == "PDF2LIVE"',
      fields: ["library", "item.library"],
      sort: [],
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  expect(exit.value.rows!).toEqual([
    {
      indexedKey: "PDF2LIVE",
      itemIndexedKey: "ART2FULL",
      values: { library: "personal", "item.library": "personal" },
    },
    {
      indexedKey: "PDF2LIVEg4815",
      itemIndexedKey: "ART2FULLg4815",
      values: { library: "group:4815", "item.library": "group:4815" },
    },
  ]);
});

// Failure modes: selecting the wrong Library or parent, losing list members,
// widening scope, dropping warnings on a matching branch, and scan fallback.
it.each([
  ['indexedKey == "PDF2LIVE"', ["PDF2LIVE"]],
  ['"PDF2GRUPg4815" == indexedKey', ["PDF2GRUPg4815"]],
  [
    '["PDF2LIVE", "PDF2GRUPg4815"].contains(indexedKey)',
    ["PDF2GRUPg4815", "PDF2LIVE"],
  ],
  ['item.indexedKey == "ART2FULLg4815"', ["PDF2GRUPg4815"]],
  ['["ART2FULLg4815"].contains(item.indexedKey)', ["PDF2GRUPg4815"]],
] as const)(
  "selects Attachments across two Libraries with %s",
  async (filter, expected) => {
    using scenario = openScenarioDatabase({ annotations: true });
    for (const forceScan of [false, true]) {
      const { exit, events } = await runEffect(
        collectQuery(ATTACHMENTS, {
          libraries: [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group],
          filter,
          fields: [],
          sort: [],
        }),
        { client: scenario.db, tuning: { forceScan, capRatio: 1 } },
      );
      if (exit._tag === "Failure") throw new Error(String(exit.cause));
      expect(exit.value.rows!.map((row) => row.indexedKey).toSorted()).toEqual(
        expected,
      );
      expect(exit.value.warnings).toEqual([]);
      expect(
        events.some(
          (event) =>
            event.type === "statement" &&
            event.statement.reader === "attachment-candidate-set",
        ),
      ).toBe(!forceScan);
    }
  },
);

it.each(["indexedKey", "item.indexedKey"])(
  "warns without widening Attachment scope for %s",
  async (field) => {
    using scenario = openScenarioDatabase({ annotations: true });
    const key = field === "indexedKey" ? "PDF2GRUPg4815" : "ART2FULLg4815";
    for (const matching of [false, true]) {
      for (const forceScan of [false, true]) {
        const { exit } = await runEffect(
          collectQuery(ATTACHMENTS, {
            libraries: [SCENARIO_LIBRARIES.personal],
            filter: `${field} == "${key}"${matching ? ' || indexedKey == "PDF2LIVE"' : ""}`,
            fields: [],
          }),
          { client: scenario.db, tuning: { forceScan } },
        );
        if (exit._tag === "Failure") throw new Error(String(exit.cause));
        expect(exit.value.rows!.map((row) => row.indexedKey)).toEqual(
          matching ? ["PDF2LIVE"] : [],
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

it.each(["indexedKey", "item.indexedKey"])(
  "warns for a personal %s in a group-only Attachment list selection",
  async (field) => {
    using scenario = openScenarioDatabase({ annotations: true });
    const key = field === "indexedKey" ? "PDF2GRUP" : "ART2FULL";
    for (const forceScan of [false, true]) {
      const { exit } = await runEffect(
        collectQuery(ATTACHMENTS, {
          libraries: [SCENARIO_LIBRARIES.group],
          filter: `["${key}", "${key}g4815"].contains(${field})`,
          fields: [],
        }),
        { client: scenario.db, tuning: { forceScan } },
      );
      if (exit._tag === "Failure") throw new Error(String(exit.cause));
      expect(exit.value.rows!.map((row) => row.indexedKey)).toEqual([
        "PDF2GRUPg4815",
      ]);
      expect(exit.value.warnings).toMatchObject([
        {
          code: "key-outside-target-libraries",
          found: key,
          expected: ["personal"],
          suggestions: ["library=group:4815,personal"],
        },
      ]);
    }
  },
);

it("caps parent Indexed Key expansion and falls back to the Attachment scan", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const request = {
    libraries: [SCENARIO_LIBRARIES.personal],
    filter: 'item.indexedKey == "ART2FULL"',
    fields: [],
    sort: [],
  };
  const limited = await runEffect(collectQuery(ATTACHMENTS, request), {
    client: scenario.db,
  });
  const scanned = await runEffect(collectQuery(ATTACHMENTS, request), {
    client: scenario.db,
    tuning: { forceScan: true },
  });
  expect(limited.exit).toEqual(scanned.exit);
  if (limited.exit._tag === "Failure")
    throw new Error(String(limited.exit.cause));
  expect(limited.exit.value.returnedCount).toBe(4);
  expect(
    limited.events.some(
      (event) =>
        event.type === "statement" &&
        event.statement.reader === "attachment-scan-page",
    ),
  ).toBe(true);
  const candidate = limited.events.find(
    (event) =>
      event.type === "statement" &&
      event.statement.reader === "attachment-candidate-set",
  );
  expect(candidate).toMatchObject({ statement: { rows: expect.any(Array) } });
  if (candidate?.type === "statement")
    expect(candidate.statement.rows).toHaveLength(2);
});

// Failure modes: counting only returned files, applying a global limit, losing
// a parent's group, or sorting the absent group before a known value.
it("groups Attachments by type and parent Citation Key with null last and per-group limits", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  scenario.sqlite
    .prepare(
      "update itemAttachments set contentType = null where itemID = (select itemID from items where key = 'URL2LIVE')",
    )
    .run();
  const valueID = scenario.sqlite
    .prepare("insert into itemDataValues (value) values ('review2024')")
    .run().lastInsertRowid;
  scenario.sqlite
    .prepare(
      "insert into itemData (itemID, fieldID, valueID) select itemID, (select fieldID from fieldsCombined where fieldName = 'citationKey'), ? from items where key = 'ART2FULL' and libraryID = 1",
    )
    .run(valueID);
  const query = (group: string) =>
    runEffect(
      collectQuery(ATTACHMENTS, {
        libraries: [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group],
        group,
        limit: 1,
        fields: ["contentType", "item.citationKey"],
        sort: [],
      }),
      { client: scenario.db },
    );
  const types = await query("contentType");
  if (types.exit._tag === "Failure") throw new Error(String(types.exit.cause));
  expect(types.exit.value).toMatchObject({
    totalCount: 5,
    returnedCount: 3,
    truncated: true,
  });
  expect(
    types.exit.value.groups!.map(({ value, count, rows }) => [
      value,
      count,
      rows.length,
    ]),
  ).toEqual([
    ["application/pdf", 3, 1],
    ["text/html", 1, 1],
    [null, 1, 1],
  ]);
  const papers = await query("item.citationKey");
  if (papers.exit._tag === "Failure")
    throw new Error(String(papers.exit.cause));
  expect(papers.exit.value).toMatchObject({
    totalCount: 5,
    returnedCount: 2,
    truncated: true,
  });
  expect(
    papers.exit.value.groups!.map(({ value, count, rows }) => [
      value,
      count,
      rows.length,
    ]),
  ).toEqual([
    ["review2024", 4, 1],
    [null, 1, 1],
  ]);
});

// Failure modes: MIME-only classification of web links, missing MIME becoming
// null, unsupported MIME becoming a known type, and filters disagreeing with groups.
it.each([
  ["application/pdf", 0, "pdf"],
  ["application/epub+zip", 0, "epub"],
  ["text/html", 1, "web"],
  ["application/xhtml+xml", 1, "web"],
  ["application/pdf", 3, "web"],
  [null, 3, "web"],
  [null, 0, "other"],
  ["image/png", 0, "other"],
] as const)(
  "classifies Attachment file type %s with link mode %s as %s",
  async (contentType, linkMode, fileType) => {
    using scenario = openScenarioDatabase({ annotations: true });
    scenario.sqlite
      .prepare(
        "update itemAttachments set contentType = ?, linkMode = ? where itemID = (select itemID from items where key = 'PDF2LIVE')",
      )
      .run(contentType, linkMode);
    for (const forceScan of [false, true]) {
      const { exit } = await runEffect(
        collectQuery(ATTACHMENTS, {
          libraries: [SCENARIO_LIBRARIES.personal],
          filter: `fileType == "${fileType}" && key == "PDF2LIVE"`,
          fields: ["fileType"],
          sort: [{ field: "fileType", direction: "asc" }],
          group: "fileType",
        }),
        { client: scenario.db, tuning: { forceScan, capRatio: 1 } },
      );
      if (exit._tag === "Failure") throw new Error(String(exit.cause));
      expect(exit.value.groups).toEqual([
        {
          value: fileType,
          count: 1,
          rows: [
            {
              indexedKey: "PDF2LIVE",
              itemIndexedKey: "ART2FULL",
              values: { fileType },
            },
          ],
        },
      ]);
    }
  },
);

it("groups and sorts Attachment file types in text order", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  scenario.sqlite
    .prepare(
      "update itemAttachments set contentType = 'application/epub+zip' where itemID = (select itemID from items where key = 'PDF2LINK')",
    )
    .run();
  scenario.sqlite
    .prepare(
      "update itemAttachments set contentType = null where itemID = (select itemID from items where key = 'WEB2LIVE')",
    )
    .run();
  for (const group of [undefined, "fileType"]) {
    const { exit } = await runEffect(
      collectQuery(ATTACHMENTS, {
        libraries: [SCENARIO_LIBRARIES.personal],
        fields: ["fileType"],
        sort: [{ field: "fileType", direction: "asc" }],
        ...(group && { group }),
      }),
      { client: scenario.db },
    );
    if (exit._tag === "Failure") throw new Error(String(exit.cause));
    if (group)
      expect(
        exit.value.groups!.map(({ value, count }) => [value, count]),
      ).toEqual([
        ["epub", 1],
        ["other", 1],
        ["pdf", 1],
        ["web", 1],
      ]);
    else
      expect(exit.value.rows!.map((row) => row.values.fileType)).toEqual([
        "epub",
        "other",
        "pdf",
        "web",
      ]);
  }
});
