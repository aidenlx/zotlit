import { Exit } from "effect";
import type { CliData, CliHandler, Plugin } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ItemQueryDatabaseError } from "@zotlit/db/item-query";
import { openScenarioDatabase } from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import {
  answerExit,
  createItemQueryHandler,
  ITEM_QUERY_COMMAND,
  registerItemQueryCli,
} from "./cli";
import type { ItemQueryCliDeps } from "./cli";

let scenario: ScenarioDatabase | undefined;

afterEach(() => {
  scenario?.close();
  scenario = undefined;
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

function setup(overrides: Partial<ItemQueryCliDeps> = {}) {
  const events: string[] = [];
  const acquireRead = vi.fn(async () => {
    scenario ??= openScenarioDatabase();
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
    const { run } = setup();

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
});

describe("zotlit:item-query limit", () => {
  it("returns the first rows and reports truncation for a numeric limit", async () => {
    const { run } = setup();

    const answer = await run({ limit: "3" });

    expect(keys(answer)).toEqual(PERSONAL_BY_MODIFIED.slice(0, 3));
    expect(answer).toMatchObject({
      request: { limit: 3 },
      returnedCount: 3,
      truncated: true,
    });
  });

  it("normalizes limit=all to null and returns every match", async () => {
    const { run } = setup();

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
      const { run, acquireRead } = setup();

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
    const { run } = setup();

    const answer = await run({ library: "group:4815" });

    expect(answer.library).toEqual({
      type: "group",
      groupID: 4815,
      name: "Methods Reading Group",
    });
    expect(keys(answer)).toEqual(["ART2FULLg4815", "GRP2BK22g4815"]);
  });

  it("accepts library=personal", async () => {
    const { run } = setup();

    const answer = await run({ library: "personal" });

    expect(answer.library).toEqual({ type: "personal" });
    expect(keys(answer)).toEqual(PERSONAL_BY_MODIFIED);
  });

  it("answers library-not-found for a group the source does not hold, and releases the lease", async () => {
    const { run, events } = setup();

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
      const { run } = setup();

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
    const { run } = setup();

    const answer = await run({ fields: "[]", limit: "2" });

    expect(answer.rows).toEqual([
      { indexedKey: "ART2FULL", values: {} },
      { indexedKey: "UNI2CDE2", values: {} },
    ]);
    expect(answer.request).toMatchObject({ fields: [] });
  });

  it("writes Temporal values as ISO strings, nested ones included", async () => {
    const { run } = setup();

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
    const { run } = setup();

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
      const { run } = setup();

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
    const { run } = setup();

    const answer = await run({ [parameter]: value });

    expect(answer).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-argument", details: { parameter } },
    });
  });
  // Until the engine takes it (#1321): a query that dropped it would return
  // Items the caller did not ask for.
  it.each([["filter", 'tags.contains("to-read")']])(
    "refuses a well-formed %s that the engine does not take yet",
    async (parameter, value) => {
      const { run, acquireRead } = setup();

      const answer = await run({ [parameter]: value });

      expect(answer).toMatchObject({
        ok: false,
        diagnostic: { code: "invalid-argument", details: { parameter } },
      });
      expect(acquireRead).not.toHaveBeenCalled();
    },
  );

  it("passes a well-formed sort through to the engine and echoes it", async () => {
    const { run } = setup();

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
    const { run } = setup();

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
    const { run } = setup();

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
    const { run } = setup();

    const answer = await run({ "--copy": "true", limit: "1" });

    expect(answer.ok).toBe(true);
  });
});

describe("zotlit:item-query source and lease", () => {
  it("releases the lease before it answers", async () => {
    const { run, events } = setup();

    await run({ limit: "1" });

    expect(events).toEqual(["acquire", "release", "answer"]);
  });

  it("answers source-unavailable when the source cannot be leased", async () => {
    const { run } = setup({
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
    const closed = openScenarioDatabase();
    const client = closed.db;
    closed.close();
    const { run, events } = setup({
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

describe("zotlit:item-query cancellation", () => {
  it("rejects with the abort reason and takes no lease when the signal is already aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("plugin unloaded");
    controller.abort(reason);
    const { run, acquireRead } = setup({ signal: controller.signal });

    await expect(run()).rejects.toBe(reason);
    expect(acquireRead).not.toHaveBeenCalled();
  });

  it("rejects with the abort reason when the run is cancelled, after it releases the lease", async () => {
    const controller = new AbortController();
    const reason = new Error("plugin unloaded");
    const { run, events } = setup({ signal: controller.signal });

    const running = run();
    controller.abort(reason);

    await expect(running).rejects.toBe(reason);
    expect(events).toEqual(["acquire", "release"]);
  });
});

describe("answerExit", () => {
  const context = {
    identity: async () => IDENTITY,
    library: { type: "personal" } as const,
    filter: undefined,
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
    const handler = registerCliHandler.mock.calls[0]![3] as CliHandler;
    for (const callback of onUnload) callback();
    await expect(handler({})).rejects.toMatchObject({ name: "AbortError" });
    expect(acquireRead).not.toHaveBeenCalled();
  });
});
