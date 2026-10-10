import { configure, reset } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { Cause, Effect, Exit } from "effect";
import { constants } from "node:sqlite";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { ITEM_QUERY_LAYOUT, OPTIONAL_LAYOUT_COLUMNS } from "@/layout";
import { openScenarioDatabase, SCENARIO_LIBRARIES } from "@/test-scenario";
import type {
  ScenarioDatabase,
  ScenarioDatabaseOptions,
} from "@/test-scenario";

// The index loads every reader module, so every reader statement is defined.
import {
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
  readScanPage,
} from ".";
import { checkLayout, readerStatementSQL } from "./database";

afterEach(async () => {
  await reset();
});

/** A scenario copy, changed by `alter` before the first reader runs. */
function openCopy(
  alter: (sqlite: DatabaseSync) => void = () => {},
  options: ScenarioDatabaseOptions = {},
): ScenarioDatabase {
  const copy = openScenarioDatabase(options);
  alter(copy.sqlite);
  return copy;
}

function stamp(
  sqlite: DatabaseSync,
  versions: { userdata: number; compatibility: number },
): void {
  const update = sqlite.prepare(
    "update version set version = ? where schema = ?",
  );
  update.run(versions.userdata, "userdata");
  update.run(versions.compatibility, "compatibility");
}

function run<A, E>(
  copy: ScenarioDatabase,
  effect: Effect.Effect<A, E, ItemQueryDatabase>,
) {
  return Effect.runSyncExit(
    Effect.provideService(effect, ItemQueryDatabase, { client: copy.db }),
  );
}

function failureOf<A, E>(exit: Exit.Exit<A, E>): E {
  if (!Exit.isFailure(exit)) throw new Error("the Effect did not fail.");
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None") throw new Error(String(exit.cause));
  return error.value;
}

const firstPage = readScanPage({
  libraryID: SCENARIO_LIBRARIES.personal.libraryID,
  afterKey: null,
});

/**
 * The tables and columns of the database that one statement reads, as SQLite's
 * authorizer reports them when it compiles the statement. A table-valued
 * function such as `json_each` is not a table of the database.
 */
function columnsRead(sqlite: DatabaseSync, sql: string): string[] {
  const tables = new Set(
    (
      sqlite
        .prepare(
          "select name from sqlite_schema where type in ('table', 'view')",
        )
        .all() as { name: string }[]
    ).map((row) => row.name),
  );
  const reads = new Set<string>();
  sqlite.setAuthorizer((action, table, column) => {
    if (action === constants.SQLITE_READ && table && tables.has(table)) {
      reads.add(column ? `${table}.${column}` : table);
    }
    return constants.SQLITE_OK;
  });
  try {
    sqlite.prepare(sql);
  } finally {
    sqlite.setAuthorizer(null);
  }
  return [...reads];
}

describe("ITEM_QUERY_LAYOUT", () => {
  it("lists every table and column that a reader statement reads", () => {
    using scenario = openScenarioDatabase();
    const statements = readerStatementSQL(scenario.db);
    const listed = new Set(
      [
        ...Object.entries(ITEM_QUERY_LAYOUT),
        ...Object.entries(OPTIONAL_LAYOUT_COLUMNS),
      ].flatMap(([table, columns]) => [
        table,
        ...columns.map((column) => `${table}.${column}`),
      ]),
    );

    const unlisted = statements.flatMap((sql) =>
      columnsRead(scenario.sqlite, sql)
        .filter((read) => !listed.has(read))
        .map((read) => ({ read, sql })),
    );

    expect(statements.length).toBeGreaterThan(0);
    expect(unlisted).toEqual([]);
  });
});

describe("the layout check", () => {
  it("fails a reader with the layout error when a copy stamped inside the supported range lacks a manifest column", () => {
    using copy = openCopy((sqlite) => {
      stamp(sqlite, { userdata: 129, compatibility: 9 });
      sqlite.exec('alter table "fieldsCombined" drop column "custom"');
    });

    const error = failureOf(run(copy, firstPage));

    expect(error).toBeInstanceOf(ItemQueryLayoutError);
    expect(error).toMatchObject({
      missing: [{ table: "fieldsCombined", column: "custom" }],
      versions: { userdata: 129, compatibility: 9 },
    });
    expect((error as ItemQueryLayoutError).message).toContain(
      "fieldsCombined.custom",
    );
    expect((error as ItemQueryLayoutError).message).toContain("Update ZotLit");
  });

  it("names a missing table once", () => {
    using copy = openCopy((sqlite) => {
      sqlite.exec('drop table "deletedItems"');
    });

    expect(failureOf(run(copy, checkLayout()))).toMatchObject({
      _tag: "ItemQueryLayoutError",
      missing: [{ table: "deletedItems", column: null }],
    });
  });

  it("reads a copy stamped outside the supported range that has the full layout", () => {
    using copy = openCopy((sqlite) => {
      stamp(sqlite, { userdata: 140, compatibility: 12 });
    });

    const exit = run(copy, firstPage);

    expect(Exit.isSuccess(exit) && exit.value.length).toBe(10);
  });

  it("reads the lowest supported layout", () => {
    using copy = openCopy(undefined, { layout: "lowest" });

    const exit = run(copy, firstPage);

    expect(Exit.isSuccess(exit) && exit.value.length).toBe(10);
  });

  it("keeps the check result for the life of the copy", () => {
    using passed = openCopy();
    expect(Exit.isSuccess(run(passed, checkLayout()))).toBe(true);
    // A column that goes away after the check is not checked again: the
    // statement itself fails.
    passed.sqlite.exec('drop table "deletedItems"');
    expect(failureOf(run(passed, firstPage))).toBeInstanceOf(
      ItemQueryDatabaseError,
    );
    passed.close();

    using failed = openCopy((sqlite) => {
      sqlite.exec('drop table "deletedItems"');
    });
    expect(failureOf(run(failed, checkLayout()))).toBeInstanceOf(
      ItemQueryLayoutError,
    );
    failed.sqlite.exec(
      'create table "deletedItems" (itemID integer primary key)',
    );
    expect(failureOf(run(failed, firstPage))).toBeInstanceOf(
      ItemQueryLayoutError,
    );
  });

  it("logs the userdata and compatibility versions of the copy", async () => {
    const records: LogRecord[] = [];
    await configure({
      sinks: { buffer: (record) => records.push(record) },
      loggers: [
        { category: ["zotlit", "db"], sinks: ["buffer"], lowestLevel: "debug" },
        { category: ["logtape", "meta"], sinks: [] },
      ],
    });
    using copy = openCopy((sqlite) => {
      stamp(sqlite, { userdata: 140, compatibility: 12 });
    });

    run(copy, firstPage);

    expect(records).toContainEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          userdata: 140,
          compatibility: 12,
        }),
      }),
    );
  });
});
