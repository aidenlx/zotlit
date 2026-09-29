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

  it("shows every highlight color in the Color-coded reading note as the callout its color meanings name", () => {
    const titles = verification.samples
      .get("profiles/color-coded-reading-note")!
      .annotations.filter(({ label }) => label.startsWith("highlight"))
      .map(({ label, output }) => [label, output!.split("\n")[0]]);
    expect(titles).toEqual([
      ["highlight annotation, yellow", "> [!warning] Important · p. 1"],
      ["highlight annotation, red", "> [!failure] Disagree · p. 1"],
      ["highlight annotation, green", "> [!success] Agree · p. 1"],
      ["highlight annotation, blue", "> [!info] Background · p. 1"],
      ["highlight annotation, purple", "> [!example] Definitions · p. 1"],
      ["highlight annotation, magenta", "> [!example] Examples · p. 1"],
      ["highlight annotation, orange", "> [!question] Questions · p. 1"],
      ["highlight annotation, gray", "> [!quote] Quotes to use · p. 1"],
      ["highlight annotation, plum", "> [!danger] Paraphrases · p. 1"],
      [
        "highlight annotation, custom color #1f8a70",
        "> [!note] Other highlights · p. 1",
      ],
    ]);
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
