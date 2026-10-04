import { Exit } from "effect";
import { StatementSync } from "node:sqlite";
import type { CliData, CliHandler, Plugin } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";
import {
  BULK_LIBRARY,
  openScenarioDatabase,
  seedBulkLibrary,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import {
  answerExit,
  createItemQueryHandler,
  createItemQuerySchemaHandler,
  ITEM_QUERY_COMMAND,
  ITEM_QUERY_GUIDE_COMMAND,
  ITEM_QUERY_SCHEMA_COMMAND,
  itemQueryGuideHandler,
  registerItemQueryCli,
} from "./cli";
import type { ItemQueryCliDeps } from "./cli";
import { GUIDE_EXAMPLES, GUIDE_FILTERS, GUIDE_TOPIC_NAMES } from "./guide";

/** The driver call under every statement of the leased client. */
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

function setup(
  scenario: ScenarioDatabase,
  overrides: Partial<ItemQueryCliDeps> = {},
) {
  const events: string[] = [];
  const acquireRead = vi.fn(async () => {
    events.push("acquire");
    return {
      client: scenario.db,
      [Symbol.dispose]: () => events.push("release"),
    };
  });
  const deps: ItemQueryCliDeps = {
    acquireRead,
    identity: async () => IDENTITY,
    signal: new AbortController().signal,
    ...overrides,
  };
  const handler = createItemQueryHandler(deps);
  return {
    acquireRead,
    events,
    run: async (params: CliData = {}) => {
      const answer = await handler(params);
      events.push("answer");
      return JSON.parse(answer) as Record<string, unknown>;
    },
  };
}

const keys = (answer: Record<string, unknown>) =>
  (answer.rows as { indexedKey: string }[]).map((row) => row.indexedKey);

describe("zotlit:item-query without arguments", () => {
  it("answers the versioned envelope for the personal Library with the CLI defaults", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run();

    expect(answer).toMatchObject({
      contractVersion: 1,
      command: ITEM_QUERY_COMMAND,
      ok: true,
      identity: IDENTITY,
      library: { type: "personal" },
      request: {
        filter: null,
        sort: [{ field: "dateModified", direction: "desc" }],
        limit: 100,
      },
      returnedCount: 10,
      truncated: false,
    });
    expect(keys(answer)).toEqual(PERSONAL_BY_MODIFIED);
    expect(Object.keys(answer).slice(0, 3)).toEqual([
      "contractVersion",
      "command",
      "ok",
    ]);
  });

  it("answers pretty JSON", async () => {
    using scenario = openScenarioDatabase();
    const handler = createItemQueryHandler({
      acquireRead: async () => {
        return { client: scenario.db, [Symbol.dispose]: () => {} };
      },
      identity: async () => IDENTITY,
      signal: new AbortController().signal,
    });

    const answer = await handler({ limit: "1" });

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

  function handlerOf(
    scenario: ScenarioDatabase,
    overrides: Partial<ItemQueryCliDeps> = {},
  ) {
    return createItemQueryHandler({
      acquireRead: async () => ({
        client: scenario.db,
        [Symbol.dispose]: () => {},
      }),
      identity: async () => IDENTITY,
      signal: new AbortController().signal,
      ...overrides,
    });
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

    // One step with the first chunk of 64 rows and the chunk of the other
    // rows, and one step for the end of the envelope.
    expect(JSON.parse(answer)).toMatchObject({ returnedCount: 600 });
    expect(steps).toHaveLength(2);
  });

  it("rejects with the abort reason when the cancel request comes while it builds the answer", async () => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, 600);
    fastClock();
    const controller = new AbortController();
    const reason = new Error("plugin unloaded");
    const events: string[] = [];

    const answering = handlerOf(scenario, {
      acquireRead: async () => ({
        client: scenario.db,
        [Symbol.dispose]: () => events.push("release"),
      }),
      signal: controller.signal,
      onAnswerStep: () => {
        events.push("step");
        controller.abort(reason);
      },
    })({ ...BULK, fields: "[]" });

    await expect(answering).rejects.toBe(reason);
    expect(events).toEqual(["release", "step"]);
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

  it.each(["0", "-1", "1.5", "ten", "", "1e3", "99999999999999999999"])(
    "rejects limit=%j with the diagnostic envelope before it reads the source",
    async (limit) => {
      using scenario = openScenarioDatabase();
      const { run, acquireRead } = setup(scenario);

      const answer = await run({ limit });

      expect(answer).toMatchObject({
        contractVersion: 1,
        command: ITEM_QUERY_COMMAND,
        ok: false,
        diagnostic: {
          code: "invalid-argument",
          hint: expect.any(String),
          details: { parameter: "limit" },
        },
      });
      expect(acquireRead).not.toHaveBeenCalled();
    },
  );
});

describe("zotlit:item-query Target Library", () => {
  it("reads a group Library by its group ID and reports it with its name", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ library: "group:4815" });

    expect(answer.library).toEqual({
      type: "group",
      groupID: 4815,
      name: "Methods Reading Group",
    });
    expect(keys(answer)).toEqual(["ART2FULLg4815", "GRP2BK22g4815"]);
  });

  it("accepts library=personal", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ library: "personal" });

    expect(answer.library).toEqual({ type: "personal" });
    expect(keys(answer)).toEqual(PERSONAL_BY_MODIFIED);
  });

  it("answers library-not-found for a group the source does not hold, and releases the lease", async () => {
    using scenario = openScenarioDatabase();
    const { run, events } = setup(scenario);

    const answer = await run({ library: "group:999" });

    expect(answer).toMatchObject({
      ok: false,
      diagnostic: {
        code: "library-not-found",
        details: { parameter: "library" },
      },
    });
    expect(events).toEqual(["acquire", "release", "answer"]);
  });

  it.each(["group:", "group:abc", "group:0", "My Library", "1"])(
    "rejects library=%j",
    async (library) => {
      using scenario = openScenarioDatabase();
      const { run } = setup(scenario);

      const answer = await run({ library });

      expect(answer).toMatchObject({
        ok: false,
        diagnostic: {
          code: "invalid-argument",
          details: { parameter: "library" },
        },
      });
    },
  );
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

  it.each(['["title"', '"title"', "[1]", '{"0":"title"}'])(
    "rejects fields=%s",
    async (fields) => {
      using scenario = openScenarioDatabase();
      const { run } = setup(scenario);

      const answer = await run({ fields });

      expect(answer).toMatchObject({
        ok: false,
        diagnostic: {
          code: "invalid-argument",
          details: { parameter: "fields" },
        },
      });
    },
  );
});

describe("zotlit:item-query filter and sort", () => {
  it.each([
    ["filter", ""],
    ["filter", "   "],
    ["sort", "not json"],
    ["sort", '[{"field":"title"}]'],
    ["sort", '[{"field":"title","direction":"up"}]'],
    ["sort", '{"field":"title","direction":"asc"}'],
  ])("rejects %s=%j", async (parameter, value) => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ [parameter]: value });

    expect(answer).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-argument", details: { parameter } },
    });
  });
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

describe("zotlit:item-query parameters", () => {
  it("rejects an undeclared parameter", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ fields: "[]", colour: "red" });

    expect(answer).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-argument",
        details: { parameter: "colour" },
      },
    });
  });

  it("explains a vault parameter after the command name", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ vault: "Research" });

    expect(answer).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-argument",
        message: expect.stringContaining("before the command name"),
        details: { parameter: "vault" },
      },
    });
  });

  it("leaves Obsidian's own -- tokens alone", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario);

    const answer = await run({ "--copy": "true", limit: "1" });

    expect(answer.ok).toBe(true);
  });
});

describe("zotlit:item-query source and lease", () => {
  it("releases the lease before it answers", async () => {
    using scenario = openScenarioDatabase();
    const { run, events } = setup(scenario);

    await run({ limit: "1" });

    expect(events).toEqual(["acquire", "release", "answer"]);
  });

  it("answers the identity of the source it leased when the user connects another source in the run", async () => {
    using scenario = openScenarioDatabase();
    const other = {
      vault: IDENTITY.vault,
      source: { id: "source-2", databasePath: "/other/zotero.sqlite" },
    };
    let connected = IDENTITY;
    const { run } = setup(scenario, {
      acquireRead: async () => ({
        client: scenario.db,
        // The switch comes while the run holds the lease.
        [Symbol.dispose]: () => {
          connected = other;
        },
      }),
      identity: async () => connected,
    });

    const answer = await run();

    expect(answer).toMatchObject({ ok: true, identity: IDENTITY });
  });

  it("answers source-unavailable when the source cannot be leased", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setup(scenario, {
      acquireRead: async () => {
        throw new Error("Zotero database not found");
      },
    });

    const answer = await run();

    expect(answer).toMatchObject({
      ok: false,
      diagnostic: {
        code: "source-unavailable",
        message: expect.stringContaining("Zotero database not found"),
        hint: expect.any(String),
      },
    });
  });

  it("answers database-error when the leased database cannot be read", async () => {
    using scenario = openScenarioDatabase();
    const closed = openScenarioDatabase();
    const client = closed.db;
    closed.close();
    const { run, events } = setup(scenario, {
      acquireRead: async () => {
        events.push("acquire");
        return { client, [Symbol.dispose]: () => events.push("release") };
      },
    });

    const answer = await run();

    expect(answer).toMatchObject({
      ok: false,
      diagnostic: { code: "database-error", hint: expect.any(String) },
    });
    expect(events).toEqual(["acquire", "release", "answer"]);
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

      expect(personal).toMatchObject({
        ok: true,
        library: { type: "personal" },
        returnedCount: 10,
      });
      expect(group).toMatchObject({
        ok: true,
        library: {
          type: "group",
          groupID: 4815,
          name: "Methods Reading Group",
        },
        returnedCount: 2,
      });
    },
  );
});

describe("zotlit:item-query cancellation", () => {
  it("rejects with the abort reason and takes no lease when the signal is already aborted", async () => {
    using scenario = openScenarioDatabase();
    const controller = new AbortController();
    const reason = new Error("plugin unloaded");
    controller.abort(reason);
    const { run, acquireRead } = setup(scenario, { signal: controller.signal });

    await expect(run()).rejects.toBe(reason);
    expect(acquireRead).not.toHaveBeenCalled();
  });

  it("rejects with the abort reason when the run is cancelled, after it releases the lease", async () => {
    using scenario = openScenarioDatabase();
    const controller = new AbortController();
    const reason = new Error("plugin unloaded");
    const { run, events } = setup(scenario, { signal: controller.signal });

    const running = run();
    controller.abort(reason);

    await expect(running).rejects.toBe(reason);
    expect(events).toEqual(["acquire", "release"]);
  });

  it("releases the lease after the last database read and before a cancelled run settles", async () => {
    using scenario = openScenarioDatabase();
    const controller = new AbortController();
    const reason = new Error("plugin unloaded");
    const { run, events } = setup(scenario, { signal: controller.signal });
    // Warm the copy, then count the reads of one complete run.
    await run({ fields: '["title"]' });
    const read = vi.spyOn(StatementSync.prototype, "all");
    await run({ fields: '["title"]' });
    const complete = read.mock.calls.length;
    expect(complete).toBeGreaterThan(3);

    // Every read of the clock is 3 ms later, so the scheduler ends a slice
    // after each operation. Effect listens to the signal from the first pause.
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 3));
    // Cancel inside the third database read of the query.
    events.length = 0;
    read.mockImplementation(function (this: StatementSync, ...values) {
      if (events.push("read") === 4) controller.abort(reason);
      return Reflect.apply(readRows, this, values) as ReturnType<
        StatementSync["all"]
      >;
    });

    await expect(run({ fields: '["title"]' })).rejects.toBe(reason);
    events.push("settled");

    expect(events).toEqual([
      "acquire",
      "read",
      "read",
      "read",
      "release",
      "settled",
    ]);
  });
});

describe("answerExit", () => {
  const context = {
    identity: IDENTITY,
    library: { type: "personal" } as const,
    signal: new AbortController().signal,
  };

  it("answers database-error for a database failure", async () => {
    const exit = Exit.fail(
      new ItemQueryDatabaseError({
        query: "select 1",
        params: [],
        cause: new Error("disk I/O error"),
      }),
    );

    const answer = JSON.parse(await answerExit(exit, context));

    expect(answer).toMatchObject({
      contractVersion: 1,
      ok: false,
      diagnostic: {
        code: "database-error",
        message: expect.stringContaining("disk I/O error"),
      },
    });
  });

  it("answers unsupported-database-layout for a layout this ZotLit cannot read", async () => {
    const exit = Exit.fail(
      new ItemQueryLayoutError({
        missing: [
          { table: "itemData", column: null },
          { table: "items", column: "itemTypeID" },
        ],
        versions: { userdata: 131, compatibility: 10 },
      }),
    );

    const answer = JSON.parse(await answerExit(exit, context));

    expect(answer).toMatchObject({
      contractVersion: 1,
      command: "zotlit:item-query",
      ok: false,
      diagnostic: {
        code: "unsupported-database-layout",
        message: expect.stringContaining("items.itemTypeID"),
        hint: expect.stringContaining("update ZotLit"),
      },
    });
    expect(answer.diagnostic.message).toContain("the table itemData");
  });

  it("rejects with an Error for a defect, distinct from a cancellation", async () => {
    const defect = new TypeError("boom");

    const answering = answerExit(Exit.die(defect), context);

    await expect(answering).rejects.toThrow(
      "Item Query failed with an internal error.",
    );
    await expect(answering).rejects.toMatchObject({ cause: defect });
  });

  it("rejects with an AbortError for an interruption without an abort reason", async () => {
    const answering = answerExit(Exit.interrupt(), context);

    await expect(answering).rejects.toMatchObject({ name: "AbortError" });
  });
});

function setupSchema(
  scenario: ScenarioDatabase,
  overrides: Partial<ItemQueryCliDeps> = {},
) {
  const events: string[] = [];
  const acquireRead = vi.fn(async () => {
    events.push("acquire");
    return {
      client: scenario.db,
      [Symbol.dispose]: () => events.push("release"),
    };
  });
  const handler = createItemQuerySchemaHandler({
    acquireRead,
    identity: async () => IDENTITY,
    signal: new AbortController().signal,
    ...overrides,
  });
  return {
    acquireRead,
    events,
    text: async (params: CliData = {}) => {
      const answer = await handler(params);
      events.push("answer");
      return answer;
    },
    run: async (params: CliData = {}) => {
      const answer = await handler(params);
      events.push("answer");
      return JSON.parse(answer) as Record<string, unknown>;
    },
  };
}

describe("zotlit:item-query-schema", () => {
  it("answers the Item Query Schema of the source in the versioned envelope, as pretty JSON", async () => {
    using scenario = openScenarioDatabase();
    const { text, events } = setupSchema(scenario);

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
        fields: expect.arrayContaining([
          {
            path: "title",
            type: "string",
            filter: "string",
            projection: true,
            sort: true,
          },
        ]),
        customFields: expect.arrayContaining([
          expect.objectContaining({ name: "mood", bareName: true }),
          expect.objectContaining({ name: "review.status", bareName: false }),
        ]),
        functions: expect.arrayContaining([
          expect.objectContaining({ name: "today" }),
        ]),
      },
    });
    expect(events).toEqual(["acquire", "release", "answer"]);
  });

  it("reports the CLI defaults: 100 rows of My Library, newest modification first", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setupSchema(scenario);

    const answer = await run();

    expect((answer.schema as { defaults: unknown }).defaults).toEqual({
      fields: ["itemType", "title", "creators", "date", "dateModified"],
      sort: [{ field: "dateModified", direction: "desc" }],
      limit: 100,
      library: "personal",
    });
  });

  it("rejects a parameter before it reads the source", async () => {
    using scenario = openScenarioDatabase();
    const { run, acquireRead } = setupSchema(scenario);

    const answer = await run({ library: "personal" });

    expect(answer).toMatchObject({
      contractVersion: 1,
      command: ITEM_QUERY_SCHEMA_COMMAND,
      ok: false,
      diagnostic: {
        code: "invalid-argument",
        details: { parameter: "library" },
      },
    });
    expect(acquireRead).not.toHaveBeenCalled();
  });

  it("answers the identity of the source it leased when the user connects another source in the run", async () => {
    using scenario = openScenarioDatabase();
    const other = {
      vault: IDENTITY.vault,
      source: { id: "source-2", databasePath: "/other/zotero.sqlite" },
    };
    let connected = IDENTITY;
    const { run } = setupSchema(scenario, {
      acquireRead: async () => ({
        client: scenario.db,
        // The switch comes while the run holds the lease.
        [Symbol.dispose]: () => {
          connected = other;
        },
      }),
      identity: async () => connected,
    });

    const answer = await run();

    expect(answer).toMatchObject({ ok: true, identity: IDENTITY });
  });

  it("answers source-unavailable when the source cannot be leased", async () => {
    using scenario = openScenarioDatabase();
    const { run } = setupSchema(scenario, {
      acquireRead: async () => {
        throw new Error("Zotero database not found");
      },
    });

    const answer = await run();

    expect(answer).toMatchObject({
      command: ITEM_QUERY_SCHEMA_COMMAND,
      ok: false,
      diagnostic: { code: "source-unavailable" },
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

  it("rejects with the abort reason and takes no lease when the signal is already aborted", async () => {
    using scenario = openScenarioDatabase();
    const controller = new AbortController();
    const reason = new Error("plugin unloaded");
    controller.abort(reason);
    const { run, acquireRead } = setupSchema(scenario, {
      signal: controller.signal,
    });

    await expect(run()).rejects.toBe(reason);
    expect(acquireRead).not.toHaveBeenCalled();
  });
});

describe("zotlit:item-query-guide", () => {
  it("prints the quickstart as plain text with every command and topic", () => {
    const output = itemQueryGuideHandler({});

    expect(() => JSON.parse(output)).toThrow();
    for (const command of [
      ITEM_QUERY_COMMAND,
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
    expect(output).toContain(
      "returns at most\n  100 rows, sorted by dateModified descending.\n  Each row has itemType, title, creators, date, and dateModified.",
    );
    expect(output).toContain("My Library");
  });

  it.each([
    ["filter", ["key is the Zotero Key", "attachments", "lower()", "within"]],
    ["fields", ['custom["<exact name>"]', "fields='[]'", "null"]],
    ["sort", ["10 comes before 9", "first possible day", "limit", "all"]],
    ["results", ["diagnostic.hint", "location", "span"]],
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
    const acquireRead = vi.fn();

    registerItemQueryCli(plugin, {
      acquireRead,
      identity: async () => IDENTITY,
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
      }),
      expect.any(Function),
    );
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
    expect(acquireRead).not.toHaveBeenCalled();
  });
});
