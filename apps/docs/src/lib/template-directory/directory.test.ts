import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { compileFilter, matchCondition } from "@zotlit/workbench/match";

import {
  formatEntrySamples,
  ITEM_TYPES,
  readTemplateDirectory,
  templateDirectoryRoot,
  verifyTemplateDirectory,
} from "./index";
import type { DirectoryEntry } from "./index";

const root = await templateDirectoryRoot();
const verification = verifyTemplateDirectory(await readTemplateDirectory(root));

function entryOf<K extends DirectoryEntry["kind"]>(
  id: string,
  kind: K,
): Extract<DirectoryEntry, { kind: K }> {
  const entry = verification.entries.find((candidate) => candidate.id === id);
  expect(entry?.kind, id).toBe(kind);
  return entry as Extract<DirectoryEntry, { kind: K }>;
}

/** The Profiles made for one item type, with the one type each is made for. */
const TYPE_PROFILES = [
  ["profiles/books", "book"],
  ["profiles/book-chapters", "bookSection"],
  ["profiles/theses-and-dissertations", "thesis"],
] as const;

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

  it.each(TYPE_PROFILES)(
    "selects %s automatically for the item type %s and no other",
    (id, itemType) => {
      const { match } = entryOf(id, "profile").manifest;
      expect(match, id).toBeDefined();
      const { condition } = compileFilter(match!);
      const selected = ITEM_TYPES.filter((type) =>
        matchCondition(condition!, {
          library: null,
          itemType: type,
          tags: [],
          collections: [],
        }),
      );
      expect(selected).toEqual([itemType]);
    },
  );

  it.each(TYPE_PROFILES)(
    "gives %s the Publication details rule verbatim",
    (id) => {
      const { property } = entryOf(
        "properties/publication-details-set",
        "property",
      );
      expect(entryOf(id, "profile").manifest.frontmatter).toContainEqual(
        property,
      );
    },
  );

  it("names the book, its editors, and the chapter's pages in a Book chapters note", () => {
    const chapter = verification.samples
      .get("profiles/book-chapters")!
      .notes.find(({ sample }) => sample.id === "book-section")!;
    expect(chapter.body).toContain(
      "In *Judgment under Uncertainty: Heuristics and Biases*, edited by Daniel Kahneman, Paul Slovic, and Amos Tversky · pp. 3–20",
    );
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
