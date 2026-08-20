import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CSL_STAGING_EXT, cslStoreDirectory } from "./csl";
import { reapCslStore } from "./reap-temps";

let parent: string;
let store: string;

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "zotlit-reap-csl-"));
  store = cslStoreDirectory(parent);
  await mkdir(store, { recursive: true });
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

/** A store entry stamped `hours` into the past. */
async function entry(name: string, hours: number): Promise<string> {
  const path = join(store, name);
  await writeFile(path, "<style/>");
  const at =
    Temporal.Now.instant().subtract({ hours }).epochMilliseconds / 1000;
  await utimes(path, at, at);
  return name;
}

async function names(): Promise<string[]> {
  return (await readdir(store)).sort();
}

const DAY = 24;

describe("reapCslStore", () => {
  it("evicts a style once it ages out, keeping one still in its window", async () => {
    await entry("old.csl", 31 * DAY);
    await entry("fresh.csl", 29 * DAY);

    await reapCslStore({ parent });

    expect(await names()).toEqual(["fresh.csl"]);
  });

  it("evicts an abandoned staged file on a far shorter clock", async () => {
    await entry(`.abandoned${CSL_STAGING_EXT}`, 2);
    await entry(`.writing${CSL_STAGING_EXT}`, 0);
    // Same age as the abandoned staged file, but a style's clock is far longer.
    await entry("kept.csl", 2);

    await reapCslStore({ parent });

    expect(await names()).toEqual([`.writing${CSL_STAGING_EXT}`, "kept.csl"]);
  });

  it("ages an unrecognized entry as a style, since ZotLit owns the store", async () => {
    await entry("stray", 31 * DAY);
    await entry("recent-stray", 1);

    await reapCslStore({ parent });

    expect(await names()).toEqual(["recent-stray"]);
  });

  it("resolves quietly before the store has ever been written", async () => {
    await rm(store, { recursive: true });

    await expect(reapCslStore({ parent })).resolves.toBeUndefined();
  });

  it("leaves every entry in place when the signal is already aborted", async () => {
    await entry("old.csl", 31 * DAY);

    await reapCslStore({ parent, signal: AbortSignal.abort() });

    expect(await names()).toEqual(["old.csl"]);
  });
});
