import { relations } from "@drizzle/relations";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import type { NodeDatabaseClient } from "@/client/node";
import { createFixtureSchema } from "@/test-utils";

import {
  getAccountUserID,
  getZoteroDatabaseIdentity,
  getZoteroIdentity,
} from "./account";

function withFixture(
  test: (sqlite: DatabaseSync, db: NodeDatabaseClient) => void,
): void {
  using sqlite = new DatabaseSync(":memory:");
  createFixtureSchema(sqlite);
  const db = drizzle({ client: sqlite, relations });
  test(sqlite, db);
}

describe("getZoteroIdentity: username", () => {
  it("reads the username from the settings row", () => {
    withFixture((sqlite, db) => {
      sqlite.exec(
        "insert into settings (setting, key, value) values ('account', 'username', 'aidenlx');",
      );

      expect(getZoteroIdentity(db).username).toBe("aidenlx");
    });
  });

  it("returns null when the account never synced (no row)", () => {
    withFixture((_, db) => {
      expect(getZoteroIdentity(db).username).toBeNull();
    });
  });

  it("returns null when the value is an empty string", () => {
    withFixture((sqlite, db) => {
      sqlite.exec(
        "insert into settings (setting, key, value) values ('account', 'username', '');",
      );

      expect(getZoteroIdentity(db).username).toBeNull();
    });
  });
});

describe("getZoteroDatabaseIdentity", () => {
  it("reads the exact Local API database id when Zotero initialized it", () => {
    withFixture((sqlite, db) => {
      sqlite.exec(`
        insert into settings (setting, key, value)
        values ('account', 'localUserKey', 'v3aG8nQf'),
               ('localAPI', 'serverID', 'A8sf5Zsz8ySw');
      `);

      expect(getZoteroDatabaseIdentity(db)).toEqual({
        userID: null,
        localUserKey: "v3aG8nQf",
        serverID: "A8sf5Zsz8ySw",
      });
    });
  });

  it("leaves the server id null before Local API initialization", () => {
    withFixture((_, db) => {
      expect(getZoteroDatabaseIdentity(db).serverID).toBeNull();
    });
  });
});

describe("getZoteroIdentity: account ids", () => {
  it("reads both account ids from the settings rows", () => {
    withFixture((sqlite, db) => {
      sqlite.exec(
        "insert into settings (setting, key, value) values ('account', 'userID', 475425), ('account', 'localUserKey', 'v3aG8nQf');",
      );

      expect(getZoteroIdentity(db)).toEqual({
        userID: 475425,
        localUserKey: "v3aG8nQf",
        username: null,
      });
    });
  });

  it("leaves userID null for a never-synced account", () => {
    withFixture((sqlite, db) => {
      sqlite.exec(
        "insert into settings (setting, key, value) values ('account', 'localUserKey', 'v3aG8nQf');",
      );

      expect(getZoteroIdentity(db)).toEqual({
        userID: null,
        localUserKey: "v3aG8nQf",
        username: null,
      });
    });
  });

  it("reads a userID stored as text", () => {
    withFixture((sqlite, db) => {
      sqlite.exec(
        "insert into settings (setting, key, value) values ('account', 'userID', '475425');",
      );

      expect(getZoteroIdentity(db).userID).toBe(475425);
    });
  });

  it("rejects a userID that is not a positive integer", () => {
    withFixture((sqlite, db) => {
      sqlite.exec(
        "insert into settings (setting, key, value) values ('account', 'userID', 'nope');",
      );

      expect(getZoteroIdentity(db).userID).toBeNull();
    });
  });

  it("returns both null on an empty settings table", () => {
    withFixture((_, db) => {
      expect(getZoteroIdentity(db)).toEqual({
        userID: null,
        localUserKey: null,
        username: null,
      });
    });
  });
});

describe("getAccountUserID", () => {
  it("reads the user ID stored as text, and null for a database that never synced", () => {
    withFixture((sqlite, db) => {
      expect(getAccountUserID(db)).toBeNull();
      sqlite.exec(
        "insert into settings (setting, key, value) values ('account', 'userID', '475425');",
      );
      expect(getAccountUserID(db)).toBe(475425);
    });
  });
});
