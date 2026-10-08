import { Effect, Exit } from "effect";
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { getLibraries, getSchemaVersions } from "@zotlit/db";
import { ItemQueryDatabase, readLibraries } from "@zotlit/db/item-query";
import { openScenarioDatabase } from "@zotlit/db/test-scenario";
import type { ScenarioDatabaseOptions } from "@zotlit/db/test-scenario";
import { countStatements } from "@zotlit/db/test-utils";
import { queryItems } from "@zotlit/item-query";

import { validateClient } from "./connection";

interface Copy {
  readonly name: string;
  readonly options?: ScenarioDatabaseOptions;
  readonly alter?: (sqlite: DatabaseSync) => void;
}

function stampUserdata(version: number) {
  return (sqlite: DatabaseSync) => {
    sqlite
      .prepare("update version set version = ? where schema = 'userdata'")
      .run(version);
  };
}

/** Copies that both ZoteroReads and Item Query read. */
const READABLE: readonly Copy[] = [
  { name: "the Zotero 10 layout" },
  { name: "the lowest layout", options: { layout: "lowest" } },
  {
    name: "the lowest layout stamped outside the supported range",
    options: { layout: "lowest" },
    alter: stampUserdata(999),
  },
  {
    name: "a Zotero 10 copy without libraries.clientVersion",
    alter: (sqlite) => {
      sqlite.exec('alter table "libraries" drop column "clientVersion"');
    },
  },
  {
    name: "the Zotero 10 layout stamped outside the supported range",
    alter: stampUserdata(140),
  },
];

/** Copies that neither ZoteroReads nor Item Query reads. */
const UNREADABLE: readonly Copy[] = [
  {
    name: "a copy without fieldsCombined.custom",
    alter: (sqlite) => {
      sqlite.exec('alter table "fieldsCombined" drop column "custom"');
    },
  },
  {
    name: "the lowest layout without the deletedItems table",
    options: { layout: "lowest" },
    alter: (sqlite) => {
      sqlite.exec('drop table "deletedItems"');
    },
  },
];

function open({ options, alter }: Copy) {
  const copy = openScenarioDatabase(options);
  alter?.(copy.sqlite);
  return copy;
}

/** Whether ZoteroReads validates a fresh client of `copy`. */
function zoteroReadsValidates(copy: Copy): boolean {
  using scenario = open(copy);
  try {
    validateClient(scenario.db);
    return true;
  } catch {
    return false;
  }
}

/** Whether Item Query reads every Library of a fresh client of `copy`. */
async function itemQueryReads(copy: Copy): Promise<boolean> {
  using scenario = open(copy);
  const exit = await Effect.runPromiseExit(
    Effect.provideService(
      Effect.gen(function* () {
        const libraries = yield* readLibraries();
        return yield* queryItems({
          libraries: libraries.map(({ libraryID, groupID }) => ({
            libraryID,
            groupID,
          })),
          fields: ["title"],
          limit: 1,
        });
      }),
      ItemQueryDatabase,
      { client: scenario.db },
    ),
  );
  return Exit.isSuccess(exit);
}

describe("validateClient and Item Query", () => {
  it.each(READABLE)("both read $name", async (copy) => {
    expect(zoteroReadsValidates(copy)).toBe(true);
    expect(await itemQueryReads(copy)).toBe(true);
  });

  it.each(UNREADABLE)("both refuse $name", async (copy) => {
    expect(zoteroReadsValidates(copy)).toBe(false);
    expect(await itemQueryReads(copy)).toBe(false);
  });

  it("refuses a copy the readers cannot read with the layout error", () => {
    using scenario = open(UNREADABLE[0]!);

    expect(() => validateClient(scenario.db)).toThrow(
      expect.objectContaining({
        _tag: "ItemQueryLayoutError",
        missing: [{ table: "fieldsCombined", column: "custom" }],
      }),
    );
  });

  it("reads the layout of a copy once for validation, the stamps, and the Library readers", () => {
    using scenario = openScenarioDatabase();
    const statements = countStatements(scenario.sqlite);

    validateClient(scenario.db);
    const validated = statements();
    getSchemaVersions(scenario.db);
    getLibraries(scenario.db);
    Effect.runSync(
      Effect.provideService(readLibraries(), ItemQueryDatabase, {
        client: scenario.db,
      }),
    );

    // Two layout statements, then one Library statement for each reader.
    expect(validated).toBe(2);
    expect(statements()).toBe(validated + 2);
  });
});
