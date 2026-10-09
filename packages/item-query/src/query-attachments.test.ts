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
  expect(exit.value.rows.map((row) => row.indexedKey)).toEqual([
    "PDF2LINK",
    "PDF2LIVE",
  ]);
  expect(exit.value.rows[1]).toEqual({
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
  expect(exit.value.rows.map((row) => row.indexedKey)).toEqual([
    "PDF2LINK",
    "PDF2LIVE",
    "URL2LIVE",
    "WEB2LIVE",
  ]);
  const rows = Object.fromEntries(
    exit.value.rows.map((row) => [row.indexedKey, row.values]),
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
  expect(broken.exit.value.rows).toEqual([
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
  expect(urls.exit.value.rows[0]?.values).toEqual({
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
  expect(sorted.exit.value.rows.map((row) => row.indexedKey)).toEqual([
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
  expect(exit.value.rows.map((row) => row.indexedKey)).toEqual(keys);
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
  expect(exit.value.rows).toEqual([
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
