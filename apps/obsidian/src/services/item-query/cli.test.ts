import { Cause, Effect, Exit, Scheduler } from "effect";
import type { Scope } from "effect";
import { StatementSync } from "node:sqlite";
import type { CliData, CliHandler, Plugin } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { ItemQueryDatabase } from "@zotlit/db/item-query";
import {
  BULK_LIBRARY,
  openScenarioDatabase,
  seedBulkLibrary,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";
import { ItemQueryScheduler } from "@zotlit/item-query";

import {
  DEFAULT_LIBRARY_SCOPE,
  MY_LIBRARY_SCOPE,
} from "@/services/library-scope/scope";
import type { LibraryScope } from "@/services/library-scope/scope";

import {
  answerItemQuery,
  answerItemQuerySchema,
  createItemQueryCancelHandler,
  ITEM_QUERY_CANCEL_COMMAND,
  ITEM_QUERY_COMMAND,
  ITEM_QUERY_GUIDE_COMMAND,
  ITEM_QUERY_SCHEMA_COMMAND,
  itemQueryGuideHandler,
  registerItemQueryCli,
} from "./cli";
import type { ItemQueryCliDeps } from "./cli";
import { decodeItemQuery, rejectionDiagnostic } from "./decode";
import type { DecodedQuery } from "./decode";
import { GUIDE_EXAMPLES, GUIDE_FILTERS, GUIDE_TOPIC_NAMES } from "./guide";
import type { QueryReply } from "./worker-protocol";

/** The driver call under every statement of the borrowed client. */
// oxlint-disable-next-line typescript/unbound-method -- applied to its statement in the test.
const readRows = StatementSync.prototype.all;

afterEach(() => {
  vi.restoreAllMocks();
});

const IDENTITY = {
  vault: { name: "Research", path: "/vaults/research" },
  source: { id: "source-1", databasePath: "/zotero/zotero.sqlite" },
};

/** The personal Library, most recently modified first, ties in key order. */
const PERSONAL_BY_MODIFIED = [
  "ART2FULL",
  "UNI2CDE2",
  "ALS2CNFL",
  "TIE2AAAA",
  "TIE2BBBB",
  "TIE2CCCC",
  "RPT2NDTE",
  "CHP2YEAR",
  "BK2MNTH2",
  "CNF2TEXT",
];

/**
 * The query that the renderer decodes from `params`, as the worker receives it:
 * plain JSON. The decoder tests cover malformed arguments.
 */
function decoded(params: CliData = {}): DecodedQuery {
  const query = decodeItemQuery(params);
  if (query.kind === "invalid")
    throw new Error(`Malformed test query: ${query.message}`);
  return JSON.parse(JSON.stringify(query.value)) as DecodedQuery;
}

/** The parameters of an answer, and the client of the database it reads. */
type TestDeps = Partial<ItemQueryCliDeps> & { client?: NodeDatabaseClient };

/**
 * An answer as a Query Job runs it: on the database of `client`, in the scope
 * of the job, on the time-budget scheduler.
 */
function onJob<A>(
  client: NodeDatabaseClient,
  answer: Effect.Effect<A, never, ItemQueryDatabase | Scope.Scope>,
): Effect.Effect<A> {
  return answer.pipe(
    Effect.scoped,
    Effect.provideService(ItemQueryDatabase, { client }),
    Effect.provideService(Scheduler.Scheduler, new ItemQueryScheduler()),
  );
}

/** The query answer on `scenario`, as an Effect of the envelope text. */
function queryOf(
  scenario: ScenarioDatabase,
  { client = scenario.db, ...overrides }: TestDeps = {},
) {
  const deps: ItemQueryCliDeps = {
    identity: IDENTITY,
    scope: MY_LIBRARY_SCOPE,
    ...overrides,
  };
  return (params: CliData = {}): Effect.Effect<string> =>
    onJob(client, answerItemQuery(deps, decoded(params))).pipe(
      Effect.map((reply: QueryReply) => reply.answer),
    );
}

function setup(scenario: ScenarioDatabase, overrides: TestDeps = {}) {
  const read = vi.spyOn(StatementSync.prototype, "all");
  const query = queryOf(scenario, overrides);
  return {
    read,
    query,
    run: async (params: CliData = {}) => {
      const answer = await Effect.runPromise(query(params));
      return JSON.parse(answer) as Record<string, unknown>;
    },
  };
}

/**
 * Run `effect` to its exit; `signal` interrupts it. The run starts in a later
 * task: Effect listens to the signal once the first synchronous segment of a
 * run ends.
 */
function exitOf<A>(
  effect: Effect.Effect<A>,
  signal: AbortSignal,
): Promise<Exit.Exit<A>> {
  return Effect.runPromiseExit(Effect.andThen(Effect.yieldNow, effect), {
    signal,
  });
}

/** The run ended by interruption alone. */
function expectInterrupted<A, E>(exit: Exit.Exit<A, E>): void {
  expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
    true,
  );
}

const keys = (answer: Record<string, unknown>) =>
  (answer.rows as { indexedKey: string }[]).map((row) => row.indexedKey);

describe("zotlit:item-query without arguments", () => {
  it("answers the versioned envelope for the Library Scope with the CLI defaults", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run();

    expect(answer).toMatchObject({
      contractVersion: 1,
      command: ITEM_QUERY_COMMAND,
      ok: true,
      identity: IDENTITY,
      libraries: [{ type: "personal" }],
      request: {
        libraries: ["personal"],
        filter: null,
        sort: [{ field: "dateModified", direction: "desc" }],
        limit: 100,
      },
      returnedCount: 10,
      truncated: false,
    });
    expect(keys(answer)).toEqual(PERSONAL_BY_MODIFIED);
    expect(Object.keys(answer)).toEqual([
      "contractVersion",
      "command",
      "ok",
      "identity",
      "libraries",
      "request",
      "returnedCount",
      "truncated",
      "rows",
    ]);
  });

  it("answers pretty JSON", async () => {
    using scenario = openScenarioDatabase();

    const answer = await Effect.runPromise(queryOf(scenario)({ limit: "1" }));

    expect(answer).toMatch(/^\{\n {2}"contractVersion": 1,\n/);
  });
});

describe("zotlit:item-query answer", () => {
  /**
   * A clock that moves 2 ms at each read: the second read of a step is at
   * the budget of 4 ms, so a step of the answer holds two chunks of rows.
   */
  function fastClock() {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 2));
  }

  /** The bulk Library: more rows than the first chunk of an answer. */
  const BULK = { library: `group:${BULK_LIBRARY.groupID}`, limit: "all" };

  function handlerOf(scenario: ScenarioDatabase, overrides: TestDeps = {}) {
    const query = queryOf(scenario, overrides);
    return (params: CliData) => Effect.runPromise(query(params));
  }

  it.each<CliData>([
    { limit: "all" },
    { limit: "all", fields: "[]" },
    { limit: "1", fields: '["title","creators","date","tags","custom"]' },
    { filter: "false" },
    { ...BULK, fields: '["title","dateAdded","tags"]' },
    { ...BULK, fields: "[]" },
  ])("is the pretty JSON of its envelope for %j", async (params) => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, 600);
    fastClock();

    const answer = await handlerOf(scenario)(params);

    expect(answer).toBe(JSON.stringify(JSON.parse(answer), null, 2));
    expect(Object.keys(JSON.parse(answer) as object).at(-1)).toBe("rows");
  });

  it("builds the rows in steps and gives the window a turn between them", async () => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, 600);
    fastClock();
    const steps: number[] = [];

    const answer = await handlerOf(scenario, {
      onAnswerStep: (ms) => steps.push(ms),
    })({ ...BULK, fields: '["title"]' });

    // Each projection batch is encoded before the next batch is read.
    expect(JSON.parse(answer)).toMatchObject({ returnedCount: 600 });
    expect(steps.length).toBeGreaterThan(1);
  });

  it("ends interrupted when the interrupt comes while it builds the answer", async () => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, 600);
    fastClock();
    const controller = new AbortController();

    const exit = await exitOf(
      queryOf(scenario, { onAnswerStep: () => controller.abort() })({
        ...BULK,
        fields: "[]",
      }),
      controller.signal,
    );

    expectInterrupted(exit);
  });
});

describe("zotlit:item-query limit", () => {
  it("returns the first rows and reports truncation for a numeric limit", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ limit: "3" });

    expect(keys(answer)).toEqual(PERSONAL_BY_MODIFIED.slice(0, 3));
    expect(answer).toMatchObject({
      request: { limit: 3 },
      returnedCount: 3,
      truncated: true,
    });
  });

  it("normalizes limit=all to null and returns every match", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ limit: "all" });

    expect(keys(answer)).toEqual(PERSONAL_BY_MODIFIED);
    expect(answer).toMatchObject({
      request: { limit: null },
      truncated: false,
    });
  });
});

/** Both Libraries of the scenario, most recently modified first. */
const BOTH_BY_MODIFIED = [
  "ART2FULLg4815",
  "ART2FULL",
  "GRP2BK22g4815",
  ...PERSONAL_BY_MODIFIED.slice(1),
];
const PERSONAL_WIRE = { type: "personal" };
const METHODS_GROUP_WIRE = {
  type: "group",
  groupID: 4815,
  name: "Methods Reading Group",
};
const BULK_GROUP_WIRE = {
  type: "group",
  groupID: BULK_LIBRARY.groupID,
  name: BULK_LIBRARY.name,
};

describe("zotlit:item-query library", () => {
  it("reads a group Library by its group ID and reports it with its name", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ library: "group:4815" });

    expect(answer.libraries).toEqual([METHODS_GROUP_WIRE]);
    expect(answer.request).toMatchObject({ libraries: ["group:4815"] });
    expect(keys(answer)).toEqual(["ART2FULLg4815", "GRP2BK22g4815"]);
  });

  it("reads the personal Library alone for library=personal, whatever the Library Scope is", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario, { scope: DEFAULT_LIBRARY_SCOPE });

    const answer = await run({ library: "personal" });

    expect(answer.libraries).toEqual([PERSONAL_WIRE]);
    expect(answer.request).toMatchObject({ libraries: ["personal"] });
    expect(keys(answer)).toEqual(PERSONAL_BY_MODIFIED);
  });

  it("answers library-not-found for a group the source does not hold", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ library: "group:999" });

    expect(answer).toMatchObject({
      ok: false,
      diagnostic: {
        code: "library-not-found",
        message: expect.stringContaining("999"),
        details: { parameter: "library" },
      },
    });
  });
});

describe("zotlit:item-query libraries", () => {
  it("reads the named Libraries as one result set", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ libraries: '["personal","group:4815"]' });

    expect(answer).toMatchObject({
      ok: true,
      libraries: [PERSONAL_WIRE, METHODS_GROUP_WIRE],
      request: { libraries: ["personal", "group:4815"] },
      returnedCount: 12,
      truncated: false,
    });
    expect(keys(answer)).toEqual(BOTH_BY_MODIFIED);
  });

  it("limits the one result set, not each Library", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({
      libraries: '["personal","group:4815"]',
      limit: "3",
    });

    expect(answer).toMatchObject({ returnedCount: 3, truncated: true });
    expect(keys(answer)).toEqual(BOTH_BY_MODIFIED.slice(0, 3));
  });

  it("reports the Libraries in the canonical order, whatever order the caller gives", async () => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, 1);
    const { run } = setup(scenario);

    const answer = await run({
      libraries: `["group:4815","group:${BULK_LIBRARY.groupID}","personal"]`,
      fields: "[]",
    });

    // My Library first, then the groups by ascending group ID.
    expect(answer.libraries).toEqual([
      PERSONAL_WIRE,
      BULK_GROUP_WIRE,
      METHODS_GROUP_WIRE,
    ]);
    expect(answer.request).toMatchObject({
      libraries: ["personal", `group:${BULK_LIBRARY.groupID}`, "group:4815"],
    });
    expect(answer.returnedCount).toBe(13);
  });

  it("reads a Library outside the Library Scope when the caller names it", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ libraries: '["group:4815"]' });

    expect(answer.libraries).toEqual([METHODS_GROUP_WIRE]);
    expect(keys(answer)).toEqual(["ART2FULLg4815", "GRP2BK22g4815"]);
  });

  it("reads every Library of the source for libraries=all, whatever the Library Scope is", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ libraries: "all" });

    expect(answer.libraries).toEqual([PERSONAL_WIRE, METHODS_GROUP_WIRE]);
    expect(answer.request).toMatchObject({
      libraries: ["personal", "group:4815"],
    });
    expect(keys(answer)).toEqual(BOTH_BY_MODIFIED);
  });

  it("answers source-unavailable for libraries=all on a source without a Library", async () => {
    using scenario = openScenarioDatabase();
    scenario.sqlite.exec(
      "pragma foreign_keys = off; delete from groups; delete from libraries",
    );
    const { run } = setup(scenario);

    const answer = await run({ libraries: "all" });

    expect(answer).toMatchObject({
      ok: false,
      diagnostic: {
        code: "source-unavailable",
        message: "The connected Zotero source holds no Library.",
      },
    });
    expect(JSON.stringify(answer)).not.toContain("libraries=all");
  });

  it("keeps local library IDs out of the answer", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ libraries: "all", limit: "1" });

    expect(JSON.stringify(answer)).not.toContain("libraryID");
  });

  it("answers library-not-found for a Library the source does not hold, and names it", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ libraries: '["personal","group:999"]' });

    expect(answer).toMatchObject({
      ok: false,
      diagnostic: {
        code: "library-not-found",
        message: expect.stringContaining("999"),
        details: { parameter: "libraries" },
      },
    });
  });
});

describe("zotlit:item-query default Libraries", () => {
  const scoped = (scope: LibraryScope) => ({ scope });
  const selected = (
    ...libraries: Extract<LibraryScope, { mode: "selected" }>["libraries"]
  ): LibraryScope => ({ mode: "selected", libraries });

  it("reads every Library of the source when the Library Scope is All Libraries", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario, scoped(DEFAULT_LIBRARY_SCOPE));

    const answer = await run();

    expect(answer).toMatchObject({
      ok: true,
      libraries: [PERSONAL_WIRE, METHODS_GROUP_WIRE],
      request: { libraries: ["personal", "group:4815"], limit: 100 },
      returnedCount: 12,
    });
    expect(keys(answer)).toEqual(BOTH_BY_MODIFIED);
  });

  it("reads the Selected Libraries", async () => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, 1);
    const { run } = setup(
      scenario,
      scoped(selected({ type: "group", groupID: 4815 })),
    );

    const answer = await run();

    expect(answer.libraries).toEqual([METHODS_GROUP_WIRE]);
    expect(answer.request).toMatchObject({ libraries: ["group:4815"] });
    expect(keys(answer)).toEqual(["ART2FULLg4815", "GRP2BK22g4815"]);
  });

  it("leaves out a Selected Library that the source does not hold", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(
      scenario,
      scoped(
        selected(
          { type: "personal" },
          { type: "group", groupID: 999 },
          { type: "group", groupID: 4815 },
        ),
      ),
    );

    const answer = await run();

    expect(answer).toMatchObject({
      ok: true,
      libraries: [PERSONAL_WIRE, METHODS_GROUP_WIRE],
      request: { libraries: ["personal", "group:4815"] },
      returnedCount: 12,
    });
  });

  it("answers no-library-available when the source holds no Selected Library", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(
      scenario,
      scoped(selected({ type: "group", groupID: 999 })),
    );

    const answer = await run();

    expect(answer).toMatchObject({
      contractVersion: 1,
      command: ITEM_QUERY_COMMAND,
      ok: false,
      diagnostic: {
        code: "no-library-available",
        hint: expect.stringContaining("libraries="),
      },
    });
  });

  it("resolves the Library Scope on the borrowed source", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario, scoped(DEFAULT_LIBRARY_SCOPE));
    // The group leaves the source: the borrowed copy decides.
    scenario.sqlite.exec("delete from groups where groupID = 4815");

    const answer = await run();

    expect(answer.libraries).toEqual([PERSONAL_WIRE]);
    expect(keys(answer)).toEqual(PERSONAL_BY_MODIFIED);
  });
});

describe("zotlit:item-query fields", () => {
  it("returns identity-only rows for fields=[]", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ fields: "[]", limit: "2" });

    expect(answer.rows).toEqual([
      { indexedKey: "ART2FULL", values: {} },
      { indexedKey: "UNI2CDE2", values: {} },
    ]);
    expect(answer.request).toMatchObject({ fields: [] });
  });

  it("writes Temporal values as ISO strings, nested ones included", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({
      fields: '["date.value","dateModified","date"]',
      limit: "all",
    });

    const values = Object.fromEntries(
      (answer.rows as { indexedKey: string; values: object }[]).map((row) => [
        row.indexedKey,
        row.values,
      ]),
    );
    expect(values["ART2FULL"]).toMatchObject({
      "date.value": "2020-03-15",
      dateModified: "2024-06-01T10:00:00Z",
      date: { kind: "date", value: "2020-03-15", year: 2020 },
    });
    expect(values["BK2MNTH2"]).toMatchObject({
      "date.value": "2019-11",
      date: { kind: "yearMonth", value: "2019-11" },
    });
  });

  it("answers the code, location, and hint of an unknown field", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ fields: '["itemType","nope"]' });

    expect(answer).toMatchObject({
      ok: false,
      diagnostic: {
        code: "unknown-field",
        location: { argument: "fields", index: 1 },
        message: expect.stringContaining("nope"),
        hint: expect.any(String),
      },
    });
  });
});

describe("zotlit:item-query filter and sort", () => {
  it("passes a well-formed filter through to the engine and echoes it", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);
    const filter = 'tags.contains("to-read")';

    const answer = await run({ filter });

    expect(answer).toMatchObject({ ok: true, request: { filter } });
    expect(keys(answer)).toEqual(["ART2FULL", "BK2MNTH2"]);
  });

  it("answers an invalid filter with the code, the location in the filter text, and the hint", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ filter: "title.startsWith(1)" });

    expect(answer).toMatchObject({
      ok: false,
      diagnostic: {
        code: "wrong-argument-type",
        location: { argument: "filter", span: { from: 17, to: 18 } },
        hint: "Call value.startsWith(prefix).",
      },
    });
  });

  it("passes a well-formed sort through to the engine and echoes it", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({
      sort: '[{"field":"title","direction":"asc"}]',
    });

    expect(answer).toMatchObject({
      ok: true,
      request: { sort: [{ field: "title", direction: "asc" }] },
    });
    expect(keys(answer)).toEqual([
      "CHP2YEAR",
      "ALS2CNFL",
      "UNI2CDE2",
      "ART2FULL",
      "CNF2TEXT",
      "RPT2NDTE",
      "BK2MNTH2",
      "TIE2AAAA",
      "TIE2BBBB",
      "TIE2CCCC",
    ]);
  });
});

describe("zotlit:item-query id", () => {
  it("accepts a query ID and keeps it out of the request", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ id: "export-2024.v1_a", limit: "1" });

    expect(answer).toMatchObject({ ok: true, returnedCount: 1 });
    expect(answer.request).not.toHaveProperty("id");
  });
});

describe("zotlit:item-query-cancel", () => {
  function cancelOf(active: readonly string[]) {
    const requested: string[] = [];
    const handler = createItemQueryCancelHandler((id) => {
      requested.push(id);
      return active.includes(id);
    });
    return {
      requested,
      run: async (params: CliData) =>
        JSON.parse(await handler(params)) as Record<string, unknown>,
    };
  }

  it("answers that it requested the cancel of an active query", async () => {
    const { run, requested } = cancelOf(["export-a"]);

    const answer = await run({ id: "export-a" });

    expect(answer).toEqual({
      contractVersion: 1,
      command: ITEM_QUERY_CANCEL_COMMAND,
      ok: true,
      id: "export-a",
      cancelRequested: true,
    });
    expect(requested).toEqual(["export-a"]);
  });

  it("answers that it requested no cancel for an ID with no active query", async () => {
    const { run } = cancelOf(["export-a"]);

    expect(await run({ id: "export-b" })).toEqual({
      contractVersion: 1,
      command: ITEM_QUERY_CANCEL_COMMAND,
      ok: true,
      id: "export-b",
      cancelRequested: false,
    });
  });

  it.each<[CliData, string]>([
    [{}, "id"],
    [{ id: "" }, "id"],
    [{ id: "a b" }, "id"],
    [{ id: "export-a", limit: "1" }, "limit"],
  ])("rejects %j and cancels nothing", async (params, parameter) => {
    const { run, requested } = cancelOf(["export-a"]);

    expect(await run(params)).toMatchObject({
      command: ITEM_QUERY_CANCEL_COMMAND,
      ok: false,
      diagnostic: { code: "invalid-argument", details: { parameter } },
    });
    expect(requested).toEqual([]);
  });
});

describe("zotlit:item-query borrowed source", () => {
  it("answers the source identity supplied by its caller", async () => {
    using scenario = openScenarioDatabase();
    const source = {
      id: "leased-source",
      databasePath: "/leased/zotero.sqlite",
    };
    const { run } = setup(scenario, {
      identity: { ...IDENTITY, source },
    });

    const answer = await run();

    expect(answer).toMatchObject({
      ok: true,
      identity: { ...IDENTITY, source },
    });
  });

  it("answers database-error when the borrowed database cannot be read", async () => {
    using scenario = openScenarioDatabase();
    const closed = openScenarioDatabase();
    const client = closed.db;
    closed.close();
    const { run } = setup(scenario, {
      client,
    });

    const answer = await run();

    expect(answer).toMatchObject({
      ok: false,
      diagnostic: {
        code: "database-error",
        message: expect.stringContaining(
          "Item Query could not read the Zotero database: ",
        ),
        hint: expect.any(String),
      },
    });
  });

  it("answers unsupported-database-layout for a copy that lacks a manifest table or column", async () => {
    using scenario = openScenarioDatabase();
    scenario.sqlite.exec(
      'pragma foreign_keys = off; drop table "itemDataValues"; alter table "fieldsCombined" drop column "custom"',
    );
    const { run } = setup(scenario);

    const answer = await run();

    expect(answer).toMatchObject({
      contractVersion: 1,
      command: ITEM_QUERY_COMMAND,
      ok: false,
      diagnostic: {
        code: "unsupported-database-layout",
        message: expect.stringContaining("fieldsCombined.custom"),
        hint: expect.stringContaining("update ZotLit"),
      },
    });
    expect((answer.diagnostic as { message: string }).message).toContain(
      "the table itemDataValues",
    );
  });

  it("rejects with an Error for a defect, distinct from a cancellation", async () => {
    using scenario = openScenarioDatabase();
    const defect = new TypeError("boom");
    const { run } = setup(scenario, {
      openOutput: () => Effect.die(defect),
    });

    const answering = run({ output: "/exports/items.json" });

    await expect(answering).rejects.toThrow(
      "Item Query failed with an internal error.",
    );
    await expect(answering).rejects.toMatchObject({ cause: defect });
    await expect(answering).rejects.not.toMatchObject({ name: "AbortError" });
  });
});

describe("zotlit:item-query on the layout of the Zotero database", () => {
  it.each([
    ["the lowest supported layout", null],
    ["the lowest layout stamped outside the supported range", 999],
  ])(
    "resolves the personal and a group Library on %s",
    async (_name, userdata) => {
      using scenario = openScenarioDatabase({ layout: "lowest" });
      if (userdata !== null) {
        scenario.sqlite
          .prepare("update version set version = ? where schema = 'userdata'")
          .run(userdata);
      }
      const { run } = setup(scenario);

      const personal = await run({ fields: "[]" });
      const group = await run({ fields: "[]", library: "group:4815" });
      const all = await run({ fields: "[]", libraries: "all" });

      expect(personal).toMatchObject({
        ok: true,
        libraries: [PERSONAL_WIRE],
        returnedCount: 10,
      });
      expect(group).toMatchObject({
        ok: true,
        libraries: [METHODS_GROUP_WIRE],
        returnedCount: 2,
      });
      expect(all).toMatchObject({
        ok: true,
        libraries: [PERSONAL_WIRE, METHODS_GROUP_WIRE],
        returnedCount: 12,
      });
    },
  );
});

describe("zotlit:item-query cancellation", () => {
  it("ends interrupted when the interrupt comes before it answers", async () => {
    using scenario = openScenarioDatabase();
    const controller = new AbortController();
    const { query } = setup(scenario);

    // A named Library starts execution without awaiting the default scope.
    const running = exitOf(query({ library: "personal" }), controller.signal);
    controller.abort();

    expectInterrupted(await running);
  });

  it("stops database reads before an interrupted run settles", async () => {
    using scenario = openScenarioDatabase();
    const controller = new AbortController();
    const { run, query } = setup(scenario);
    // Warm the copy, then count the reads of one complete run.
    await run({ fields: '["title"]' });
    const read = vi.spyOn(StatementSync.prototype, "all");
    await run({ fields: '["title"]' });
    const complete = read.mock.calls.length;
    expect(complete).toBeGreaterThan(3);

    // Every read of the clock is 3 ms later, so the scheduler ends a slice
    // after each operation.
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 3));
    // Interrupt inside the third database read of the query.
    const events: string[] = [];
    read.mockImplementation(function (this: StatementSync, ...values) {
      if (events.push("read") === 3) controller.abort();
      return Reflect.apply(readRows, this, values) as ReturnType<
        StatementSync["all"]
      >;
    });

    const exit = await exitOf(
      query({ fields: '["title"]' }),
      controller.signal,
    );
    events.push("settled");

    expectInterrupted(exit);
    expect(events).toEqual(["read", "read", "read", "settled"]);
  });
});

function setupSchema(
  scenario: ScenarioDatabase,
  overrides: Pick<ItemQueryCliDeps, "identity"> = { identity: IDENTITY },
) {
  const text = () =>
    Effect.runPromise(
      onJob(
        scenario.db,
        answerItemQuerySchema(overrides, "2.2.0-beta.2").pipe(
          Effect.map((reply: QueryReply) => reply.answer),
        ),
      ),
    );
  return {
    text,
    run: async () => JSON.parse(await text()) as Record<string, unknown>,
  };
}

describe("zotlit:item-query-schema", () => {
  it("answers the pinned catalog download and live custom fields without the static catalog", async () => {
    using scenario = openScenarioDatabase();
    const { text } = setupSchema(scenario);

    const output = await text();
    const answer = JSON.parse(output) as Record<string, unknown>;

    expect(output).toMatch(/^\{\n {2}"contractVersion": 1,\n/);
    expect(Object.keys(answer).slice(0, 3)).toEqual([
      "contractVersion",
      "command",
      "ok",
    ]);
    expect(answer).toMatchObject({
      contractVersion: 1,
      command: ITEM_QUERY_SCHEMA_COMMAND,
      ok: true,
      identity: IDENTITY,
      schema: {
        url: "https://github.com/aidenlx/zotlit/releases/download/res-2.2.0-beta.2/item-query.schema.json",
        fileName: "zotlit-item-query-2.2.0-beta.2.schema.json",
      },
      customFields: expect.arrayContaining([
        expect.objectContaining({ name: "mood", bareName: true }),
        expect.objectContaining({ name: "review.status", bareName: false }),
      ]),
    });
    expect(Object.keys(answer.schema as object)).toEqual(["url", "fileName"]);
  });

  it("reports the CLI defaults: 100 rows of the Library Scope, newest modification first", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setupSchema(scenario);

    const answer = await run();

    expect(answer.defaults).toEqual({
      fields: ["itemType", "title", "creators", "date", "dateModified"],
      sort: [{ field: "dateModified", direction: "desc" }],
      limit: 100,
      libraries: { source: "library-scope" },
    });
  });

  it("answers the source identity supplied by its caller", async () => {
    using scenario = openScenarioDatabase();
    const source = {
      id: "leased-source",
      databasePath: "/leased/zotero.sqlite",
    };
    const { run } = setupSchema(scenario, {
      identity: { ...IDENTITY, source },
    });

    const answer = await run();

    expect(answer).toMatchObject({
      ok: true,
      identity: { ...IDENTITY, source },
    });
  });

  it("answers unsupported-database-layout for a copy that lacks a manifest column", async () => {
    using scenario = openScenarioDatabase();
    scenario.sqlite.exec('alter table "fieldsCombined" drop column "custom"');
    const { run } = setupSchema(scenario);

    const answer = await run();

    expect(answer).toMatchObject({
      command: ITEM_QUERY_SCHEMA_COMMAND,
      ok: false,
      diagnostic: {
        code: "unsupported-database-layout",
        message: expect.stringContaining("fieldsCombined.custom"),
      },
    });
  });
});

describe("zotlit:item-query-guide", () => {
  it("prints the quickstart as plain text with every command and topic", () => {
    const output = itemQueryGuideHandler({});

    expect(() => JSON.parse(output)).toThrow();
    for (const command of [
      ITEM_QUERY_COMMAND,
      ITEM_QUERY_CANCEL_COMMAND,
      ITEM_QUERY_SCHEMA_COMMAND,
      ITEM_QUERY_GUIDE_COMMAND,
    ]) {
      expect(output).toContain(command);
    }
    for (const topic of GUIDE_TOPIC_NAMES) expect(output).toContain(topic);
    expect(output).toContain(
      "obsidian zotlit:item-query [filter=<expression>] [fields=<json>]",
    );
    expect(output).toContain("[limit=<n|all>] [library=<personal|group:id>]");
    expect(output).toContain("[libraries=<json|all>]");
    expect(output).toContain(
      "returns at most\n  100 rows, sorted by dateModified descending.\n  Each row has itemType, title, creators, date, and dateModified.",
    );
    expect(output).toContain("Library scope");
    expect(output).toContain("libraries wins");
  });

  it("prints the recovery text of each diagnostic code that the handlers answer", async () => {
    using scenario = openScenarioDatabase();
    const output = itemQueryGuideHandler({ topic: "results" });
    const flat = output.replaceAll(/\s+/g, " ");
    const { run } = setup(scenario, {
      scope: {
        mode: "selected",
        libraries: [{ type: "group", groupID: 999 }],
      },
    });

    type Answered = { code: string; hint: string };
    // The renderer answers a malformed argument; the handler, the rest.
    const malformed = decodeItemQuery({ limit: "0" });
    if (malformed.kind === "valid") throw new Error("limit=0 decoded");
    const diagnostics: Answered[] = [rejectionDiagnostic(malformed)];
    const failing: CliData[] = [{}, { library: "group:999" }];
    for (const params of failing) {
      const answer = (await run(params)) as { diagnostic: Answered };
      diagnostics.push(answer.diagnostic);
    }

    for (const { code, hint } of diagnostics) {
      expect(flat).toContain(`${code}: ${hint}`);
    }
  });

  it.each([
    ["filter", ["key is the Zotero Key", "attachments", "lower()", "within"]],
    ["fields", ['custom["<exact name>"]', "fields='[]'", "null"]],
    ["sort", ["10 comes before 9", "first possible day", "limit", "all"]],
    ["results", ["diagnostic.hint", "location", "span"]],
    [
      "cancel",
      [
        "id=",
        "obsidian zotlit:item-query-cancel id=",
        "cancelRequested",
        "already finished",
        "query-id-in-use",
        "Without id",
      ],
    ],
  ])("prints topic=%s", (topic, facts) => {
    const output = itemQueryGuideHandler({ topic });

    expect(() => JSON.parse(output)).toThrow();
    expect(facts.filter((fact) => !output.includes(fact))).toEqual([]);
  });

  it("answers an unknown topic with the diagnostic envelope", () => {
    const answer = JSON.parse(itemQueryGuideHandler({ topic: "bogus" }));

    expect(answer).toMatchObject({
      contractVersion: 1,
      command: ITEM_QUERY_GUIDE_COMMAND,
      ok: false,
      diagnostic: {
        code: "invalid-argument",
        details: { parameter: "topic" },
      },
    });
  });

  it("shows only commands and filters that run", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);
    const failures: string[] = [];

    for (const args of GUIDE_EXAMPLES) {
      const answer = await run(args);
      if (!answer.ok) failures.push(JSON.stringify({ args, answer }));
    }
    for (const filter of GUIDE_FILTERS) {
      const answer = await run({ filter, fields: "[]" });
      if (!answer.ok) failures.push(JSON.stringify({ filter, answer }));
    }

    expect(GUIDE_EXAMPLES.length).toBeGreaterThan(0);
    expect(GUIDE_FILTERS.length).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  it("shows each example where a shell passes it through unchanged", () => {
    const quoted = GUIDE_EXAMPLES.flatMap(Object.values).filter((value) =>
      value.includes("'"),
    );

    expect(quoted).toEqual([]);
  });
});

describe("registerItemQueryCli", () => {
  it("registers the command with its flags and cancels runs when the plugin unloads", async () => {
    const registerCliHandler = vi.fn();
    const onUnload: (() => void)[] = [];
    const plugin = {
      registerCliHandler,
      register: (callback: () => void) => onUnload.push(callback),
    } as unknown as Plugin;

    registerItemQueryCli(plugin, {
      answer: async (_params, signal) => {
        signal.throwIfAborted();
        return "";
      },
      cancel: (id) => id === "export-a",
      schema: async () => "",
    });

    expect(registerCliHandler).toHaveBeenCalledWith(
      ITEM_QUERY_COMMAND,
      expect.any(String),
      expect.objectContaining({
        filter: expect.any(Object),
        fields: expect.any(Object),
        sort: expect.any(Object),
        limit: expect.any(Object),
        library: expect.any(Object),
        libraries: expect.any(Object),
        id: expect.any(Object),
      }),
      expect.any(Function),
    );
    expect(registerCliHandler).toHaveBeenCalledWith(
      ITEM_QUERY_CANCEL_COMMAND,
      expect.any(String),
      expect.objectContaining({ id: expect.any(Object) }),
      expect.any(Function),
    );
    const cancel = registerCliHandler.mock.calls.find(
      ([command]) => command === ITEM_QUERY_CANCEL_COMMAND,
    )![3] as CliHandler;
    expect(JSON.parse(await cancel({ id: "export-a" }))).toMatchObject({
      cancelRequested: true,
    });
    expect(registerCliHandler).toHaveBeenCalledWith(
      ITEM_QUERY_SCHEMA_COMMAND,
      expect.any(String),
      null,
      expect.any(Function),
    );
    expect(registerCliHandler).toHaveBeenCalledWith(
      ITEM_QUERY_GUIDE_COMMAND,
      expect.any(String),
      expect.objectContaining({ topic: expect.any(Object) }),
      expect.any(Function),
    );
    const handler = registerCliHandler.mock.calls[0]![3] as CliHandler;
    for (const callback of onUnload) callback();
    await expect(handler({})).rejects.toMatchObject({ name: "AbortError" });
  });
});
