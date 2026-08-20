// Content-based source identity against genuine SQLite database files.

import {
  copyFile,
  mkdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";

const walReadFault = vi.hoisted(() => ({
  path: "",
  afterFirstHeaderRead: undefined as (() => void) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    async open(...args: Parameters<typeof actual.open>) {
      const file = await actual.open(...args);
      if (String(args[0]) !== walReadFault.path) return file;
      let headerReads = 0;
      return {
        stat: file.stat.bind(file),
        async read(
          ...args: [
            buffer: Buffer,
            offset: number,
            length: number,
            position: number,
          ]
        ) {
          const result = await file.read(...args);
          headerReads += 1;
          if (headerReads === 1) walReadFault.afterFirstHeaderRead?.();
          return result;
        },
        [Symbol.asyncDispose]: file[Symbol.asyncDispose].bind(file),
      } as unknown as typeof file;
    },
  };
});

import { snapshotSource, sourceFingerprintsEqual } from "./read-source";

it("ignores timestamp-only source changes", async () => {
  await using testDir = await createTestDir();
  const source = join(testDir.path, "zotero.sqlite");
  using _sqlite = createWalDatabase(source);
  const before = await snapshotSource(source);

  await utimes(source, 946_684_800, 946_684_800);
  await utimes(`${source}-wal`, 978_307_200, 978_307_200);
  const after = await snapshotSource(source);

  expect(sourceFingerprintsEqual(before, after)).toBe(true);
});

it("detects a rollback-journal commit that keeps the main file size", async () => {
  await using testDir = await createTestDir();
  const source = join(testDir.path, "zotero.sqlite");
  using sqlite = new DatabaseSync(source);
  sqlite.exec(`
    PRAGMA journal_mode = DELETE;
    CREATE TABLE entries (value TEXT NOT NULL);
    INSERT INTO entries VALUES ('one');
  `);
  const before = await snapshotSource(source);
  const beforeSize = before.main.exists ? before.main.size : undefined;

  sqlite.exec("UPDATE entries SET value = 'two'");
  await utimes(source, 946_684_800, 946_684_800);
  const after = await snapshotSource(source);

  expect(after.main.exists && after.main.size).toBe(beforeSize);
  expect(sourceFingerprintsEqual(before, after)).toBe(false);
});

it("distinguishes an absent WAL from an empty WAL", async () => {
  await using testDir = await createTestDir();
  const source = join(testDir.path, "zotero.sqlite");
  using sqlite = new DatabaseSync(source);
  sqlite.exec("CREATE TABLE entries (value TEXT NOT NULL)");
  const absent = await snapshotSource(source);

  await writeFile(`${source}-wal`, "");
  const empty = await snapshotSource(source);

  expect(absent.wal).toEqual({ state: "absent" });
  expect(empty.wal).toEqual({ state: "empty" });
  expect(sourceFingerprintsEqual(absent, empty)).toBe(false);
});

it("detects a same-size main database inode swap", async () => {
  await using testDir = await createTestDir();
  const source = join(testDir.path, "zotero.sqlite");
  const before = await (async () => {
    using sqlite = new DatabaseSync(source);
    sqlite.exec("CREATE TABLE entries (value TEXT NOT NULL)");
    return snapshotSource(source);
  })();

  const replaced = join(testDir.path, "replaced.sqlite");
  await rename(source, replaced);
  await copyFile(replaced, source);
  const after = await snapshotSource(source);

  expect(after.main.exists && after.main.size).toBe(
    before.main.exists ? before.main.size : undefined,
  );
  expect(sourceFingerprintsEqual(before, after)).toBe(false);
});

it("detects a same-size WAL generation reset", async () => {
  await using testDir = await createTestDir();
  const source = join(testDir.path, "zotero.sqlite");
  using sqlite = createWalDatabase(source);
  sqlite.exec(
    "PRAGMA wal_checkpoint(TRUNCATE); INSERT INTO entries VALUES ('two')",
  );
  const before = await snapshotSource(source);
  const beforeSize = (await stat(`${source}-wal`)).size;

  sqlite.exec(
    "PRAGMA wal_checkpoint(TRUNCATE); UPDATE entries SET value = 'six'",
  );
  const after = await snapshotSource(source);

  expect((await stat(`${source}-wal`)).size).toBe(beforeSize);
  expect(sourceFingerprintsEqual(before, after)).toBe(false);
});

it("treats a WAL that grows between header reads as unstable and unequal", async () => {
  await using testDir = await createTestDir();
  const source = join(testDir.path, "zotero.sqlite");
  using sqlite = createWalDatabase(source);
  walReadFault.path = `${source}-wal`;
  walReadFault.afterFirstHeaderRead = () => {
    sqlite.exec("INSERT INTO entries VALUES ('two')");
  };
  using _walReadFaultReset = {
    [Symbol.dispose]() {
      walReadFault.path = "";
      walReadFault.afterFirstHeaderRead = undefined;
    },
  };

  const fingerprint = await snapshotSource(source);

  expect(fingerprint.wal).toEqual({ state: "unstable" });
  expect(sourceFingerprintsEqual(fingerprint, fingerprint)).toBe(false);
});

function createWalDatabase(path: string): DatabaseSync {
  const sqlite = new DatabaseSync(path);
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA wal_autocheckpoint = 0;
    CREATE TABLE entries (value TEXT NOT NULL);
    INSERT INTO entries VALUES ('one');
  `);
  return sqlite;
}

async function createTestDir(): Promise<{ path: string } & AsyncDisposable> {
  const path = join(
    tmpdir(),
    `zotlit-source-generation-test-${crypto.randomUUID()}`,
  );
  await mkdir(path, { recursive: true });
  return {
    path,
    async [Symbol.asyncDispose]() {
      await rm(path, { recursive: true, force: true });
    },
  };
}
