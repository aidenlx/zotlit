import { relations } from "@drizzle/relations";
import * as schema from "@drizzle/schema";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type NodeDatabaseClient } from "@/client/node";

import { getLibraries, getLibraryByGroupID } from "./libraries";

const DDL = `
  create table libraries (libraryID integer primary key, type text not null);
  create table groups (
    groupID integer primary key,
    libraryID integer not null,
    name text not null,
    description text not null default '',
    version integer not null default 0
  );
`;

const SEED = `
  insert into libraries (libraryID, type) values (1, 'user'), (4, 'group'), (5, 'group');
  insert into groups (groupID, libraryID, name) values (100, 4, 'Shared A'), (200, 5, 'Shared B');
`;

describe("libraries queries", () => {
  let sqlite: DatabaseSync;
  let db: NodeDatabaseClient;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec(DDL);
    sqlite.exec(SEED);
    db = drizzle({ client: sqlite, schema, relations });
  });

  afterEach(() => {
    sqlite.close();
  });

  it("enumerates libraries with their group join", () => {
    expect(getLibraries(db)).toEqual([
      { libraryID: 1, type: "user", groupID: null, name: null },
      { libraryID: 4, type: "group", groupID: 100, name: "Shared A" },
      { libraryID: 5, type: "group", groupID: 200, name: "Shared B" },
    ]);
  });

  it("resolves a group library by groupID", () => {
    expect(getLibraryByGroupID(db, 200)).toEqual({
      libraryID: 5,
      type: "group",
      groupID: 200,
      name: "Shared B",
    });
  });

  it("returns null when no group matches", () => {
    expect(getLibraryByGroupID(db, 999)).toBeNull();
  });
});
