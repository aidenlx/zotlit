import { appendFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ZOTERO_DB_READ_PARENT_DIRNAME } from "@/lib/constants";

import { planReadParents } from "./read-parent";
import type { ReadParentPlan } from "./read-parent";
import { prepareRead } from "./read-source";

vi.mock("./read-parent", () => ({ planReadParents: vi.fn() }));
const mkdirFault = vi.hoisted(() => ({ path: "" }));
const statSignal = vi.hoisted(() => ({
  path: "",
  calls: 0,
  run: (_call: number) => {},
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    copyFile: (...args: Parameters<typeof actual.copyFile>) =>
      copyFile(...args),
    async mkdir(...args: Parameters<typeof actual.mkdir>) {
      if (String(args[0]) === mkdirFault.path) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      await actual.mkdir(...args);
    },
    async stat(...args: Parameters<typeof actual.stat>) {
      if (String(args[0]) === statSignal.path) {
        statSignal.calls += 1;
        try {
          return await actual.stat(...args);
        } finally {
          statSignal.run(statSignal.calls);
        }
      }
      return actual.stat(...args);
    },
  };
});

const planMock = vi.mocked(planReadParents);
const journalMagic = Buffer.from([
  0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7,
]);
/** Overridable so one test can make a copy fail the way a full volume does. */
let copyFile: typeof import("node:fs/promises").copyFile;

let dir: string;
let source: string;

beforeEach(async () => {
  const { copyFile: realCopyFile } =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  copyFile = realCopyFile;
  mkdirFault.path = "";
  statSignal.path = "";
  statSignal.calls = 0;
  statSignal.run = (_call) => {};
  dir = await mkdtemp(join(tmpdir(), "zotlit-read-parent-place-"));
  source = join(dir, "zotero.sqlite");
  using sqlite = new DatabaseSync(source);
  sqlite.exec("CREATE TABLE fixture (value TEXT NOT NULL)");
});

afterEach(async () => {
  mkdirFault.path = "";
  statSignal.path = "";
  statSignal.calls = 0;
  statSignal.run = (_call) => {};
  await rm(dir, { recursive: true, force: true });
});

function plan(...parents: string[]): void {
  planMock.mockReturnValue({
    parents: parents as ReadParentPlan["parents"],
    reason: "cross-volume",
  });
}

describe("prepareRead placement", () => {
  it("creates the snapshot inside the parent the plan prefers", async () => {
    const diverted = join(dir, ZOTERO_DB_READ_PARENT_DIRNAME);
    plan(diverted, tmpdir());

    await using prepared = await prepareRead("copy", source);

    expect(dirname(dirname(prepared.path))).toBe(diverted);
  });

  it("propagates a failure that is not the parent's, leaving it untried", async () => {
    const fallback = join(dir, "fallback");
    plan(join(dir, ZOTERO_DB_READ_PARENT_DIRNAME), fallback);
    await rm(source);

    await expect(prepareRead("copy", source)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readdir(fallback)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("falls back when the preferred parent runs out of space mid-copy", async () => {
    const diverted = join(dir, ZOTERO_DB_READ_PARENT_DIRNAME);
    plan(diverted, tmpdir());
    const real = copyFile;
    copyFile = async (from, to, mode) => {
      if (String(to).startsWith(diverted)) {
        throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
      }
      await real(from, to, mode);
    };

    await using prepared = await prepareRead("copy", source);

    expect(dirname(dirname(prepared.path))).toBe(tmpdir());
  });

  it("falls back to the next parent when the preferred one refuses writes", async () => {
    const preferred = join(dir, ZOTERO_DB_READ_PARENT_DIRNAME);
    plan(preferred, tmpdir());
    mkdirFault.path = preferred;

    await using prepared = await prepareRead("copy", source);

    expect(dirname(dirname(prepared.path))).toBe(tmpdir());
  });
});

describe("prepareRead consistency guard", () => {
  it("reads a committed exclusive-lock database with an invalidated journal", async () => {
    await rm(source);
    using sqlite = new DatabaseSync(source);
    sqlite.exec(`
      PRAGMA locking_mode = EXCLUSIVE;
      PRAGMA journal_mode = DELETE;
      CREATE TABLE entries (value TEXT NOT NULL);
      INSERT INTO entries VALUES ('committed');
    `);
    plan(tmpdir());

    const journal = await readFile(`${source}-journal`);
    expect(journal.byteLength).toBeGreaterThan(512);
    expect(journal.subarray(0, journalMagic.byteLength)).not.toEqual(
      journalMagic,
    );
    await using prepared = await prepareRead("copy", source);
    using clone = new DatabaseSync(prepared.path, { readOnly: true });

    expect(clone.prepare("SELECT value FROM entries").get()).toEqual({
      value: "committed",
    });
  });

  it("retries when the acquired main file differs from the stable source", async () => {
    plan(tmpdir());
    const real = copyFile;
    let corrupted = false;
    copyFile = async (from, to, mode) => {
      await real(from, to, mode);
      if (from === source && !corrupted) {
        corrupted = true;
        await appendFile(to, "torn destination");
      }
    };

    await using prepared = await prepareRead("copy", source);
    using clone = new DatabaseSync(prepared.path, { readOnly: true });

    expect(corrupted).toBe(true);
    expect(clone.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
  });

  it("waits for an active rollback-journal transaction to roll back", async () => {
    await rm(source);
    using sqlite = new DatabaseSync(source);
    sqlite.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA cache_size = 1;
      CREATE TABLE entries (value TEXT NOT NULL, padding BLOB NOT NULL);
      INSERT INTO entries VALUES ('committed', randomblob(4096));
      BEGIN IMMEDIATE;
      UPDATE entries SET value = 'uncommitted', padding = randomblob(4096);
    `);
    plan(tmpdir());
    expect(
      (await readFile(`${source}-journal`)).subarray(
        0,
        journalMagic.byteLength,
      ),
    ).toEqual(journalMagic);
    statSignal.path = `${source}-journal`;
    statSignal.run = (call) => {
      if (call === 2) sqlite.exec("ROLLBACK");
    };

    await using prepared = await prepareRead("copy", source);
    using clone = new DatabaseSync(prepared.path, { readOnly: true });

    expect(statSignal.calls).toBeGreaterThanOrEqual(2);
    expect(clone.prepare("SELECT value FROM entries").get()).toEqual({
      value: "committed",
    });
  });

  it("rejects a rollback transaction bracketed inside source fingerprinting", async () => {
    await rm(source);
    using sqlite = new DatabaseSync(source);
    sqlite.exec(`
      PRAGMA journal_mode = DELETE;
      CREATE TABLE entries (value TEXT NOT NULL);
      INSERT INTO entries VALUES ('committed');
    `);
    plan(tmpdir());
    statSignal.path = `${source}-journal`;
    statSignal.run = (call) => {
      if (call === 2) {
        sqlite.exec(`
          BEGIN IMMEDIATE;
          UPDATE entries SET value = 'uncommitted';
        `);
      }
      if (call === 4) sqlite.exec("ROLLBACK");
    };

    await using prepared = await prepareRead("copy", source);
    using clone = new DatabaseSync(prepared.path, { readOnly: true });

    expect(statSignal.calls).toBeGreaterThanOrEqual(4);
    expect(clone.prepare("SELECT value FROM entries").get()).toEqual({
      value: "committed",
    });
  });

  it("retries when a rollback-journal commit lands during the main copy", async () => {
    await rm(source);
    using sqlite = new DatabaseSync(source);
    sqlite.exec(`
      PRAGMA journal_mode = DELETE;
      CREATE TABLE entries (value TEXT NOT NULL);
      INSERT INTO entries VALUES ('one');
    `);
    plan(tmpdir());
    const real = copyFile;
    let commitInjected = false;
    copyFile = async (from, to, mode) => {
      await real(from, to, mode);
      if (from === source && !commitInjected) {
        commitInjected = true;
        sqlite.exec("UPDATE entries SET value = 'two'");
      }
    };

    await using prepared = await prepareRead("copy", source);
    using clone = new DatabaseSync(prepared.path, { readOnly: true });

    expect(clone.prepare("SELECT value FROM entries").get()).toEqual({
      value: "two",
    });
  });

  it("retries when the WAL generation resets during its copy", async () => {
    await rm(source);
    using sqlite = new DatabaseSync(source);
    sqlite.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
      CREATE TABLE entries (value TEXT NOT NULL);
      PRAGMA wal_checkpoint(TRUNCATE);
      INSERT INTO entries VALUES ('one');
    `);
    plan(tmpdir());
    const real = copyFile;
    let resetInjected = false;
    copyFile = async (from, to, mode) => {
      await real(from, to, mode);
      if (from === `${source}-wal` && !resetInjected) {
        resetInjected = true;
        sqlite.exec(`
          PRAGMA wal_checkpoint(TRUNCATE);
          UPDATE entries SET value = 'two';
        `);
      }
    };

    await using prepared = await prepareRead("copy", source);
    using clone = new DatabaseSync(prepared.path, { readOnly: true });

    expect(clone.prepare("SELECT value FROM entries").get()).toEqual({
      value: "two",
    });
  });

  it("leaves the source bytes unchanged while acquiring a committed WAL view", async () => {
    await rm(source);
    using sqlite = new DatabaseSync(source);
    sqlite.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
      CREATE TABLE entries (value TEXT NOT NULL);
      PRAGMA wal_checkpoint(TRUNCATE);
      INSERT INTO entries VALUES ('committed in WAL');
    `);
    plan(tmpdir());
    const before = {
      main: await readFile(source),
      wal: await readFile(`${source}-wal`),
    };

    await using prepared = await prepareRead("copy", source);
    using clone = new DatabaseSync(prepared.path, { readOnly: true });
    const after = {
      main: await readFile(source),
      wal: await readFile(`${source}-wal`),
    };

    expect(after).toEqual(before);
    expect(clone.prepare("SELECT value FROM entries").get()).toEqual({
      value: "committed in WAL",
    });
  });
});
