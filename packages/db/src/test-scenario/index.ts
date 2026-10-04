// Test helper: the Item Query scenario on a copy of the Fixture's pristine
// Zotero 10 database. Separate from `createFixtureSchema` in `test-utils.ts`,
// which hand-writes a table subset for the existing query tests.
import { relations } from "@drizzle/relations";
import { drizzle } from "drizzle-orm/node-sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";

import type { NodeDatabaseClient } from "@/client/node";

import { seedScenario } from "./seed";

export {
  SCENARIO_ITEMS,
  SCENARIO_LIBRARIES,
  type ScenarioItem,
  type ScenarioItemName,
  type ScenarioLibraryName,
} from "./seed";

export interface ScenarioDatabaseOptions {
  /**
   * `"memory"` (default) holds the copy in memory. `"temp-directory"` writes it
   * to `zotero.sqlite` in a new temporary directory that `close` removes.
   */
  storage?: "memory" | "temp-directory";
  /**
   * `"highest"` (default) keeps the pristine Zotero 10 layout. `"lowest"` gives
   * the lowest supported layout: the columns Zotero added after `userdata` 125
   * are dropped and the versions read `userdata` 125 / `compatibility` 7.
   */
  layout?: "highest" | "lowest";
}

export interface ScenarioDatabase extends Disposable {
  db: NodeDatabaseClient;
  sqlite: DatabaseSync;
  /** `":memory:"`, or the file path of the copy. */
  path: string;
  close(): void;
}

/**
 * Columns Zotero added after `userdata` 125: the normalized shadow columns of
 * migration 126 and the `clientVersion` columns of migration 129.
 *
 * @see https://github.com/zotero/zotero/blob/10.0.0/chrome/content/zotero/xpcom/schema.js
 */
const COLUMNS_AFTER_USERDATA_125 = [
  ["items", "clientVersion"],
  ["itemDataValues", "valueNormalized"],
  ["itemAnnotations", "textNormalized"],
  ["itemAnnotations", "commentNormalized"],
  ["tags", "nameNormalized"],
  ["creators", "firstNameNormalized"],
  ["creators", "lastNameNormalized"],
  ["collections", "clientVersion"],
  ["savedSearches", "clientVersion"],
  ["libraries", "clientVersion"],
] as const;

const LOWEST_VERSIONS = { userdata: 125, compatibility: 7 } as const;

/**
 * Open a copy of the Fixture's pristine Zotero 10 database with the Item Query
 * scenario inserted. Zotero's lookup tables, triggers, and foreign keys are the
 * ones Zotero made; address scenario rows through `SCENARIO_ITEMS`.
 */
export function openScenarioDatabase(
  options: ScenarioDatabaseOptions = {},
): ScenarioDatabase {
  const pristine = gunzipSync(readFileSync(pristineTemplatePath()));

  let sqlite: DatabaseSync;
  let path: string;
  let directory: string | null = null;
  if (options.storage === "temp-directory") {
    directory = mkdtempSync(join(tmpdir(), "zotlit-scenario-"));
    path = join(directory, "zotero.sqlite");
    writeFileSync(path, pristine);
    sqlite = new DatabaseSync(path);
  } else {
    path = ":memory:";
    sqlite = new DatabaseSync(path);
    sqlite.deserialize(pristine);
  }

  try {
    seedScenario(sqlite);
    if (options.layout === "lowest") toLowestLayout(sqlite);
  } catch (error) {
    sqlite.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
    throw error;
  }

  const close = () => {
    if (sqlite.isOpen) sqlite.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  };
  return {
    db: drizzle({ client: sqlite, relations }),
    sqlite,
    path,
    close,
    [Symbol.dispose]: close,
  };
}

function toLowestLayout(sqlite: DatabaseSync): void {
  for (const [table, column] of COLUMNS_AFTER_USERDATA_125) {
    sqlite.exec(`alter table "${table}" drop column "${column}"`);
  }
  const stamp = sqlite.prepare(
    "update version set version = ? where schema = ?",
  );
  stamp.run(LOWEST_VERSIONS.userdata, "userdata");
  stamp.run(LOWEST_VERSIONS.compatibility, "compatibility");
}

/**
 * The committed template the Fixture build copies (ADR 0022). It lives in
 * `@zotlit/scripts`, which depends on this package, so the path resolves from
 * this package's root instead of through an import.
 */
function pristineTemplatePath(): string {
  const packageRoot = dirname(
    createRequire(import.meta.url).resolve("@zotlit/db/package.json"),
  );
  return join(
    packageRoot,
    "..",
    "scripts",
    "lib",
    "fixture",
    "pristine-zotero.sqlite.gz",
  );
}
