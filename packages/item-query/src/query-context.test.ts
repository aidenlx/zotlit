// The Query Context: a caller binds `this` to one Item (and one Attachment),
// and a Filter Expression reads it as `this.item` / `this.attachment`.
import { Cause, Exit } from "effect";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";
import { setLibraryLogSink } from "@zotlit/shared/logging";
import type { LibraryLogRecord } from "@zotlit/shared/logging";

import { ANNOTATIONS, ATTACHMENTS, collectQuery, ITEMS } from ".";
import type { ItemQueryRequest, QueryDataset } from ".";
import { ItemQueryError } from "./error";
import { runEffect } from "./test-helpers";

let scenario: ScenarioDatabase;
beforeAll(() => {
  scenario = openScenarioDatabase({ annotations: true });
});
afterAll(() => scenario.close());

const logs: LibraryLogRecord[] = [];
beforeEach(() => {
  logs.length = 0;
});
beforeAll(() => setLibraryLogSink((record) => logs.push(record)));
afterAll(() => setLibraryLogSink(undefined));

async function run(
  dataset: QueryDataset<any>,
  request: Omit<ItemQueryRequest, "libraries"> &
    Partial<Pick<ItemQueryRequest, "libraries">>,
) {
  const { exit } = await runEffect(
    collectQuery(dataset, {
      libraries: [SCENARIO_LIBRARIES.personal],
      fields: [],
      ...request,
    }),
    // A cap of the whole Library: a key selection plans a candidate set.
    { client: scenario.db, tuning: { capRatio: 1 } },
  );
  return exit;
}

const keys = (
  exit: Exit.Exit<{ rows?: readonly { indexedKey: string }[] }, unknown>,
) => {
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
  return exit.value.rows!.map((row) => row.indexedKey);
};

it("selects the Annotations of the bound Item with item == this.item, on a candidate set", async () => {
  const literal = keys(
    await run(ANNOTATIONS, { filter: 'item.indexedKey == "ART2FULL"' }),
  );
  expect(logs.at(-1)?.properties).toMatchObject({ plan: "candidates" });
  logs.length = 0;
  const bound = keys(
    await run(ANNOTATIONS, {
      filter: "item == this.item",
      context: { item: "ART2FULL" },
    }),
  );
  expect(bound).toHaveLength(12);
  expect(bound).toEqual(literal);
  expect(logs.at(-1)?.properties).toMatchObject({ plan: "candidates" });
});

it("selects the Attachments of the bound Item with item == this.item", async () => {
  const bound = keys(
    await run(ATTACHMENTS, {
      libraries: [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group],
      filter: "this.item == item",
      context: { item: "ART2FULLg4815" },
    }),
  );
  expect(bound).toEqual(["PDF2GRUPg4815"]);
  expect(logs.at(-1)?.properties).toMatchObject({ plan: "candidates" });
});

it("selects the bound Item with indexedKey == this.item.indexedKey", async () => {
  const bound = keys(
    await run(ITEMS, {
      filter: "indexedKey == this.item.indexedKey",
      context: { item: "ART2FULL" },
    }),
  );
  expect(bound).toEqual(["ART2FULL"]);
  expect(logs.at(-1)?.properties).toMatchObject({ plan: "candidates" });
});

it("selects the Annotations of the bound Attachment with attachment == this.attachment", async () => {
  const bound = keys(
    await run(ANNOTATIONS, {
      filter: 'attachment == this.attachment && type == "underline"',
      context: { item: "ART2FULL", attachment: "PDF2LIVE" },
    }),
  );
  expect(bound).toEqual(["ANN2UNDR"]);
});

it("keeps != on a bound record: every Annotation of another Item", async () => {
  const all = keys(await run(ANNOTATIONS, {}));
  const others = keys(
    await run(ANNOTATIONS, {
      filter: "item != this.item",
      context: { item: "ART2FULL" },
    }),
  );
  expect(others).toHaveLength(all.length - 12);
});

it("echoes the Query Context in the normalized query", async () => {
  const exit = await run(ANNOTATIONS, {
    filter: "item == this.item",
    context: { item: "ART2FULL" },
  });
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
  expect(exit.value.query.context).toEqual({ item: "ART2FULL" });
});

it("warns when the bound Item's Library is not a Target Library", async () => {
  const exit = await run(ANNOTATIONS, {
    filter: "item == this.item",
    context: { item: "ART2FULLg4815" },
  });
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
  expect(exit.value.rows).toEqual([]);
  expect(exit.value.warnings).toMatchObject([
    {
      code: "key-outside-target-libraries",
      found: "ART2FULLg4815",
      expected: ["group:4815"],
      location: { argument: "filter", span: { from: 8, to: 17 } },
    },
  ]);
});

it("keeps the correction of a warning in a filter that reads this", async () => {
  const exit = await run(ANNOTATIONS, {
    filter: 'item == this.item && tags == "method"',
    context: { item: "ART2FULL" },
  });
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
  expect(exit.value.warnings[0]?.hint).toBe(
    'Try: item == this.item && tags.contains("method")',
  );
});

it("keeps the correction of an error in a filter that reads this", async () => {
  const diagnostic = failure(
    await run(ANNOTATIONS, {
      filter: "item == this.item && text.matches(/re/)",
      context: { item: "ART2FULL" },
    }),
  );
  expect(diagnostic.suggestions).toEqual([
    "item == this.item && /re/.matches(text)",
  ]);
});

function failure(exit: Exit.Exit<unknown, unknown>) {
  const error = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : null;
  if (error?._tag !== "Some" || !(error.value instanceof ItemQueryError))
    throw new Error("Expected an Item Query fault");
  return error.value.diagnostic;
}

it.each([
  [ANNOTATIONS, "item == this.item"],
  [ATTACHMENTS, "item == this.item"],
  [ITEMS, "indexedKey == this.item.indexedKey"],
] as const)(
  "names this.item when %# reads it with nothing bound",
  async (dataset, filter) => {
    const diagnostic = failure(await run(dataset, { filter }));
    const from = filter.indexOf("this");
    expect(diagnostic).toMatchObject({
      code: "unbound-context",
      location: { argument: "filter", span: { from, to: from + 9 } },
    });
    expect(diagnostic.message).toContain("this.item");
  },
);

it("names this.attachment when only the Item is bound", async () => {
  const diagnostic = failure(
    await run(ANNOTATIONS, {
      filter: "attachment == this.attachment",
      context: { item: "ART2FULL" },
    }),
  );
  expect(diagnostic.code).toBe("unbound-context");
  expect(diagnostic.message).toContain("this.attachment");
});

it("rejects a bound value that is not an Indexed Key", async () => {
  const diagnostic = failure(
    await run(ANNOTATIONS, {
      filter: "item == this.item",
      context: { item: "not a key" },
    }),
  );
  expect(diagnostic).toMatchObject({
    code: "invalid-context",
    location: { argument: "context", path: "context.item" },
  });
});

it.each([
  ["this", "unbound-context", undefined],
  ["this.note", "unknown-property", { item: "ART2FULL" }],
  ["this.item.title", "unknown-property", { item: "ART2FULL" }],
] as const)("fails %s with %s", async (filter, code, context) => {
  const diagnostic = failure(
    await run(ANNOTATIONS, { filter, ...(context && { context }) }),
  );
  expect(diagnostic.code).toBe(code);
});
