import type { CliData } from "obsidian";
import { expect } from "vitest";

import { ItemQueryDatabase } from "@zotlit/db/item-query";
import { openScenarioDatabase } from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { CliRejection } from "@/lib/cli-params";
import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";
import type { LibraryScope } from "@/services/library-scope/scope";
import { MY_LIBRARY_SCOPE } from "@/services/library-scope/scope";

import { answer } from "./answer";
import { decodeValues } from "./decode";

const identity = {
  vault: { name: "Research", path: "/vaults/research" },
  source: { id: "source-1", databasePath: "/zotero/zotero.sqlite" },
};

it.effect("decodes the required kind and query defaults as plain JSON", () =>
  Effect.gen(function* () {
    expect(yield* decodeValues({ kind: "collections" })).toEqual({
      kind: "collections",
      libraries: null,
      limit: 100,
    });
    expect(
      yield* decodeValues({
        kind: "tags",
        library: "group:4815",
        match: "READ",
        limit: "all",
      }),
    ).toEqual({
      kind: "tags",
      libraries: {
        scope: {
          mode: "selected",
          libraries: [{ type: "group", groupID: 4815 }],
        },
        parameter: "library",
      },
      match: "READ",
      limit: null,
    });
  }),
);

it.effect.each<CliData>([
  {},
  { kind: "items" },
  { kind: "collections", library: "personal,group:4815" },
  { kind: "tags", library: "group:0" },
  { kind: "tags", limit: "0" },
  { kind: "tags", limit: "1.5" },
  { kind: "tags", limit: "9007199254740992" },
  { kind: "tags", fields: "title" },
])("rejects invalid listing arguments: %j", (params) =>
  Effect.gen(function* () {
    expect(yield* Effect.flip(decodeValues(params))).toBeInstanceOf(
      CliRejection,
    );
  }),
);

/**
 * The parsed listing answer of `params` on `scenario`, read in `scope`. A
 * malformed listing fails with its rejection.
 */
const listingOf = (
  scenario: ScenarioDatabase,
  params: CliData,
  scope: LibraryScope = MY_LIBRARY_SCOPE,
) =>
  decodeValues(params).pipe(
    Effect.flatMap((values) =>
      answer(
        { schema: false, command: "zotlit:query-values", values, scope },
        { identity },
      ),
    ),
    Effect.scoped,
    Effect.provideService(ItemQueryDatabase, { client: scenario.db }),
    Effect.map((reply) => JSON.parse(reply.answer)),
  );

/** The scenario database, held for the case's scope. */
const scenarioOf = Effect.acquireDisposable(
  Effect.sync(() => openScenarioDatabase()),
);

it.effect(
  "lists sorted live Collection paths per Library, including empty Collections",
  () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf;
      scenario.sqlite
        .prepare(
          "insert into collections (collectionName, libraryID, key) values ('Empty', 1, 'EMPTYCL2')",
        )
        .run();
      expect(
        yield* listingOf(scenario, { kind: "collections", library: "all" }),
      ).toEqual({
        contractVersion: 3,
        command: "zotlit:query-values",
        ok: true,
        identity,
        libraries: [
          { type: "personal" },
          { type: "group", groupID: 4815, name: "Methods Reading Group" },
        ],
        request: {
          kind: "collections",
          library: ["personal", "group:4815"],
          limit: 100,
        },
        returnedCount: 6,
        truncated: false,
        values: [
          {
            library: "personal",
            name: "My Library",
            totalCount: 5,
            returnedCount: 5,
            truncated: false,
            values: [
              "Empty",
              "Teaching",
              "Teaching/Methods",
              "Thesis",
              "Thesis/Methods",
            ],
          },
          {
            library: "group:4815",
            name: "Methods Reading Group",
            totalCount: 1,
            returnedCount: 1,
            truncated: false,
            values: ["Methods"],
          },
        ],
      });
    }),
);

it.effect(
  "lists Tag types with case-insensitive match and a limit per Library",
  () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf;
      expect(
        yield* listingOf(scenario, {
          kind: "tags",
          library: "all",
          match: "READ",
          limit: "1",
        }),
      ).toMatchObject({
        request: { kind: "tags", match: "READ", limit: 1 },
        returnedCount: 2,
        truncated: true,
        values: [
          {
            library: "personal",
            totalCount: 2,
            returnedCount: 1,
            truncated: true,
            values: [{ name: "to-read", type: "manual" }],
          },
          {
            library: "group:4815",
            totalCount: 1,
            returnedCount: 1,
            truncated: false,
            values: [{ name: "to-read", type: "manual" }],
          },
        ],
      });
    }),
);

it.effect.each([
  [
    { kind: "collections", match: "METHODS", limit: "1" },
    {
      totalCount: 2,
      returnedCount: 1,
      truncated: true,
      values: ["Teaching/Methods"],
    },
  ],
  [
    { kind: "collections", match: "methods", limit: "all" },
    {
      totalCount: 2,
      returnedCount: 2,
      truncated: false,
      values: ["Teaching/Methods", "Thesis/Methods"],
    },
  ],
  [
    { kind: "collections", match: "absent" },
    { totalCount: 0, returnedCount: 0, truncated: false, values: [] },
  ],
  [
    { kind: "tags", match: "READ", limit: "all" },
    {
      totalCount: 2,
      returnedCount: 2,
      truncated: false,
      values: [
        { name: "to-read", type: "manual" },
        { name: "To-Read", type: "auto" },
      ],
    },
  ],
] as const)("filters and limits values: %j", ([params, expected]) =>
  Effect.gen(function* () {
    const scenario = yield* scenarioOf;
    expect(yield* listingOf(scenario, params)).toMatchObject({
      ok: true,
      libraries: [{ type: "personal" }],
      values: [{ library: "personal", ...expected }],
    });
  }),
);

it.effect.each([
  [
    { kind: "collections", library: "group:999" },
    MY_LIBRARY_SCOPE,
    "library-not-found",
  ],
  [
    { kind: "tags" },
    { mode: "selected", libraries: [{ type: "group", groupID: 999 }] },
    "no-library-available",
  ],
] as const)("reports unavailable Libraries: %j", ([params, scope, code]) =>
  Effect.gen(function* () {
    const scenario = yield* scenarioOf;
    const result = yield* listingOf(scenario, params, scope);
    expect(result).toMatchObject({
      ok: false,
      command: "zotlit:query-values",
      diagnostic: { code },
    });
    expect(result.diagnostic.report.at(-1)).toBe(result.diagnostic.hint);
  }),
);

it.effect(
  "bounds the listing response and gives a recovery action for this command",
  () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf;
      scenario.sqlite
        .prepare(
          "insert into collections (collectionName, libraryID, key) values (?, 1, 'HUGECL22')",
        )
        .run("a".repeat(1024 * 1024));
      const result = yield* listingOf(scenario, {
        kind: "collections",
        limit: "all",
      });
      expect(result).toMatchObject({
        ok: false,
        diagnostic: { code: "result-too-large" },
      });
      expect(result.diagnostic.hint).toContain("match");
      expect(result.diagnostic.report.at(-1)).toBe(result.diagnostic.hint);
    }),
);
