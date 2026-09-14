import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { listCases, readEvalSet, resolveCase } from "#case-store";

describe("readEvalSet", () => {
  test("reads an eval set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-set-"));
    await writeFile(
      join(dir, "evals.json"),
      JSON.stringify({ skill_name: "zotlit-template", evals: [] }),
    );

    expect(await readEvalSet(join(dir, "evals.json"))).toEqual({
      skill_name: "zotlit-template",
      evals: [],
    });
  });
});

describe("resolveCase", () => {
  test("accepts an absolute path to a Case", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-case-"));

    expect(await resolveCase(dir)).toBe(dir);
  });

  test("prefers the newest iteration", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-case-"));
    for (const iteration of ["iteration-1", "iteration-2"]) {
      await mkdir(join(dir, iteration));
    }

    expect(await resolveCase(dir)).toBe(join(dir, "iteration-2"));
  });

  test("rejects an unknown case", async () => {
    await expect(resolveCase("does-not-exist")).rejects.toThrow(
      /No case directory found/,
    );
  });
});

describe("listCases", () => {
  test("lists the restored Workbench Case", async () => {
    const cases = await listCases();
    expect(cases).toContain("zotlit-template-workspace");
    expect(cases).not.toContain("..");
  });
});
