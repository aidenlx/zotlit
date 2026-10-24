import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect } from "vitest";

import {
  ZOTERO_DB_READ_PARENT_DIRNAME,
  ZOTERO_DB_READ_TEMP_PREFIX,
} from "@/lib/constants";
import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { reapReadClonesEffect, reapWorkerClones } from "./reap-temps";

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

describe("reapReadClonesEffect", () => {
  it.effect("removes a clone owned by a dead process, with its contents", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => readClone(DEAD_PID));
      yield* reapReadClonesEffect({ parent });
      expect(yield* Effect.promise(names)).toEqual([]);
    }),
  );

  it.effect("keeps a clone owned by this process", () =>
    Effect.gen(function* () {
      const own = yield* Effect.promise(() => readClone(process.pid));
      yield* reapReadClonesEffect({ parent });
      expect(yield* Effect.promise(names)).toEqual([own]);
    }),
  );

  it.effect("keeps a clone owned by another live process", () =>
    Effect.gen(function* () {
      const other = yield* Effect.promise(() => readClone(process.ppid));
      yield* reapReadClonesEffect({ parent });
      expect(yield* Effect.promise(names)).toEqual([other]);
    }),
  );

  it.effect("keeps entries carrying no owner tag it recognizes", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => mkdir(join(parent, "unrelated-dir")));
      yield* Effect.promise(() =>
        writeFile(join(parent, `${ZOTERO_DB_READ_TEMP_PREFIX}notapid`), "x"),
      );
      yield* Effect.promise(() =>
        writeFile(join(parent, `${ZOTERO_DB_READ_TEMP_PREFIX}-0-x`), "x"),
      );
      yield* reapReadClonesEffect({ parent });
      expect(yield* Effect.promise(names)).toEqual([
        "unrelated-dir",
        `${ZOTERO_DB_READ_TEMP_PREFIX}-0-x`,
        `${ZOTERO_DB_READ_TEMP_PREFIX}notapid`,
      ]);
    }),
  );

  it.effect("sweeps the snapshot parent beside the database the same way", () =>
    Effect.gen(function* () {
      const beside = join(parent, ZOTERO_DB_READ_PARENT_DIRNAME);
      yield* Effect.promise(() => mkdir(beside));
      yield* Effect.promise(() =>
        mkdir(join(beside, `${ZOTERO_DB_READ_TEMP_PREFIX}${DEAD_PID}-aBcDeF`)),
      );
      const own = `${ZOTERO_DB_READ_TEMP_PREFIX}${process.pid}-aBcDeF`;
      yield* Effect.promise(() => mkdir(join(beside, own)));
      yield* reapReadClonesEffect({ parent: beside });
      expect(yield* Effect.promise(() => readdir(beside))).toEqual([own]);
    }),
  );

  it.effect("removes a dead process's clone that names its worker", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => readClone(DEAD_PID, "0123456789ab"));
      yield* reapReadClonesEffect({ parent });
      expect(yield* Effect.promise(names)).toEqual([]);
    }),
  );

  it.effect(
    "leaves every clone in place when the signal is already aborted",
    () =>
      Effect.gen(function* () {
        const dead = yield* Effect.promise(() => readClone(DEAD_PID));
        yield* reapReadClonesEffect({ parent, signal: AbortSignal.abort() });
        expect(yield* Effect.promise(names)).toEqual([dead]);
      }),
  );
});

describe("reapWorkerClones", () => {
  const DEAD_WORKER = "0123456789ab";
  const LIVE_WORKER = "ba9876543210";

  it.effect("removes the clones the named worker left, in every parent", () =>
    Effect.gen(function* () {
      const beside = join(parent, ZOTERO_DB_READ_PARENT_DIRNAME);
      yield* Effect.promise(() => readClone(process.pid, DEAD_WORKER));
      yield* Effect.promise(() => readClone(process.pid, DEAD_WORKER, beside));
      yield* reapWorkerClones({
        owner: DEAD_WORKER,
        parents: [parent, beside],
      });
      expect(yield* Effect.promise(names)).toEqual([
        ZOTERO_DB_READ_PARENT_DIRNAME,
      ]);
      expect(yield* Effect.promise(() => readdir(beside))).toEqual([]);
    }),
  );

  it.effect("keeps the clone of another worker in this process", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => readClone(process.pid, DEAD_WORKER));
      const live = yield* Effect.promise(() =>
        readClone(process.pid, LIVE_WORKER),
      );
      yield* reapWorkerClones({
        owner: DEAD_WORKER,
        parents: [parent],
      });
      expect(yield* Effect.promise(names)).toEqual([live]);
    }),
  );

  it.effect(
    "keeps clones that name no worker, and entries it does not recognize",
    () =>
      Effect.gen(function* () {
        const untagged = yield* Effect.promise(() => readClone(process.pid));
        yield* Effect.promise(() =>
          writeFile(join(parent, `${DEAD_WORKER}-aBcDeF`), "x"),
        );
        yield* Effect.promise(() =>
          writeFile(
            join(
              parent,
              `${ZOTERO_DB_READ_TEMP_PREFIX}notapid-${DEAD_WORKER}-x`,
            ),
            "x",
          ),
        );
        yield* reapWorkerClones({
          owner: DEAD_WORKER,
          parents: [parent],
        });
        expect(yield* Effect.promise(names)).toEqual(
          [
            untagged,
            `${DEAD_WORKER}-aBcDeF`,
            `${ZOTERO_DB_READ_TEMP_PREFIX}notapid-${DEAD_WORKER}-x`,
          ].sort(),
        );
      }),
  );

  it.effect("settles when a parent is absent", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => readClone(process.pid, DEAD_WORKER));
      yield* reapWorkerClones({
        owner: DEAD_WORKER,
        parents: [join(parent, "absent"), parent],
      });
      expect(yield* Effect.promise(names)).toEqual([]);
    }),
  );
});
