import { Effect, Scheduler } from "effect";
import type { CliData, CliHandler, Plugin } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { ItemQueryDatabase } from "@zotlit/db/item-query";
import { openScenarioDatabase } from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";
import { ItemQueryScheduler } from "@zotlit/item-query";

import { MY_LIBRARY_SCOPE } from "@/services/library-scope/scope";
import type { LibraryScope } from "@/services/library-scope/scope";

import { answer } from "./answer";
import {
  createQueryCancelHandler,
  guideHandler,
  registerQueryCli,
} from "./cli";
import {
  DIAGNOSTIC_HINTS,
  diagnostic,
  failure,
  QUERY_CANCEL_COMMAND,
  QUERY_COMMAND,
  QUERY_GUIDE_COMMAND,
  QUERY_SCHEMA_COMMAND,
} from "./contract";
import type { Diagnostic } from "./contract";
import { decodeQuery, rejectionDiagnostic } from "./decode";
import { GUIDE_EXAMPLES, GUIDE_FILTERS, GUIDE_TOPIC_NAMES } from "./guide";

const itemQueryGuideHandler = guideHandler;

/** Runs the Item Query of flat arguments on `scenario`, as a Query Job would. */
function runnerOf(
  scenario: ScenarioDatabase,
  scope: LibraryScope = MY_LIBRARY_SCOPE,
) {
  return async (params: CliData = {}) => {
    const query = decodeQuery(params);
    if (query.kind === "invalid")
      throw new Error(`Malformed test query: ${query.message}`);
    const reply = await Effect.runPromise(
      answer(
        {
          schema: false,
          dataset: query.value.from,
          command: QUERY_COMMAND,
          query: query.value,
          scope,
        },
        {
          identity: {
            vault: { name: "Research", path: "/vaults/research" },
            source: { id: "source-1", databasePath: "/zotero/zotero.sqlite" },
          },
        },
      ).pipe(
        Effect.scoped,
        Effect.provideService(ItemQueryDatabase, { client: scenario.db }),
        Effect.provideService(Scheduler.Scheduler, new ItemQueryScheduler()),
      ),
    );
    return JSON.parse(reply.answer) as Record<string, unknown>;
  };
}

describe("zotlit:query-cancel", () => {
  function cancelOf(active: readonly string[]) {
    const requested: string[] = [];
    const handler = createQueryCancelHandler((id) => {
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
      contractVersion: 3,
      command: QUERY_CANCEL_COMMAND,
      ok: true,
      id: "export-a",
      cancelRequested: true,
    });
    expect(requested).toEqual(["export-a"]);
  });

  it("answers that it requested no cancel for an ID with no active query", async () => {
    const { run } = cancelOf(["export-a"]);

    expect(await run({ id: "export-b" })).toEqual({
      contractVersion: 3,
      command: QUERY_CANCEL_COMMAND,
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
      command: QUERY_CANCEL_COMMAND,
      ok: false,
      diagnostic: { code: "invalid-argument", details: { parameter } },
    });
    expect(requested).toEqual([]);
  });
});

describe("zotlit:query-guide", () => {
  it("prints the quickstart as plain text with every command and topic", () => {
    const output = itemQueryGuideHandler({});

    expect(() => JSON.parse(output)).toThrow();
    for (const command of [
      QUERY_COMMAND,
      QUERY_CANCEL_COMMAND,
      QUERY_SCHEMA_COMMAND,
      QUERY_GUIDE_COMMAND,
    ]) {
      expect(output).toContain(command);
    }
    for (const topic of GUIDE_TOPIC_NAMES) expect(output).toContain(topic);
    expect(output).toContain(
      "obsidian zotlit:query [from=<items|attachments|annotations>]",
    );
    expect(output).toContain("[fields=<list|json>]");
    expect(output).toContain("[library=<list|all>]");
    expect(output).toContain("Library scope");
    expect(output).toContain("from=annotations");
  });

  it("prints the recovery text of each diagnostic code that the handlers answer", async () => {
    using scenario = openScenarioDatabase({ annotations: true });
    const output = itemQueryGuideHandler({ topic: "results" });
    const flat = output.replaceAll(/\s+/g, " ");
    const run = runnerOf(scenario, {
      mode: "selected",
      libraries: [{ type: "group", groupID: 999 }],
    });

    type Answered = { code: string; hint: string };
    // The renderer answers a malformed argument; the handler, the rest.
    const malformed = decodeQuery({ limit: "0" });
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
    [
      "results",
      [
        "diagnostic.report",
        "warnings",
        "suggestions",
        "severity",
        "location",
        "span",
      ],
    ],
    [
      "cancel",
      [
        "id=",
        "obsidian zotlit:query-cancel id=",
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
      contractVersion: 3,
      command: QUERY_GUIDE_COMMAND,
      ok: false,
      diagnostic: {
        code: "invalid-argument",
        details: { parameter: "topic" },
      },
    });
  });

  it("shows only commands and filters that run", async () => {
    using scenario = openScenarioDatabase({ annotations: true });
    scenario.sqlite
      .prepare(
        "insert into collections (collectionName, libraryID, key) values ('Shared key', 1, 'SHAREDCL')",
      )
      .run();
    const run = runnerOf(scenario);
    const failures: string[] = [];

    for (const args of GUIDE_EXAMPLES) {
      const answer = await run(args);
      if (!answer.ok) failures.push(JSON.stringify({ args, answer }));
      else expect(answer.warnings).toEqual([]);
    }
    for (const filter of GUIDE_FILTERS) {
      const answer = await run({ filter, fields: "[]" });
      if (!answer.ok) failures.push(JSON.stringify({ filter, answer }));
      else expect(answer.warnings).toEqual([]);
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

describe("registerQueryCli", () => {
  it("registers the command with its flags and cancels runs when the plugin unloads", async () => {
    const registerCliHandler = vi.fn();
    const onUnload: (() => void)[] = [];
    const plugin = {
      registerCliHandler,
      register: (callback: () => void) => onUnload.push(callback),
    } as unknown as Plugin;

    registerQueryCli(plugin, {
      query: async (_params, signal) => {
        signal.throwIfAborted();
        return "";
      },
      cancel: (id) => id === "export-a",
      schema: async () => "",
      values: async () => "values",
    });

    expect(registerCliHandler).toHaveBeenCalledWith(
      QUERY_COMMAND,
      expect.any(String),
      expect.objectContaining({
        filter: expect.any(Object),
        fields: expect.any(Object),
        sort: expect.any(Object),
        limit: expect.any(Object),
        library: expect.any(Object),
        from: expect.any(Object),
        id: expect.any(Object),
      }),
      expect.any(Function),
    );
    expect(registerCliHandler).toHaveBeenCalledWith(
      QUERY_CANCEL_COMMAND,
      expect.any(String),
      expect.objectContaining({ id: expect.any(Object) }),
      expect.any(Function),
    );
    expect(registerCliHandler).toHaveBeenCalledWith(
      "zotlit:query-values",
      expect.any(String),
      expect.objectContaining({
        kind: expect.any(Object),
        library: expect.any(Object),
        match: expect.any(Object),
        limit: expect.any(Object),
      }),
      expect.any(Function),
    );
    const values = registerCliHandler.mock.calls.find(
      ([command]) => command === "zotlit:query-values",
    )![3] as CliHandler;
    expect(await values({ kind: "collections" })).toBe("values");
    const cancel = registerCliHandler.mock.calls.find(
      ([command]) => command === QUERY_CANCEL_COMMAND,
    )![3] as CliHandler;
    expect(JSON.parse(await cancel({ id: "export-a" }))).toMatchObject({
      cancelRequested: true,
    });
    expect(registerCliHandler).toHaveBeenCalledWith(
      QUERY_SCHEMA_COMMAND,
      expect.any(String),
      expect.objectContaining({ from: expect.any(Object) }),
      expect.any(Function),
    );
    expect(registerCliHandler).toHaveBeenCalledWith(
      QUERY_GUIDE_COMMAND,
      expect.any(String),
      expect.objectContaining({ topic: expect.any(Object) }),
      expect.any(Function),
    );
    expect(registerCliHandler.mock.calls.map(([name]) => name)).toEqual([
      "zotlit:query",
      "zotlit:query-schema",
      "zotlit:query-values",
      "zotlit:query-guide",
      "zotlit:query-cancel",
    ]);
    const handler = registerCliHandler.mock.calls[0]![3] as CliHandler;
    for (const callback of onUnload) callback();
    await expect(handler({})).rejects.toMatchObject({ name: "AbortError" });
  });
});

it.each(Object.keys(DIAGNOSTIC_HINTS) as (keyof typeof DIAGNOSTIC_HINTS)[])(
  "renders operational %s without an excerpt",
  (code) => {
    const value = diagnostic(code, "Operational failure");
    const answer = JSON.parse(failure(QUERY_COMMAND, value)) as {
      diagnostic: Diagnostic;
    };
    expect(answer.diagnostic).toMatchObject({
      severity: "error",
      found: "",
      expected: [],
      suggestions: [],
    });
    expect(answer.diagnostic.report).toEqual([value.message, value.hint]);
    expect(answer.diagnostic.excerpt).toBeUndefined();
  },
);
