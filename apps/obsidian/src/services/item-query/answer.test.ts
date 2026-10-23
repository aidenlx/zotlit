import { StatementSync } from "node:sqlite";
import type { CliData } from "obsidian";
import { afterEach, describe, expect, vi } from "vitest";

import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { ItemQueryDatabase } from "@zotlit/db/item-query";
import {
  BULK_LIBRARY,
  openScenarioDatabase,
  seedBulkLibrary,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";
import { ItemQueryScheduler } from "@zotlit/item-query";

import { Cause, Effect, Exit, Fiber, Scheduler } from "@/lib/effect";
import type { Scope } from "@/lib/effect";
import { acquireDisposable } from "@/lib/effect-scope";
import { it } from "@/lib/effect-vitest";
import {
  DEFAULT_LIBRARY_SCOPE,
  MY_LIBRARY_SCOPE,
} from "@/services/library-scope/scope";
import type { LibraryScope } from "@/services/library-scope/scope";

import { workerQuery } from "./__fixtures__/worker-query";
import { answer, QueryOutputError } from "./answer";
import type { AnswerEnv, QueryWriter } from "./answer";
import { diagnostic, QUERY_COMMAND, QUERY_SCHEMA_COMMAND } from "./contract";
import type { Diagnostic } from "./contract";
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
          dataset: workerQuery(params).from,
          command: QUERY_COMMAND,
          query: workerQuery(params),
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
    run: (params: CliData = {}) =>
      query(params).pipe(
        Effect.map((answer) => JSON.parse(answer) as Record<string, unknown>),
      ),
  };
}

/**
 * Run `effect` to its exit; aborting `signal`, as a cancel does, interrupts
 * it wherever it is.
 */
function exitOf<A>(
  effect: Effect.Effect<A>,
  signal: AbortSignal,
): Effect.Effect<Exit.Exit<A>> {
  return Effect.gen(function* () {
    // Scheduled, not started: the listener is in place before the run's
    // first step.
    const run = yield* Effect.forkChild(effect, { startImmediately: false });
    const interrupt = () => run.interruptUnsafe();
    if (signal.aborted) interrupt();
    else signal.addEventListener("abort", interrupt, { once: true });
    return yield* Fiber.await(run);
  });
}

/** The scenario database, held for the case's scope. */
const scenarioOf = (options?: Parameters<typeof openScenarioDatabase>[0]) =>
  acquireDisposable(() => openScenarioDatabase(options));

/** The run ended by interruption alone. */
function expectInterrupted<A, E>(exit: Exit.Exit<A, E>): void {
  expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
    true,
  );
}

const keys = (answer: Record<string, unknown>) =>
  (answer.rows as { indexedKey: string }[]).map((row) => row.indexedKey);

describe("zotlit:query without arguments", () => {
  it.effect(
    "answers the versioned envelope for the Library Scope with the CLI defaults",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        const { run } = setup(scenario);

        const answer = yield* run();

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
      }),
  );
});

describe("zotlit:query answer", () => {
  /**
   * One tick per read leaves room for a resumed effect to make progress
   * within the production slice budget.
   */
  function fastClock() {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 1));
  }

  /** The bulk Library: more rows than the first chunk of an answer. */
  const BULK = { library: `group:${BULK_LIBRARY.groupID}`, limit: "all" };

  it.effect.each<CliData>([
    { limit: "all" },
    { limit: "all", fields: "[]" },
    { limit: "1", fields: '["title","creators","date","tags","custom"]' },
    { filter: "false" },
    { ...BULK, fields: '["title","dateAdded","tags"]' },
    { ...BULK, fields: "[]" },
    { ...BULK, group: "library", fields: '["title","dateAdded","tags"]' },
    { ...BULK, group: "title", fields: "[]" },
    { group: "library", filter: "false" },
  ])("is the pretty JSON of its envelope for %j", (params) =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
      seedBulkLibrary(scenario.sqlite, 600);
      fastClock();

      const answer = yield* queryOf(scenario)(params);

      expect(answer).toBe(JSON.stringify(JSON.parse(answer), null, 2));
      expect(Object.keys(JSON.parse(answer) as object).at(-1)).toBe(
        params.group === undefined ? "rows" : "groups",
      );
    }),
  );

  it.effect(
    "builds the rows in steps and gives the window a turn between them",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        seedBulkLibrary(scenario.sqlite, 600);
        fastClock();
        const steps: number[] = [];

        const answer = yield* queryOf(scenario, {
          onAnswerStep: (ms) => steps.push(ms),
        })({ ...BULK, fields: '["title"]' });

        // Each projection batch is encoded before the next batch is read.
        expect(JSON.parse(answer)).toMatchObject({ returnedCount: 600 });
        expect(steps.length).toBeGreaterThan(1);
      }),
  );

  it.effect(
    "ends interrupted when the interrupt comes while it builds the answer",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        seedBulkLibrary(scenario.sqlite, 600);
        fastClock();
        const controller = new AbortController();

        const exit = yield* exitOf(
          queryOf(scenario, { onAnswerStep: () => controller.abort() })({
            ...BULK,
            fields: "[]",
          }),
          controller.signal,
        );

        expectInterrupted(exit);
      }),
  );
});

describe("zotlit:query limit", () => {
  it.effect(
    "returns the first rows and reports truncation for a numeric limit",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        const { run } = setup(scenario);

        const answer = yield* run({ limit: "3" });

        expect(keys(answer)).toEqual(PERSONAL_BY_MODIFIED.slice(0, 3));
        expect(answer).toMatchObject({
          request: { limit: 3 },
          returnedCount: 3,
          truncated: true,
          warnings: [],
        });
      }),
  );

  it.effect("normalizes limit=all to null and returns every match", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
      const { run } = setup(scenario);

      const answer = yield* run({ limit: "all" });

      expect(keys(answer)).toEqual(PERSONAL_BY_MODIFIED);
      expect(answer).toMatchObject({
        request: { limit: null },
        truncated: false,
        warnings: [],
      });
    }),
  );
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
  it.effect(
    "reads a group Library by its group ID and reports it with its name",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        const { run } = setup(scenario);

        const answer = yield* run({ library: "group:4815" });

        expect(answer.libraries).toEqual([METHODS_GROUP_WIRE]);
        expect(answer.request).toMatchObject({ library: ["group:4815"] });
        expect(keys(answer)).toEqual(["ART2FULLg4815", "GRP2BK22g4815"]);
      }),
  );

  it.effect(
    "reads the personal Library alone for library=personal, whatever the Library Scope is",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        const { run } = setup(scenario, { scope: DEFAULT_LIBRARY_SCOPE });

        const answer = yield* run({ library: "personal" });

        expect(answer.libraries).toEqual([PERSONAL_WIRE]);
        expect(answer.request).toMatchObject({ library: ["personal"] });
        expect(keys(answer)).toEqual(PERSONAL_BY_MODIFIED);
      }),
  );

  it.effect(
    "answers library-not-found for a group the source does not hold",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        const { run } = setup(scenario);

        const answer = yield* run({ library: "group:999" });

        expect(answer).toMatchObject({
          ok: false,
          diagnostic: {
            code: "library-not-found",
            report: { 0: expect.stringContaining("999") },
            details: { parameter: "library" },
          },
        });
      }),
  );
});

describe("zotlit:query libraries", () => {
  it.effect("reads the named Libraries as one result set", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
      const { run } = setup(scenario);

      const answer = yield* run({ library: '["personal","group:4815"]' });

      expect(answer).toMatchObject({
        ok: true,
        libraries: [PERSONAL_WIRE, METHODS_GROUP_WIRE],
        request: { library: ["personal", "group:4815"] },
        returnedCount: 12,
        truncated: false,
        warnings: [],
      });
      expect(keys(answer)).toEqual(BOTH_BY_MODIFIED);
    }),
  );

  it.effect("limits the one result set, not each Library", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
      const { run } = setup(scenario);

      const answer = yield* run({
        library: '["personal","group:4815"]',
        limit: "3",
      });

      expect(answer).toMatchObject({ returnedCount: 3, truncated: true });
      expect(keys(answer)).toEqual(BOTH_BY_MODIFIED.slice(0, 3));
    }),
  );

  it.effect(
    "reports the Libraries in the canonical order, whatever order the caller gives",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        seedBulkLibrary(scenario.sqlite, 1);
        const { run } = setup(scenario);

        const answer = yield* run({
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
      }),
  );

  it.effect(
    "reads a Library outside the Library Scope when the caller names it",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        const { run } = setup(scenario);

        const answer = yield* run({ library: '["group:4815"]' });

        expect(answer.libraries).toEqual([METHODS_GROUP_WIRE]);
        expect(keys(answer)).toEqual(["ART2FULLg4815", "GRP2BK22g4815"]);
      }),
  );

  it.effect(
    "reads every Library of the source for libraries=all, whatever the Library Scope is",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        const { run } = setup(scenario);

        const answer = yield* run({ library: "all" });

        expect(answer.libraries).toEqual([PERSONAL_WIRE, METHODS_GROUP_WIRE]);
        expect(answer.request).toMatchObject({
          library: ["personal", "group:4815"],
        });
        expect(keys(answer)).toEqual(BOTH_BY_MODIFIED);
      }),
  );

  it.effect(
    "answers source-unavailable for libraries=all on a source without a Library",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        scenario.sqlite.exec(
          "pragma foreign_keys = off; delete from groups; delete from libraries",
        );
        const { run } = setup(scenario);

        const answer = yield* run({ library: "all" });

        expect(answer).toMatchObject({
          ok: false,
          diagnostic: {
            code: "source-unavailable",
            severity: "error",
          },
        });
        expect(JSON.stringify(answer)).not.toContain("libraries=all");
      }),
  );

  it.effect("keeps local library IDs out of the answer", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
      const { run } = setup(scenario);

      const answer = yield* run({ library: "all", limit: "1" });

      expect(JSON.stringify(answer)).not.toContain("libraryID");
    }),
  );

  it.effect(
    "answers library-not-found for a Library the source does not hold, and names it",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        const { run } = setup(scenario);

        const answer = yield* run({ library: '["personal","group:999"]' });

        expect(answer).toMatchObject({
          ok: false,
          diagnostic: {
            code: "library-not-found",
            report: { 0: expect.stringContaining("999") },
            details: { parameter: "library" },
          },
        });
      }),
  );
});

describe("zotlit:query default Libraries", () => {
  const scoped = (scope: LibraryScope) => ({ scope });
  const selected = (
    ...libraries: Extract<LibraryScope, { mode: "selected" }>["libraries"]
  ): LibraryScope => ({ mode: "selected", libraries });

  it.effect(
    "reads every Library of the source when the Library Scope is All Libraries",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        const { run } = setup(scenario, scoped(DEFAULT_LIBRARY_SCOPE));

        const answer = yield* run();

        expect(answer).toMatchObject({
          ok: true,
          libraries: [PERSONAL_WIRE, METHODS_GROUP_WIRE],
          request: { library: ["personal", "group:4815"], limit: 100 },
          returnedCount: 12,
        });
        expect(keys(answer)).toEqual(BOTH_BY_MODIFIED);
      }),
  );

  it.effect("reads the Selected Libraries", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
      seedBulkLibrary(scenario.sqlite, 1);
      const { run } = setup(
        scenario,
        scoped(selected({ type: "group", groupID: 4815 })),
      );

      const answer = yield* run();

      expect(answer.libraries).toEqual([METHODS_GROUP_WIRE]);
      expect(answer.request).toMatchObject({ library: ["group:4815"] });
      expect(keys(answer)).toEqual(["ART2FULLg4815", "GRP2BK22g4815"]);
    }),
  );

  it.effect("leaves out a Selected Library that the source does not hold", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
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

      const answer = yield* run();

      expect(answer).toMatchObject({
        ok: true,
        libraries: [PERSONAL_WIRE, METHODS_GROUP_WIRE],
        request: { library: ["personal", "group:4815"] },
        returnedCount: 12,
      });
    }),
  );

  it.effect(
    "answers no-library-available when the source holds no Selected Library",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        const { run } = setup(
          scenario,
          scoped(selected({ type: "group", groupID: 999 })),
        );

        const answer = yield* run();

        expect(answer).toMatchObject({
          contractVersion: 3,
          command: QUERY_COMMAND,
          ok: false,
          diagnostic: {
            code: "no-library-available",
            hint: expect.stringContaining("library="),
          },
        });
      }),
  );

  it.effect("resolves the Library Scope on the borrowed source", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
      const { run } = setup(scenario, scoped(DEFAULT_LIBRARY_SCOPE));
      // The group leaves the source: the borrowed copy decides.
      scenario.sqlite.exec("delete from groups where groupID = 4815");

      const answer = yield* run();

      expect(answer.libraries).toEqual([PERSONAL_WIRE]);
      expect(keys(answer)).toEqual(PERSONAL_BY_MODIFIED);
    }),
  );
});

describe("zotlit:query fields", () => {
  it.effect("returns identity-only rows for fields=[]", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
      const { run } = setup(scenario);

      const answer = yield* run({ fields: "[]", limit: "2" });

      expect(answer.rows).toEqual([
        { indexedKey: "ART2FULL", values: {} },
        { indexedKey: "UNI2CDE2", values: {} },
      ]);
      expect(answer.request).toMatchObject({ fields: [] });
    }),
  );

  it.effect("writes Temporal values as ISO strings, nested ones included", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
      const { run } = setup(scenario);

      const answer = yield* run({
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
    }),
  );

  it.effect("answers the code, location, and hint of an unknown field", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
      const { run } = setup(scenario);

      const answer = yield* run({ fields: '["itemType","nope"]' });

      expect(answer).toMatchObject({
        ok: false,
        diagnostic: {
          code: "unknown-field",
          location: { argument: "fields", index: 1 },
          found: "nope",
          hint: expect.any(String),
        },
      });
    }),
  );
});

describe("zotlit:query Query Context", () => {
  it.effect(
    "binds this.item and this.attachment, and echoes the Query Context",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ annotations: true });
        const { run } = setup(scenario);

        const answer = yield* run({
          from: "annotations",
          filter:
            'item == this.item && attachment == this.attachment && type == "underline"',
          fields: "[]",
          "this-item": "ART2FULL",
          "this-attachment": "PDF2LIVE",
        });

        expect(answer).toMatchObject({
          ok: true,
          request: { context: { item: "ART2FULL", attachment: "PDF2LIVE" } },
        });
        expect(keys(answer)).toEqual(["ANN2UNDR"]);
      }),
  );

  it.effect(
    "answers a filter that reads this without a binding with unbound-context",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ annotations: true });
        const { run } = setup(scenario);

        const answer = yield* run({
          from: "annotations",
          filter: "item == this.item",
        });

        expect(answer).toMatchObject({
          ok: false,
          diagnostic: {
            code: "unbound-context",
            location: { argument: "filter", span: { from: 8, to: 17 } },
          },
        });
      }),
  );
});

describe("zotlit:query filter and sort", () => {
  it.effect(
    "passes a well-formed filter through to the engine and echoes it",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        const { run } = setup(scenario);
        const filter = 'tags.contains("to-read")';

        const answer = yield* run({ filter });

        expect(answer).toMatchObject({ ok: true, request: { filter } });
        expect(keys(answer)).toEqual(["ART2FULL", "BK2MNTH2"]);
      }),
  );

  it.effect(
    "answers an invalid filter with the code, the location in the filter text, and the hint",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        const { run } = setup(scenario);

        const answer = yield* run({ filter: "title.startsWith(1)" });

        expect(answer).toMatchObject({
          ok: false,
          diagnostic: {
            code: "wrong-argument-type",
            location: { argument: "filter", span: { from: 17, to: 18 } },
            hint: expect.any(String),
          },
        });
      }),
  );

  it.effect(
    "passes a well-formed sort through to the engine and echoes it",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        const { run } = setup(scenario);

        const answer = yield* run({
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
      }),
  );
});

describe("zotlit:query borrowed source", () => {
  it.effect("answers the source identity supplied by its caller", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
      const source = {
        id: "leased-source",
        databasePath: "/leased/zotero.sqlite",
      };
      const { run } = setup(scenario, {
        identity: { ...IDENTITY, source },
      });

      const answer = yield* run();

      expect(answer).toMatchObject({
        ok: true,
        identity: { ...IDENTITY, source },
      });
    }),
  );

  it.effect(
    "answers database-error when the borrowed database cannot be read",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        const closed = openScenarioDatabase();
        const client = closed.db;
        closed.close();
        const { run } = setup(scenario, {
          client,
        });

        const answer = yield* run();

        expect(answer).toMatchObject({
          ok: false,
          diagnostic: {
            code: "database-error",
            severity: "error",
            hint: expect.any(String),
          },
        });
      }),
  );

  it.effect(
    "answers unsupported-database-layout for a copy that lacks a manifest table or column",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        scenario.sqlite.exec(
          'pragma foreign_keys = off; drop table "itemDataValues"; alter table "fieldsCombined" drop column "custom"',
        );
        const { run } = setup(scenario);

        const answer = yield* run();

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
      }),
  );

  it.effect(
    "rejects with an Error for a defect, distinct from a cancellation",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        const defect = new TypeError("boom");
        const { run } = setup(scenario, {
          openOutput: () => Effect.die(defect),
        });

        const exit = yield* Effect.exit(run({ output: "/exports/items.json" }));

        expect(Exit.isFailure(exit)).toBe(true);
        const error = Exit.isFailure(exit)
          ? Cause.squash(exit.cause)
          : undefined;
        expect(() => {
          throw error;
        }).toThrow("ZotLit Query failed with an internal error.");
        expect(error).toMatchObject({ cause: defect });
        expect(error).not.toMatchObject({ name: "AbortError" });
      }),
  );
});

describe("zotlit:query on the layout of the Zotero database", () => {
  it.effect.each([
    ["the lowest supported layout", null],
    ["the lowest layout stamped outside the supported range", 999],
  ] as const)(
    "resolves the personal and a group Library on %s",
    ([, userdata]) =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ layout: "lowest" });
        if (userdata !== null) {
          scenario.sqlite
            .prepare("update version set version = ? where schema = 'userdata'")
            .run(userdata);
        }
        const { run } = setup(scenario);

        const personal = yield* run({ fields: "[]" });
        const group = yield* run({ fields: "[]", library: "group:4815" });
        const all = yield* run({ fields: "[]", library: "all" });

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
      }),
  );
});

describe("zotlit:query cancellation", () => {
  it.effect("ends interrupted when the interrupt comes before it answers", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
      const controller = new AbortController();
      const { query } = setup(scenario);

      // A named Library starts execution without awaiting the default scope.
      controller.abort();

      expectInterrupted(
        yield* exitOf(query({ library: "personal" }), controller.signal),
      );
    }),
  );

  it.effect("stops database reads before an interrupted run settles", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
      const controller = new AbortController();
      const { run, query } = setup(scenario);
      // Warm the copy, then count the reads of one complete run.
      yield* run({ fields: '["title"]' });
      const read = vi.spyOn(StatementSync.prototype, "all");
      yield* run({ fields: '["title"]' });
      const complete = read.mock.calls.length;
      expect(complete).toBeGreaterThan(3);

      // One tick per clock read exercises cancellation across scheduler pauses.
      let now = 0;
      vi.spyOn(performance, "now").mockImplementation(() => (now += 1));
      // Interrupt inside the third database read of the query.
      const events: string[] = [];
      read.mockImplementation(function (this: StatementSync, ...values) {
        if (events.push("read") === 3) controller.abort();
        return Reflect.apply(readRows, this, values) as ReturnType<
          StatementSync["all"]
        >;
      });

      const exit = yield* exitOf(
        query({ fields: '["title"]' }),
        controller.signal,
      );
      events.push("settled");

      expectInterrupted(exit);
      expect(events).toEqual(["read", "read", "read", "settled"]);
    }),
  );
});

function setupSchema(
  scenario: ScenarioDatabase,
  dataset: "items" | "attachments" | "annotations" = "items",
) {
  const text = onJob(
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
  );
  return {
    text,
    run: () =>
      text.pipe(
        Effect.map((answer) => JSON.parse(answer) as Record<string, unknown>),
      ),
  };
}

describe("zotlit:query-schema", () => {
  it.effect.each(["items", "attachments", "annotations"] as const)(
    "lists key and file type fields in the live %s schema",
    (dataset) =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ annotations: true });
        const schema = yield* setupSchema(scenario, dataset).run();
        const fields = [
          "key",
          "indexedKey",
          ...(dataset === "items" ? [] : ["item.key", "item.indexedKey"]),
          ...(dataset === "attachments"
            ? ["fileType"]
            : dataset === "annotations"
              ? [
                  "attachment.key",
                  "attachment.indexedKey",
                  "attachment.fileType",
                ]
              : []),
        ];
        expect(schema).toMatchObject({
          ok: true,
          contractVersion: 3,
          datasets: { [dataset]: { fields: expect.arrayContaining(fields) } },
        });
      }),
  );

  it.effect(
    "answers unsupported-database-layout for a copy that lacks a manifest column",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        scenario.sqlite.exec(
          'alter table "fieldsCombined" drop column "custom"',
        );
        const { run } = setupSchema(scenario);

        const answer = yield* run();

        expect(answer).toMatchObject({
          command: QUERY_SCHEMA_COMMAND,
          ok: false,
          diagnostic: {
            code: "unsupported-database-layout",
            report: { 0: expect.stringContaining("fieldsCombined.custom") },
          },
        });
      }),
  );
});

it.effect(
  "answers contract v2 reports and warnings through the query envelope",
  () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
      const run = setup(scenario).run;
      const failed = yield* run({ filter: 'creators.lastName == "Smith"' });
      expect(failed.contractVersion).toBe(3);
      const diagnostic = failed.diagnostic as Diagnostic;
      expect(diagnostic.report[0]).toBe(diagnostic.message);
      expect(diagnostic.report.at(-1)).toBe(diagnostic.hint);
      expect(diagnostic.excerpt?.at).toBe("lastName");
      expect(diagnostic.severity).toBe("error");
      const success = yield* run({ limit: "1" });
      expect(success.warnings).toEqual([]);
    }),
);

it.effect(
  "reports syntax facts and a correction through the CLI envelope",
  () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
      const failed = yield* setup(scenario).run({
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
    }),
);

it.effect(
  "keeps warning diagnostics before rows and drops them on failure",
  () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
      const { run, query } = setup(scenario);
      const text = yield* query({ filter: 'tags == "bulk"' });
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
        const failed = yield* run(params);
        expect(failed.ok).toBe(false);
        expect(failed).not.toHaveProperty("warnings");
      }
    }),
);

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
        query: workerQuery({ ...BULK, output: "/exports/items.json" }),
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

  it.effect(
    "ends interrupted between two chunks and closes the writer before the scope ends",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        seedBulkLibrary(scenario.sqlite, 600);
        const controller = new AbortController();
        // The head, then the first chunk of rows: the interrupt comes there.
        const { events, run } = memoryExport(scenario, (count) =>
          Effect.sync(() => {
            if (count === 2) controller.abort();
          }),
        );

        const exit = yield* exitOf(run, controller.signal);

        expect(
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
        ).toBe(true);
        expect(events).toEqual([
          "open",
          "write",
          "write",
          "close",
          "scope-ended",
        ]);
      }),
  );

  it.effect(
    "answers output-error for a failed write and closes the writer before the scope ends",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
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

        const reply = yield* run;

        expect(reply.receipt).toEqual({ kind: "inline" });
        expect(JSON.parse(reply.answer)).toMatchObject({
          ok: false,
          diagnostic: {
            code: "output-error",
            report: { 0: "The disk is full." },
          },
        });
        expect(events).toEqual([
          "open",
          "write",
          "write",
          "close",
          "scope-ended",
        ]);
      }),
  );
});

it.effect(
  "answers and exports byte-identical grouped envelopes with exact counts",
  () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
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
        group: "library",
        library: "all",
        limit: "1",
        fields: "[]",
      };
      const found = yield* run(params);
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
      const receipt = yield* run({ ...params, output: "/exports/groups.json" });
      expect(output).toBe(JSON.stringify(found, null, 2));
      expect(receipt).toMatchObject({
        request: { group: "library" },
        totalCount: 12,
        returnedCount: 2,
        file: { bytes: Buffer.byteLength(output), format: "json" },
      });
      expect(receipt).not.toHaveProperty("rows");
      expect(receipt).not.toHaveProperty("groups");
    }),
);

it.effect(
  "encodes an empty grouped answer and the scalar-path Diagnostic Report",
  () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
      const { run } = setup(scenario);
      const empty = yield* run({ group: "library", filter: "false" });
      expect(empty).toMatchObject({
        groups: [],
        totalCount: 0,
        returnedCount: 0,
        truncated: false,
      });
      expect(empty).not.toHaveProperty("rows");
      const invalid = yield* run({ group: "tags" });
      expect(invalid).toMatchObject({
        ok: false,
        diagnostic: {
          code: "invalid-group",
          location: { argument: "group" },
          suggestions: ["group='tags[].name'", "group='tags[].type'"],
        },
      });
    }),
);

it.effect(
  "answers and exports overlapping element groups with records counted once",
  () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
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
      const found = yield* run(params);
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
      const receipt = yield* run({ ...params, output: "/exports/tags.json" });
      expect(output).toBe(JSON.stringify(found, null, 2));
      expect(receipt).toMatchObject({ totalCount: 2, returnedCount: 4 });
    }),
);
