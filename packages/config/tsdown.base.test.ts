import { deepStrictEqual } from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { pruneUnemitted } from "./tsdown.base.ts";

let outDir: string;

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

async function files(...paths: string[]): Promise<void> {
  outDir = await mkdtemp(join(tmpdir(), "tsdown-prune-"));
  for (const path of paths) {
    await mkdir(dirname(join(outDir, path)), { recursive: true });
    await writeFile(join(outDir, path), path);
  }
}

async function onDisk(): Promise<string[]> {
  const entries = await readdir(outDir, { recursive: true });
  return entries.map((entry) => entry.replaceAll("\\", "/")).toSorted();
}

describe("pruneUnemitted", () => {
  it("keeps every emitted file and removes the others", async () => {
    await files("index.mjs", "index.d.mts", "removed.mjs", "removed.d.mts");

    await pruneUnemitted(outDir, ["index.mjs", "index.d.mts"]);

    deepStrictEqual(await onDisk(), ["index.d.mts", "index.mjs"]);
  });

  it("removes a folder that holds only stale files", async () => {
    await files("index.mjs", "old/a.mjs", "old/deep/b.mjs");

    await pruneUnemitted(outDir, ["index.mjs"]);

    deepStrictEqual(await onDisk(), ["index.mjs"]);
  });

  it("keeps a folder that still holds an emitted file", async () => {
    await files("client/node.mjs", "client/removed.mjs");

    await pruneUnemitted(outDir, ["client/node.mjs"]);

    deepStrictEqual(await onDisk(), ["client", "client/node.mjs"]);
  });
});
