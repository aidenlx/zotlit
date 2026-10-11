import { relations } from "@drizzle/relations";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NodeDatabaseClient } from "@/client/node";
import { openScenarioDatabase } from "@/test-scenario";
import { createFixtureSchema } from "@/test-utils";

import { getLibraries, getLibraryByGroupID } from "./libraries";

const SEED = `
  insert into libraries (libraryID, type) values (1, 'user'), (4, 'group'), (5, 'group');
  insert into groups (groupID, libraryID, name) values (100, 4, 'Shared A'), (200, 5, 'Shared B');
`;

describe("libraries queries", () => {
  let sqlite: DatabaseSync;
  let db: NodeDatabaseClient;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    createFixtureSchema(sqlite);
    sqlite.exec(
      "insert into version (schema, version) values ('userdata', 129), ('compatibility', 9)",
    );
    sqlite.exec(SEED);
    db = drizzle({ client: sqlite, relations });
  });

  afterEach(() => {
    sqlite.close();
  });

  it("enumerates libraries with their group join", () => {
    expect(getLibraries(db)).toEqual([
      {
        libraryID: 1,
        type: "user",
        version: 0,
        clientVersion: 0,
        groupID: null,
        name: null,
      },
      {
        libraryID: 4,
        type: "group",
        version: 0,
        clientVersion: 0,
        groupID: 100,
        name: "Shared A",
      },
      {
        libraryID: 5,
        type: "group",
        version: 0,
        clientVersion: 0,
        groupID: 200,
        name: "Shared B",
      },
    ]);
  });

  it("reads userdata 125 without local client revision columns", () => {
    sqlite.exec(`
      update version set version = 125 where schema = 'userdata';
      alter table libraries drop column clientVersion;
    `);

    expect(getLibraries(db).map(({ clientVersion }) => clientVersion)).toEqual([
      null,
      null,
      null,
    ]);
    expect(getLibraryByGroupID(db, 200)?.clientVersion).toBeNull();
  });

  it("reads the lowest layout with a version stamp outside the supported range", () => {
    using scenario = openScenarioDatabase({ layout: "lowest" });
    scenario.sqlite.exec(
      "update version set version = 999 where schema = 'userdata'",
    );

    expect(getLibraries(scenario.db)).toEqual([
      {
        libraryID: 1,
        type: "user",
        version: 0,
        clientVersion: null,
        groupID: null,
        name: null,
      },
      {
        libraryID: 2,
        type: "group",
        version: 0,
        clientVersion: null,
        groupID: 4815,
        name: "Methods Reading Group",
      },
    ]);
  });

  it("leaves out a Library that is no personal or group Library", () => {
    sqlite.exec("insert into libraries (libraryID, type) values (7, 'feed')");

    expect(getLibraries(db).map(({ libraryID }) => libraryID)).toEqual([
      1, 4, 5,
    ]);
  });

  it("resolves a group library by groupID", () => {
    expect(getLibraryByGroupID(db, 200)).toEqual({
      libraryID: 5,
      type: "group",
      version: 0,
      clientVersion: 0,
      groupID: 200,
      name: "Shared B",
    });
  });

  it("returns null when no group matches", () => {
    expect(getLibraryByGroupID(db, 999)).toBeNull();
  });
});
