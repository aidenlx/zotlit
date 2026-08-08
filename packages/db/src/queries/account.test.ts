import { relations } from "@drizzle/relations";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NodeDatabaseClient } from "@/client/node";
import { createFixtureSchema } from "@/test-utils";

import { getCurrentUsername } from "./account";

describe("getCurrentUsername", () => {
  let sqlite: DatabaseSync;
  let db: NodeDatabaseClient;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    createFixtureSchema(sqlite);
    db = drizzle({ client: sqlite, relations });
  });

  afterEach(() => {
    sqlite.close();
  });

  it("reads the username from the settings row", () => {
    sqlite.exec(
      "insert into settings (setting, key, value) values ('account', 'username', 'aidenlx');",
    );

    expect(getCurrentUsername(db)).toBe("aidenlx");
  });

  it("returns null when the account never synced (no row)", () => {
    expect(getCurrentUsername(db)).toBeNull();
  });

  it("returns null when the value is an empty string", () => {
    sqlite.exec(
      "insert into settings (setting, key, value) values ('account', 'username', '');",
    );

    expect(getCurrentUsername(db)).toBeNull();
  });
});
