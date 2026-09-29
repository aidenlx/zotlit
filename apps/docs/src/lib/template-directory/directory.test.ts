import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  formatEntrySamples,
  readTemplateDirectory,
  templateDirectoryRoot,
  verifyTemplateDirectory,
} from "./index";

const root = await templateDirectoryRoot();
const verification = verifyTemplateDirectory(await readTemplateDirectory(root));

describe("the Template Directory", () => {
  it("passes every check", () => {
    expect(verification.problems).toEqual([]);
  });

  it("recommends the Simple reading note as a ready-to-use Profile", () => {
    const entry = verification.entries.find(
      ({ id }) => id === "profiles/simple-reading-note",
    );
    expect(entry).toMatchObject({
      kind: "profile",
      level: "ready-to-use",
      recommended: true,
      title: "Simple reading note",
      calls: ["folded-abstract", "links-row", "plain-annotation-quote"],
    });
  });

  it.each(verification.entries.map((entry) => [entry.id, entry] as const))(
    "stores the rendered samples of %s",
    async (id, entry) => {
      await expect(
        formatEntrySamples(entry, verification.samples.get(id)!),
      ).toMatchFileSnapshot(join(root, id, "samples.md"));
    },
  );
});
