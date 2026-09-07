import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildFixture } from "./build.ts";
import { getFixtureLayout } from "./layout.ts";
import { generateSampleItems } from "./sample-items.ts";

import { getWorkspaceRoot } from "#package-roots";

describe("generateSampleItems", () => {
  it("regenerates the four committed samples byte for byte", async () => {
    await using resources = new AsyncDisposableStack();
    const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
    const scratch = join(workspaceRoot, "tmp");
    await mkdir(scratch, { recursive: true });
    const fixtureRoot = await mkdtemp(join(scratch, "sample-items-test-"));
    resources.defer(() => rm(fixtureRoot, { recursive: true, force: true }));
    const layout = getFixtureLayout(fixtureRoot);
    await buildFixture(layout);
    const databasePath = layout.databasePath;
    const outputDir = await mkdtemp(join(dirname(databasePath), "samples-"));
    resources.defer(() => rm(outputDir, { recursive: true, force: true }));

    const generated = await generateSampleItems({
      databasePath,
      outputDir,
      manifestPath: join(
        workspaceRoot,
        "packages/workbench/src/samples/selection.json",
      ),
    });

    expect(generated.map(({ id }) => id)).toEqual([
      "journal-article",
      "conference-paper",
      "book",
      "thesis",
    ]);
    for (const { id, path } of generated) {
      const committed = join(
        workspaceRoot,
        "packages/workbench/src/samples",
        `${id}.json`,
      );
      expect(await readFile(path, "utf8")).toBe(
        await readFile(committed, "utf8"),
      );
    }
  });
});
