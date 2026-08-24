// The committed pristine Zotero database every Fixture build starts from, and
// the harvest that regenerates it from a real Zotero first run.

import type { ChildProcess } from "node:child_process";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  PINNED_ZOTERO_VERSION,
  QUIET_FIRST_RUN_PREFS,
  resolveZoteroApp,
  spawnZotero,
} from "./paired-zotero.ts";

/**
 * Zotero schema versions the template declares. The pinned Zotero writes them
 * on its first run; a build asserts them, so a template harvested from a
 * different Zotero fails loudly instead of seeding a database ZotLit's version
 * gate would reject.
 *
 * @see packages/db/src/queries/schema-version.ts for the range ZotLit accepts.
 */
export const PRISTINE_SCHEMA_VERSIONS = {
  userdata: 129,
  compatibility: 9,
} as const;

/**
 * The committed template, gzipped. Zotero lays the database out in 32 KB
 * pages, so a first-run database is 5 MB of mostly empty pages that compress
 * to a fraction of that — the working tree carries the small form.
 */
export const PRISTINE_TEMPLATE_PATH = join(
  import.meta.dirname,
  "pristine-zotero.sqlite.gz",
);

/** Lay the pristine template down at `databasePath`, ready to be seeded. */
export async function writePristineDatabase(
  databasePath: string,
): Promise<void> {
  const compressed = await readFile(PRISTINE_TEMPLATE_PATH).catch(() => {
    throw new Error(
      `no pristine template at ${PRISTINE_TEMPLATE_PATH}.` +
        ` Harvest one with 'pnpm fixture harvest'.`,
    );
  });
  await writeFile(databasePath, gunzipSync(compressed));
}

export interface SchemaVersions {
  userdata: number;
  compatibility: number;
}

/** @throws when the database declares no `userdata` or `compatibility` row. */
function readSchemaVersions(db: DatabaseSync): SchemaVersions {
  const rows = db
    .prepare("select schema, version from version where schema in (?, ?)")
    .all("userdata", "compatibility") as { schema: string; version: number }[];
  const read = (schema: string): number => {
    const row = rows.find((candidate) => candidate.schema === schema);
    if (!row) throw new Error(`the database declares no ${schema} version.`);
    return row.version;
  };
  return { userdata: read("userdata"), compatibility: read("compatibility") };
}

/**
 * @returns the versions the database declares.
 * @throws when they are not {@link PRISTINE_SCHEMA_VERSIONS}.
 */
export function assertSchemaVersions(db: DatabaseSync): SchemaVersions {
  const found = readSchemaVersions(db);
  const expected = PRISTINE_SCHEMA_VERSIONS;
  if (
    found.userdata === expected.userdata &&
    found.compatibility === expected.compatibility
  ) {
    return found;
  }
  throw new Error(
    `the pristine template declares userdata ${found.userdata} / compatibility ${found.compatibility},` +
      ` and the Fixture targets userdata ${expected.userdata} / compatibility ${expected.compatibility}.` +
      ` Harvest a template from Zotero ${PINNED_ZOTERO_VERSION}, or move the target to the new schema era.`,
  );
}

export interface HarvestReport {
  applicationDir: string;
  userdata: number;
  compatibility: number;
  /** Size of the harvested database on disk. */
  bytes: number;
  /** Size of the committed template. */
  compressedBytes: number;
}

/** Long enough for a cold first run to unpack translators and styles. */
const INIT_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 1_000;
/** Consecutive unchanged polls that read as "Zotero has stopped writing". */
const QUIET_POLLS = 8;
/** How long a `SIGTERM` gets to end the process before a `SIGKILL` follows. */
const SHUTDOWN_TIMEOUT_MS = 30_000;

/**
 * First-run the pinned Zotero on an empty data directory and capture the
 * database it creates as the committed template. `workDir` holds the throwaway
 * profile and data directory, and is removed on the way out.
 *
 * @throws when Zotero exits early, initialization times out, or the captured
 * database fails its integrity checks.
 */
export async function harvestPristineTemplate(
  workDir: string,
): Promise<HarvestReport> {
  const target = {
    profileDir: join(workDir, "profile"),
    dataDir: join(workDir, "data"),
  };
  const databasePath = join(target.dataDir, "zotero.sqlite");

  await rm(workDir, { recursive: true, force: true });
  await mkdir(target.profileDir, { recursive: true });
  await mkdir(target.dataDir, { recursive: true });
  await writeFile(
    join(target.profileDir, "prefs.js"),
    [...QUIET_FIRST_RUN_PREFS, ""].join("\n"),
  );

  const applicationDir = await resolveZoteroApp();
  console.log(`First-running ${applicationDir} on an empty data directory`);
  const zotero = spawnZotero(applicationDir, target, { detached: false });
  try {
    await waitForInitialization(zotero, target.dataDir);
    console.log("Zotero settled; quitting it");
  } finally {
    await quit(zotero);
  }

  const report = compact(databasePath, applicationDir);
  const template = gzipSync(await readFile(databasePath), { level: 9 });
  await writeFile(PRISTINE_TEMPLATE_PATH, template);
  await rm(workDir, { recursive: true, force: true });
  return { ...report, compressedBytes: template.byteLength };
}

/**
 * Zotero holds its database under an exclusive lock, so nothing can read the
 * initialization out of it while Zotero runs. Wait on the data directory
 * instead: the bundled styles land after the schema is in place, and a
 * write-ahead log that stops growing means Zotero has stopped writing. The
 * capture itself is verified once the lock is gone — see {@link compact}.
 */
async function waitForInitialization(
  zotero: ChildProcess,
  dataDir: string,
): Promise<void> {
  const deadline = Date.now() + INIT_TIMEOUT_MS;
  let exited = false;
  zotero.once("exit", () => {
    exited = true;
  });

  let previous: string | null = null;
  let quiet = 0;
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error("Zotero exited before it finished initializing.");
    }
    const current = await readWriteSignature(dataDir);
    quiet = current !== null && current === previous ? quiet + 1 : 0;
    if (quiet >= QUIET_POLLS) return;
    previous = current;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Zotero did not finish initializing within ${INIT_TIMEOUT_MS / 1000} seconds.`,
  );
}

/**
 * What Zotero has written so far, or `null` before it has written enough to
 * judge. Two consecutive equal signatures mean nothing moved in between.
 */
async function readWriteSignature(dataDir: string): Promise<string | null> {
  const styles = await readdir(join(dataDir, "styles")).catch(() => []);
  if (styles.length === 0) return null;

  const sizes = await Promise.all(
    ["zotero.sqlite", "zotero.sqlite-wal"].map((name) =>
      stat(join(dataDir, name)).then(
        (stats) => `${stats.size}@${stats.mtimeMs}`,
        () => null,
      ),
    ),
  );
  return sizes.includes(null) ? null : sizes.join(" ");
}

/**
 * Stop Zotero. It holds its database open under an exclusive lock and leaves
 * the write-ahead log behind either way, so the capture is only sound once
 * {@link compact} folds that log back in.
 */
async function quit(zotero: ChildProcess): Promise<void> {
  if (zotero.exitCode !== null || zotero.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => zotero.once("exit", resolve));
  zotero.kill("SIGTERM");
  const stalled = Symbol("stalled");
  const outcome = await Promise.race([
    exited,
    delay(SHUTDOWN_TIMEOUT_MS, stalled),
  ]);
  if (outcome !== stalled) return;
  zotero.kill("SIGKILL");
  await exited;
}

/**
 * Fold the write-ahead log back into the database and shrink it, so the
 * template is one self-contained file — the shape ADR 0022 commits to.
 *
 * @throws when the captured database fails `integrity_check`,
 * `foreign_key_check`, or declares versions the Fixture does not target.
 */
function compact(
  databasePath: string,
  applicationDir: string,
): Omit<HarvestReport, "compressedBytes"> {
  using db = new DatabaseSync(databasePath);
  db.exec("pragma wal_checkpoint(truncate)");
  db.exec("pragma journal_mode = delete");
  db.exec("vacuum");

  const integrity = db.prepare("pragma integrity_check").all();
  const first = integrity[0] as { integrity_check?: string } | undefined;
  if (integrity.length !== 1 || first?.integrity_check !== "ok") {
    throw new Error(
      `the harvested database failed integrity_check: ${JSON.stringify(integrity)}.`,
    );
  }
  const violations = db.prepare("pragma foreign_key_check").all();
  if (violations.length > 0) {
    throw new Error(
      `the harvested database failed foreign_key_check: ${JSON.stringify(violations)}.`,
    );
  }

  const versions = assertSchemaVersions(db);
  const pageSize = db.prepare("pragma page_size").get() as {
    page_size: number;
  };
  const pageCount = db.prepare("pragma page_count").get() as {
    page_count: number;
  };
  return {
    applicationDir,
    ...versions,
    bytes: pageSize.page_size * pageCount.page_count,
  };
}
