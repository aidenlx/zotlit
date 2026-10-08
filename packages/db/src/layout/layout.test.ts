import { relations } from "@drizzle/relations";
import { configure, reset } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { openScenarioDatabase } from "@/test-scenario";
import type {
  ScenarioDatabase,
  ScenarioDatabaseOptions,
} from "@/test-scenario";
import { countStatements } from "@/test-utils";

import { readDatabaseLayout } from ".";

afterEach(async () => {
  await reset();
});

/** A scenario copy, changed by `alter` before the first read. */
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

describe("readDatabaseLayout", () => {
  it("reads the full layout and the stamps of a Zotero 10 copy", () => {
    using copy = openCopy();

    const layout = readDatabaseLayout(copy.db);

    expect(layout.missing).toEqual([]);
    expect(layout.versions).toEqual({ userdata: 129, compatibility: 9 });
    expect(layout.has("libraries", "clientVersion")).toBe(true);
  });

  it("reads the lowest layout as readable, without the columns of later migrations", () => {
    using copy = openCopy(undefined, { layout: "lowest" });

    const layout = readDatabaseLayout(copy.db);

    expect(layout.missing).toEqual([]);
    expect(layout.versions).toEqual({ userdata: 125, compatibility: 7 });
    expect(layout.has("libraries", "clientVersion")).toBe(false);
    expect(layout.has("libraries", "libraryID")).toBe(true);
  });

  it("decides by the columns of the lowest layout when its stamp is outside the supported range", () => {
    using copy = openCopy(
      (sqlite) => {
        sqlite.exec(
          "update version set version = 999 where schema = 'userdata'",
        );
      },
      { layout: "lowest" },
    );

    const layout = readDatabaseLayout(copy.db);

    expect(layout.missing).toEqual([]);
    expect(layout.versions.userdata).toBe(999);
    expect(layout.has("libraries", "clientVersion")).toBe(false);
  });

  it("names a manifest column that a copy stamped inside the supported range lacks", () => {
    using copy = openCopy((sqlite) => {
      stamp(sqlite, { userdata: 129, compatibility: 9 });
      sqlite.exec('alter table "fieldsCombined" drop column "custom"');
    });

    expect(readDatabaseLayout(copy.db)).toMatchObject({
      missing: [{ table: "fieldsCombined", column: "custom" }],
      versions: { userdata: 129, compatibility: 9 },
    });
  });

  it("names a missing table once", () => {
    using copy = openCopy((sqlite) => {
      sqlite.exec('drop table "deletedItems"');
    });

    expect(readDatabaseLayout(copy.db).missing).toEqual([
      { table: "deletedItems", column: null },
    ]);
  });

  it("reads no stamps from a database without a version table", () => {
    using sqlite = new DatabaseSync(":memory:");
    sqlite.exec("create table notes (id integer primary key)");

    const layout = readDatabaseLayout(drizzle({ client: sqlite, relations }));

    expect(layout.versions).toEqual({ userdata: null, compatibility: null });
    expect(layout.missing).toContainEqual({ table: "items", column: null });
  });

  it("reads the layout once for each copy", () => {
    using copy = openCopy();
    const statements = countStatements(copy.sqlite);

    const first = readDatabaseLayout(copy.db);
    const read = statements();
    copy.sqlite.exec('drop table "deletedItems"');
    const second = readDatabaseLayout(copy.db);

    expect(read).toBe(2);
    expect(statements()).toBe(read);
    expect(second).toBe(first);
    expect(second.missing).toEqual([]);
  });

  it("logs the userdata and compatibility versions once for each copy", async () => {
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

    readDatabaseLayout(copy.db);
    readDatabaseLayout(copy.db);

    expect(records).toEqual([
      expect.objectContaining({
        properties: expect.objectContaining({
          userdata: 140,
          compatibility: 12,
        }),
      }),
    ]);
  });
});
