import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ZOTERO_DB_READ_PARENT_DIRNAME } from "@/lib/constants";

import { planReadParents } from "./read-parent";
import type { ReadParentPlan } from "./read-parent";
import { prepareRead } from "./read-source";

vi.mock("./read-parent", () => ({ planReadParents: vi.fn() }));
// Only `copyFile` is overridable, and every caller of it sees the override —
// `reflink.ts` imports it from this module too.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    copyFile: (...args: Parameters<typeof actual.copyFile>) =>
      copyFile(...args),
  };
});

const planMock = vi.mocked(planReadParents);
/** Overridable so one test can make a copy fail the way a full volume does. */
let copyFile: typeof import("node:fs/promises").copyFile;

let dir: string;
let source: string;

beforeEach(async () => {
  const { copyFile: real } =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  copyFile = real;
  dir = await mkdtemp(join(tmpdir(), "zotlit-read-parent-place-"));
  source = join(dir, "zotero.sqlite");
  await writeFile(source, Buffer.alloc(100));
});

afterEach(async () => {
  await chmod(join(dir, "read-only"), 0o700).catch(() => undefined);
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
    const readOnly = join(dir, "read-only");
    await mkdir(readOnly);
    await chmod(readOnly, 0o500);
    plan(join(readOnly, ZOTERO_DB_READ_PARENT_DIRNAME), tmpdir());

    await using prepared = await prepareRead("copy", source);

    expect(dirname(dirname(prepared.path))).toBe(tmpdir());
  });
});

describe("prepareRead consistency guard", () => {
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
});
