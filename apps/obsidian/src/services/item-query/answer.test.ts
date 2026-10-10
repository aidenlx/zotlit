import { Cause, Effect, Exit, Scheduler } from "effect";
import type { Scope } from "effect";
import { StatementSync } from "node:sqlite";
import type { CliData } from "obsidian";
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

import { answer, QueryOutputError } from "./answer";
import type { AnswerEnv, QueryWriter } from "./answer";
import { diagnostic, QUERY_COMMAND, QUERY_SCHEMA_COMMAND } from "./contract";
import type { Diagnostic } from "./contract";
import { decodeQuery } from "./decode";
import type { DecodedQuery } from "./decode";
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
  const query = decodeQuery(params);
  if (query.kind === "invalid")
    throw new Error(`Malformed test query: ${query.message}`);
  return JSON.parse(JSON.stringify(query.value)) as DecodedQuery;
}

/**
 * The environment of an answer, the Library Scope of its job, and the client
 * of the database it reads.
 */
type TestDeps = Partial<AnswerEnv> & {
  client?: NodeDatabaseClient;
  scope?: LibraryScope;
};

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
  {
    client = scenario.db,
    scope = MY_LIBRARY_SCOPE,
    ...overrides
  }: TestDeps = {},
) {
  const env: AnswerEnv = { identity: IDENTITY, ...overrides };
  return (params: CliData = {}): Effect.Effect<string> =>
    onJob(
      client,
      answer(
        {
          schema: false,
          dataset: decoded(params).from,
          command: QUERY_COMMAND,
          query: decoded(params),
          scope,
        },
        env,
      ),
    ).pipe(Effect.map((reply: QueryReply) => reply.answer));
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

describe("zotlit:query without arguments", () => {
  it("answers the versioned envelope for the Library Scope with the CLI defaults", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run();

    expect(answer).toMatchObject({
      contractVersion: 3,
      command: QUERY_COMMAND,
      ok: true,
      identity: IDENTITY,
      libraries: [{ type: "personal" }],
      request: {
        from: "items",
        library: ["personal"],
        filter: null,
        sort: [{ field: "dateModified", direction: "desc" }],
        limit: 100,
      },
      returnedCount: 10,
      truncated: false,
      warnings: [],
    });
    expect(keys(answer)).toEqual(PERSONAL_BY_MODIFIED);
  });
});

describe("zotlit:query answer", () => {
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
    { ...BULK, group: "library", fields: '["title","dateAdded","tags"]' },
    { ...BULK, group: "title", fields: "[]" },
    { group: "library", filter: "false" },
  ])("is the pretty JSON of its envelope for %j", async (params) => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, 600);
    fastClock();

    const answer = await handlerOf(scenario)(params);

    expect(answer).toBe(JSON.stringify(JSON.parse(answer), null, 2));
    expect(Object.keys(JSON.parse(answer) as object).at(-1)).toBe(
      params.group === undefined ? "rows" : "groups",
    );
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

describe("zotlit:query limit", () => {
  it("returns the first rows and reports truncation for a numeric limit", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ limit: "3" });

    expect(keys(answer)).toEqual(PERSONAL_BY_MODIFIED.slice(0, 3));
    expect(answer).toMatchObject({
      request: { limit: 3 },
      returnedCount: 3,
      truncated: true,
      warnings: [],
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
      warnings: [],
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

describe("zotlit:query library", () => {
  it("reads a group Library by its group ID and reports it with its name", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ library: "group:4815" });

    expect(answer.libraries).toEqual([METHODS_GROUP_WIRE]);
    expect(answer.request).toMatchObject({ library: ["group:4815"] });
    expect(keys(answer)).toEqual(["ART2FULLg4815", "GRP2BK22g4815"]);
  });

  it("reads the personal Library alone for library=personal, whatever the Library Scope is", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario, { scope: DEFAULT_LIBRARY_SCOPE });

    const answer = await run({ library: "personal" });

    expect(answer.libraries).toEqual([PERSONAL_WIRE]);
    expect(answer.request).toMatchObject({ library: ["personal"] });
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
        report: { 0: expect.stringContaining("999") },
        details: { parameter: "library" },
      },
    });
  });
});

describe("zotlit:query libraries", () => {
  it("reads the named Libraries as one result set", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ library: '["personal","group:4815"]' });

    expect(answer).toMatchObject({
      ok: true,
      libraries: [PERSONAL_WIRE, METHODS_GROUP_WIRE],
      request: { library: ["personal", "group:4815"] },
      returnedCount: 12,
      truncated: false,
      warnings: [],
    });
    expect(keys(answer)).toEqual(BOTH_BY_MODIFIED);
  });

  it("limits the one result set, not each Library", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({
      library: '["personal","group:4815"]',
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
      library: `["group:4815","group:${BULK_LIBRARY.groupID}","personal"]`,
      fields: "[]",
    });

    // My Library first, then the groups by ascending group ID.
    expect(answer.libraries).toEqual([
      PERSONAL_WIRE,
      BULK_GROUP_WIRE,
      METHODS_GROUP_WIRE,
    ]);
    expect(answer.request).toMatchObject({
      library: ["personal", `group:${BULK_LIBRARY.groupID}`, "group:4815"],
    });
    expect(answer.returnedCount).toBe(13);
  });

  it("reads a Library outside the Library Scope when the caller names it", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ library: '["group:4815"]' });

    expect(answer.libraries).toEqual([METHODS_GROUP_WIRE]);
    expect(keys(answer)).toEqual(["ART2FULLg4815", "GRP2BK22g4815"]);
  });

  it("reads every Library of the source for libraries=all, whatever the Library Scope is", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ library: "all" });

    expect(answer.libraries).toEqual([PERSONAL_WIRE, METHODS_GROUP_WIRE]);
    expect(answer.request).toMatchObject({
      library: ["personal", "group:4815"],
    });
    expect(keys(answer)).toEqual(BOTH_BY_MODIFIED);
  });

  it("answers source-unavailable for libraries=all on a source without a Library", async () => {
    using scenario = openScenarioDatabase();
    scenario.sqlite.exec(
      "pragma foreign_keys = off; delete from groups; delete from libraries",
    );
    const { run } = setup(scenario);

    const answer = await run({ library: "all" });

    expect(answer).toMatchObject({
      ok: false,
      diagnostic: {
        code: "source-unavailable",
        severity: "error",
      },
    });
    expect(JSON.stringify(answer)).not.toContain("libraries=all");
  });

  it("keeps local library IDs out of the answer", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ library: "all", limit: "1" });

    expect(JSON.stringify(answer)).not.toContain("libraryID");
  });

  it("answers library-not-found for a Library the source does not hold, and names it", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ library: '["personal","group:999"]' });

    expect(answer).toMatchObject({
      ok: false,
      diagnostic: {
        code: "library-not-found",
        report: { 0: expect.stringContaining("999") },
        details: { parameter: "library" },
      },
    });
  });
});

describe("zotlit:query default Libraries", () => {
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
      request: { library: ["personal", "group:4815"], limit: 100 },
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
    expect(answer.request).toMatchObject({ library: ["group:4815"] });
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
      request: { library: ["personal", "group:4815"] },
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
      contractVersion: 3,
      command: QUERY_COMMAND,
      ok: false,
      diagnostic: {
        code: "no-library-available",
        hint: expect.stringContaining("library="),
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

describe("zotlit:query fields", () => {
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
        found: "nope",
        hint: expect.any(String),
      },
    });
  });
});

describe("zotlit:query filter and sort", () => {
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
        hint: expect.any(String),
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

describe("zotlit:query borrowed source", () => {
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
        severity: "error",
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
      contractVersion: 3,
      command: QUERY_COMMAND,
      ok: false,
      diagnostic: {
        code: "unsupported-database-layout",
        report: { 0: expect.stringContaining("fieldsCombined.custom") },
        hint: expect.any(String),
      },
    });
    expect((answer.diagnostic as Diagnostic).report[0]).toContain(
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
      "ZotLit Query failed with an internal error.",
    );
    await expect(answering).rejects.toMatchObject({ cause: defect });
    await expect(answering).rejects.not.toMatchObject({ name: "AbortError" });
  });
});

describe("zotlit:query on the layout of the Zotero database", () => {
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
      const all = await run({ fields: "[]", library: "all" });

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

describe("zotlit:query cancellation", () => {
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
  dataset: "items" | "attachments" | "annotations" = "items",
) {
  const text = () =>
    Effect.runPromise(
      onJob(
        scenario.db,
        answer(
          {
            schema: true,
            dataset,
            command: QUERY_SCHEMA_COMMAND,
            pluginVersion: "2.2.0-beta.2",
            scope: MY_LIBRARY_SCOPE,
          },
          { identity: IDENTITY },
        ).pipe(Effect.map((reply: QueryReply) => reply.answer)),
      ),
    );
  return {
    text,
    run: async () => JSON.parse(await text()) as Record<string, unknown>,
  };
}

describe("zotlit:query-schema", () => {
  it.each(["items", "attachments", "annotations"] as const)(
    "lists key and file type fields in the live %s schema",
    async (dataset) => {
      using scenario = openScenarioDatabase({ annotations: true });
      const schema = await setupSchema(scenario, dataset).run();
      const fields = [
        "key",
        "indexedKey",
        ...(dataset === "items" ? [] : ["item.key", "item.indexedKey"]),
        ...(dataset === "attachments"
          ? ["fileType"]
          : dataset === "annotations"
            ? ["attachment.key", "attachment.indexedKey", "attachment.fileType"]
            : []),
      ];
      expect(schema).toMatchObject({
        ok: true,
        contractVersion: 3,
        datasets: { [dataset]: { fields: expect.arrayContaining(fields) } },
      });
    },
  );

  it("answers unsupported-database-layout for a copy that lacks a manifest column", async () => {
    using scenario = openScenarioDatabase();
    scenario.sqlite.exec('alter table "fieldsCombined" drop column "custom"');
    const { run } = setupSchema(scenario);

    const answer = await run();

    expect(answer).toMatchObject({
      command: QUERY_SCHEMA_COMMAND,
      ok: false,
      diagnostic: {
        code: "unsupported-database-layout",
        report: { 0: expect.stringContaining("fieldsCombined.custom") },
      },
    });
  });
});

it("answers contract v2 reports and warnings through the query envelope", async () => {
  using scenario = openScenarioDatabase();
  const run = setup(scenario).run;
  const failed = await run({ filter: 'creators.lastName == "Smith"' });
  expect(failed.contractVersion).toBe(3);
  const diagnostic = failed.diagnostic as Diagnostic;
  expect(diagnostic.report[0]).toBe(diagnostic.message);
  expect(diagnostic.report.at(-1)).toBe(diagnostic.hint);
  expect(diagnostic.excerpt?.at).toBe("lastName");
  expect(diagnostic.severity).toBe("error");
  const success = await run({ limit: "1" });
  expect(success.warnings).toEqual([]);
});

it("reports syntax facts and a correction through the CLI envelope", async () => {
  using scenario = openScenarioDatabase();
  const failed = await setup(scenario).run({
    filter: 'itemType == "book" AND date.year > 2010',
  });
  const diagnostic = failed.diagnostic as Diagnostic;
  expect(diagnostic.code).toBe("invalid-filter");
  expect(diagnostic.location?.span).toEqual({ from: 19, to: 22 });
  expect(diagnostic.found).toBe("AND");
  expect(diagnostic.expected).toContain("&&");
  expect(diagnostic.excerpt?.at).toBe("AND");
  expect(diagnostic.suggestions[0]).toBe(
    'itemType == "book" && date.year > 2010',
  );
  expect(diagnostic.report[0]).toBe(diagnostic.message);
  expect(diagnostic.report.at(-1)).toBe(diagnostic.hint);
});

it("keeps warning diagnostics before rows and drops them on failure", async () => {
  using scenario = openScenarioDatabase();
  const { run, query } = setup(scenario);
  const text = await Effect.runPromise(query({ filter: 'tags == "bulk"' }));
  const answer = JSON.parse(text);
  expect(answer).toMatchObject({
    ok: true,
    rows: [],
    warnings: [
      {
        code: "never-true",
        severity: "warning",
        suggestions: ['tags.contains("bulk")'],
        location: { argument: "filter", span: { from: 0, to: 14 } },
        excerpt: { at: 'tags == "bulk"' },
      },
    ],
  });
  expect(text.indexOf('"warnings"')).toBeLessThan(text.indexOf('"rows"'));
  for (const params of [
    { filter: 'tags == "bulk"', fields: '["missing"]' },
    { filter: 'tags == "bulk" && missing == "x"' },
  ] as CliData[]) {
    const failed = await run(params);
    expect(failed.ok).toBe(false);
    expect(failed).not.toHaveProperty("warnings");
  }
});

describe("zotlit:query export writer", () => {
  /** The bulk Library: more rows than the first chunk of an answer. */
  const BULK = {
    library: `group:${BULK_LIBRARY.groupID}`,
    limit: "all",
    fields: '["title","tags"]',
  };

  /**
   * The export of the bulk Library in the scope of a job, on its scheduler, to
   * an in-memory writer. `events` records the life of the writer and the end of
   * the scope.
   */
  function memoryExport(
    scenario: ScenarioDatabase,
    write: (count: number) => Effect.Effect<void, QueryOutputError>,
  ) {
    const events: string[] = [];
    let writes = 0;
    const openOutput = (): Effect.Effect<QueryWriter, never, Scope.Scope> =>
      Effect.acquireRelease(
        Effect.sync(() => events.push("open")),
        () => Effect.sync(() => events.push("close")),
      ).pipe(
        Effect.as({
          write: () =>
            Effect.suspend(() => {
              events.push("write");
              return write(++writes);
            }),
        }),
      );
    const run = answer(
      {
        schema: false,
        dataset: "items",
        command: QUERY_COMMAND,
        query: decoded({ ...BULK, output: "/exports/items.json" }),
        scope: MY_LIBRARY_SCOPE,
      },
      { identity: IDENTITY, openOutput },
    ).pipe(
      Effect.scoped,
      Effect.onExit(() => Effect.sync(() => events.push("scope-ended"))),
      Effect.provideService(ItemQueryDatabase, { client: scenario.db }),
      Effect.provideService(Scheduler.Scheduler, new ItemQueryScheduler()),
    );
    return { events, run };
  }

  it("ends interrupted between two chunks and closes the writer before the scope ends", async () => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, 600);
    const controller = new AbortController();
    // The head, then the first chunk of rows: the interrupt comes there.
    const { events, run } = memoryExport(scenario, (count) =>
      Effect.sync(() => {
        if (count === 2) controller.abort();
      }),
    );

    // The run starts in a later task, after Effect listens to the signal.
    const exit = await Effect.runPromiseExit(
      Effect.andThen(Effect.yieldNow, run),
      { signal: controller.signal },
    );

    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
      true,
    );
    expect(events).toEqual(["open", "write", "write", "close", "scope-ended"]);
  });

  it("answers output-error for a failed write and closes the writer before the scope ends", async () => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, 600);
    const { events, run } = memoryExport(scenario, (count) =>
      count === 2
        ? Effect.fail(
            new QueryOutputError({
              diagnostic: diagnostic("output-error", "The disk is full."),
            }),
          )
        : Effect.void,
    );

    const reply = await Effect.runPromise(run);

    expect(reply.receipt).toEqual({ kind: "inline" });
    expect(JSON.parse(reply.answer)).toMatchObject({
      ok: false,
      diagnostic: { code: "output-error", report: { 0: "The disk is full." } },
    });
    expect(events).toEqual(["open", "write", "write", "close", "scope-ended"]);
  });
});

it("answers and exports byte-identical grouped envelopes with exact counts", async () => {
  using scenario = openScenarioDatabase();
  let output = "";
  const { run } = setup(scenario, {
    openOutput: () =>
      Effect.succeed({
        write: (text) =>
          Effect.sync(() => {
            output += text;
          }),
      }),
  });
  const params = { group: "library", library: "all", limit: "1", fields: "[]" };
  const found = await run(params);
  expect(found).toMatchObject({
    request: { group: "library" },
    totalCount: 12,
    returnedCount: 2,
    truncated: true,
    groups: [
      { value: "group:4815", count: 2 },
      { value: "personal", count: 10 },
    ],
  });
  expect(found).not.toHaveProperty("rows");
  const receipt = await run({ ...params, output: "/exports/groups.json" });
  expect(output).toBe(JSON.stringify(found, null, 2));
  expect(receipt).toMatchObject({
    request: { group: "library" },
    totalCount: 12,
    returnedCount: 2,
    file: { bytes: Buffer.byteLength(output), format: "json" },
  });
  expect(receipt).not.toHaveProperty("rows");
  expect(receipt).not.toHaveProperty("groups");
});

it("encodes an empty grouped answer and the scalar-path Diagnostic Report", async () => {
  using scenario = openScenarioDatabase();
  const { run } = setup(scenario);
  const empty = await run({ group: "library", filter: "false" });
  expect(empty).toMatchObject({
    groups: [],
    totalCount: 0,
    returnedCount: 0,
    truncated: false,
  });
  expect(empty).not.toHaveProperty("rows");
  const invalid = await run({ group: "tags" });
  expect(invalid).toMatchObject({
    ok: false,
    diagnostic: {
      code: "invalid-group",
      location: { argument: "group" },
      suggestions: ["group='tags[].name'", "group='tags[].type'"],
    },
  });
});

it("answers and exports overlapping element groups with records counted once", async () => {
  using scenario = openScenarioDatabase();
  let output = "";
  const { run } = setup(scenario, {
    openOutput: () =>
      Effect.succeed({
        write: (text) =>
          Effect.sync(() => {
            output += text;
          }),
      }),
  });
  const params = {
    group: "tags[].name",
    filter: 'tags.contains("methods")',
    library: "personal",
    limit: "all",
    fields: "[]",
    sort: "key",
  };
  const found = await run(params);
  // ART2FULL has the Tags methods, to-read, and To-Read; ALS2CNFL has methods.
  expect(found).toMatchObject({
    request: { group: "tags[].name" },
    totalCount: 2,
    returnedCount: 4,
    truncated: false,
    groups: [
      {
        value: "methods",
        count: 2,
        rows: [{ indexedKey: "ALS2CNFL" }, { indexedKey: "ART2FULL" }],
      },
      { value: "to-read", count: 1, rows: [{ indexedKey: "ART2FULL" }] },
      { value: "To-Read", count: 1, rows: [{ indexedKey: "ART2FULL" }] },
    ],
  });
  const receipt = await run({ ...params, output: "/exports/tags.json" });
  expect(output).toBe(JSON.stringify(found, null, 2));
  expect(receipt).toMatchObject({ totalCount: 2, returnedCount: 4 });
});
