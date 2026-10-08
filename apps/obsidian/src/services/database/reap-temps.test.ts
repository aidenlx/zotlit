import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ZOTERO_DB_READ_PARENT_DIRNAME,
  ZOTERO_DB_READ_TEMP_PREFIX,
} from "@/lib/constants";

import { reapReadClones, reapWorkerClones } from "./reap-temps";

let parent: string;

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "zotlit-reap-clones-"));
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

/**
 * A clone directory tagged with `pid`, and with `owner` when given, as
 * `prepareRead` names one.
 */
async function readClone(
  pid: number,
  owner?: string,
  directory = parent,
): Promise<string> {
  const name = `${ZOTERO_DB_READ_TEMP_PREFIX}${pid}-${owner ? `${owner}-` : ""}aBcDeF`;
  await mkdir(join(directory, name), { recursive: true });
  await writeFile(join(directory, name, "zotero.sqlite"), "db");
  return name;
}

async function names(): Promise<string[]> {
  return (await readdir(parent)).sort();
}

/** A PID no process can hold: above the highest value any platform assigns. */
const DEAD_PID = 4_194_305;

describe("reapReadClones", () => {
  it("removes a clone owned by a dead process, with its contents", async () => {
    await readClone(DEAD_PID);

    await reapReadClones({ parent });

    expect(await names()).toEqual([]);
  });

  it("keeps a clone owned by this process", async () => {
    const own = await readClone(process.pid);

    await reapReadClones({ parent });

    expect(await names()).toEqual([own]);
  });

  it("keeps a clone owned by another live process", async () => {
    const other = await readClone(process.ppid);

    await reapReadClones({ parent });

    expect(await names()).toEqual([other]);
  });

  it("keeps entries carrying no owner tag it recognizes", async () => {
    await mkdir(join(parent, "unrelated-dir"));
    await writeFile(join(parent, `${ZOTERO_DB_READ_TEMP_PREFIX}notapid`), "x");
    await writeFile(join(parent, `${ZOTERO_DB_READ_TEMP_PREFIX}-0-x`), "x");

    await reapReadClones({ parent });

    expect(await names()).toEqual([
      "unrelated-dir",
      `${ZOTERO_DB_READ_TEMP_PREFIX}-0-x`,
      `${ZOTERO_DB_READ_TEMP_PREFIX}notapid`,
    ]);
  });

  it("sweeps the snapshot parent beside the database the same way", async () => {
    const beside = join(parent, ZOTERO_DB_READ_PARENT_DIRNAME);
    await mkdir(beside);
    await mkdir(
      join(beside, `${ZOTERO_DB_READ_TEMP_PREFIX}${DEAD_PID}-aBcDeF`),
    );
    const own = `${ZOTERO_DB_READ_TEMP_PREFIX}${process.pid}-aBcDeF`;
    await mkdir(join(beside, own));

    await reapReadClones({ parent: beside });

    expect(await readdir(beside)).toEqual([own]);
  });

  it("removes a dead process's clone that names its worker", async () => {
    await readClone(DEAD_PID, "0123456789ab");

    await reapReadClones({ parent });

    expect(await names()).toEqual([]);
  });

  it("leaves every clone in place when the signal is already aborted", async () => {
    const dead = await readClone(DEAD_PID);

    await reapReadClones({ parent, signal: AbortSignal.abort() });

    expect(await names()).toEqual([dead]);
  });
});

describe("reapWorkerClones", () => {
  const DEAD_WORKER = "0123456789ab";
  const LIVE_WORKER = "ba9876543210";

  it("removes the clones the named worker left, in every parent", async () => {
    const beside = join(parent, ZOTERO_DB_READ_PARENT_DIRNAME);
    await readClone(process.pid, DEAD_WORKER);
    await readClone(process.pid, DEAD_WORKER, beside);

    await reapWorkerClones({ owner: DEAD_WORKER, parents: [parent, beside] });

    expect(await names()).toEqual([ZOTERO_DB_READ_PARENT_DIRNAME]);
    expect(await readdir(beside)).toEqual([]);
  });

  it("keeps the clone of another worker in this process", async () => {
    await readClone(process.pid, DEAD_WORKER);
    const live = await readClone(process.pid, LIVE_WORKER);

    await reapWorkerClones({ owner: DEAD_WORKER, parents: [parent] });

    expect(await names()).toEqual([live]);
  });

  it("keeps clones that name no worker, and entries it does not recognize", async () => {
    const untagged = await readClone(process.pid);
    await writeFile(join(parent, `${DEAD_WORKER}-aBcDeF`), "x");
    await writeFile(
      join(parent, `${ZOTERO_DB_READ_TEMP_PREFIX}notapid-${DEAD_WORKER}-x`),
      "x",
    );

    await reapWorkerClones({ owner: DEAD_WORKER, parents: [parent] });

    expect(await names()).toEqual(
      [
        untagged,
        `${DEAD_WORKER}-aBcDeF`,
        `${ZOTERO_DB_READ_TEMP_PREFIX}notapid-${DEAD_WORKER}-x`,
      ].sort(),
    );
  });

  it("settles when a parent is absent", async () => {
    await readClone(process.pid, DEAD_WORKER);

    await expect(
      reapWorkerClones({
        owner: DEAD_WORKER,
        parents: [join(parent, "absent"), parent],
      }),
    ).resolves.toBeUndefined();
    expect(await names()).toEqual([]);
  });
});
