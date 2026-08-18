import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sweepTempDirectory } from "./temp-sweep";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "zotlit-temp-sweep-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function names(): Promise<string[]> {
  return (await readdir(directory)).sort();
}

/** The sweep under test, with a residue rule the case supplies. */
function sweep(
  isResidue: (name: string, path: string) => Promise<boolean> | boolean,
  signal?: AbortSignal,
): Promise<void> {
  return sweepTempDirectory({
    directory,
    kind: "test entry",
    isResidue,
    signal,
  });
}

describe("sweepTempDirectory", () => {
  it("removes only the entries the residue rule claims", async () => {
    await writeFile(join(directory, "keep"), "x");
    await writeFile(join(directory, "drop"), "x");
    await mkdir(join(directory, "drop-dir"));
    await writeFile(join(directory, "drop-dir", "nested"), "x");

    await sweep((name) => name.startsWith("drop"));

    expect(await names()).toEqual(["keep"]);
  });

  it("hands the rule both the entry name and its full path", async () => {
    await writeFile(join(directory, "entry"), "x");
    const isResidue = vi.fn(() => false);

    await sweep(isResidue);

    expect(isResidue).toHaveBeenCalledExactlyOnceWith(
      "entry",
      join(directory, "entry"),
    );
  });

  it("stops at an already-aborted signal without removing anything", async () => {
    await writeFile(join(directory, "drop"), "x");

    await sweep(() => true, AbortSignal.abort());

    expect(await names()).toEqual(["drop"]);
  });

  it("stops mid-walk once the signal aborts, keeping the rest", async () => {
    for (const name of ["a", "b", "c", "d"]) {
      await writeFile(join(directory, name), "x");
    }
    const controller = new AbortController();
    let seen = 0;

    await sweep(() => {
      seen += 1;
      if (seen === 2) controller.abort();
      return false;
    }, controller.signal);

    expect(seen).toBe(2);
    expect(await names()).toEqual(["a", "b", "c", "d"]);
  });

  it("resolves quietly when the directory does not exist", async () => {
    await expect(
      sweepTempDirectory({
        directory: join(directory, "absent"),
        kind: "test entry",
        isResidue: () => true,
      }),
    ).resolves.toBeUndefined();
  });

  it("survives a residue rule that throws, without removing anything", async () => {
    await writeFile(join(directory, "drop"), "x");

    await expect(
      sweep(() => {
        throw new Error("cannot decide");
      }),
    ).resolves.toBeUndefined();
    expect(await names()).toEqual(["drop"]);
  });
});
