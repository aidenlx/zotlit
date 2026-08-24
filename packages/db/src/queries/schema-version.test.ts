import { relations } from "@drizzle/relations";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import type { NodeDatabaseClient } from "@/client/node";
import { createFixtureSchema } from "@/test-utils";

import { getSchemaVersions } from "./schema-version";

function withVersions(
  rows: Record<string, number>,
  test: (db: NodeDatabaseClient) => void,
): void {
  using sqlite = new DatabaseSync(":memory:");
  createFixtureSchema(sqlite);
  for (const [schema, version] of Object.entries(rows)) {
    sqlite
      .prepare("insert into version (schema, version) values (?, ?)")
      .run(schema, version);
  }
  test(drizzle({ client: sqlite, relations }));
}

describe("getSchemaVersions", () => {
  it("accepts the Zotero 9 schema", () => {
    withVersions({ userdata: 125, compatibility: 7 }, (db) => {
      expect(getSchemaVersions(db)).toEqual({
        userdata: 125,
        compatibility: 7,
        supported: true,
      });
    });
  });

  it("accepts the Zotero 10 schema", () => {
    withVersions({ userdata: 129, compatibility: 9 }, (db) => {
      expect(getSchemaVersions(db)).toEqual({
        userdata: 129,
        compatibility: 9,
        supported: true,
      });
    });
  });

  it("accepts an intermediate userdata version inside the range", () => {
    withVersions({ userdata: 127, compatibility: 8 }, (db) => {
      expect(getSchemaVersions(db).supported).toBe(true);
    });
  });

  it("rejects a userdata version above the range", () => {
    withVersions({ userdata: 130, compatibility: 9 }, (db) => {
      expect(getSchemaVersions(db)).toMatchObject({
        userdata: 130,
        supported: false,
      });
    });
  });

  it("rejects a userdata version below the range", () => {
    withVersions({ userdata: 124, compatibility: 7 }, (db) => {
      expect(getSchemaVersions(db).supported).toBe(false);
    });
  });

  it("rejects a compatibility version above the range", () => {
    withVersions({ userdata: 129, compatibility: 10 }, (db) => {
      expect(getSchemaVersions(db)).toMatchObject({
        compatibility: 10,
        supported: false,
      });
    });
  });

  it("rejects a database with no version rows", () => {
    withVersions({}, (db) => {
      expect(getSchemaVersions(db)).toEqual({
        userdata: null,
        compatibility: null,
        supported: false,
      });
    });
  });

  it("ignores unrelated schema rows", () => {
    withVersions(
      { userdata: 125, compatibility: 7, system: 32, triggers: 18 },
      (db) => {
        expect(getSchemaVersions(db).supported).toBe(true);
      },
    );
  });
});
