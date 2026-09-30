import { describe, expect, it } from "vitest";

import {
  readTemplateDirectory,
  templateDirectoryRoot,
  verifyTemplateDirectory,
} from "./index";
import { searchDirectory } from "./search";
import { directorySite } from "./site-data";

const verification = verifyTemplateDirectory(
  await readTemplateDirectory(await templateDirectoryRoot()),
);
const { entries } = directorySite(verification);

/** The text a reader reads, without the Obsidian UI labels it quotes. */
const withoutUiLabels = (markdown: string) =>
  markdown.replaceAll(/\*\*[^*]+\*\*/g, "").replaceAll(/`[^`]*`/g, "");

describe("the prose of every Directory Entry", () => {
  it("holds prose in the Details, with the call a look writes left to the Source fold", () => {
    expect(
      entries.filter(({ description }) => description.includes("```")),
    ).toEqual([]);
  });

  it("says profile only inside a quoted UI label", () => {
    const wording = entries.flatMap(({ id, summary, description }) =>
      [summary, description]
        .filter((text) => /profile/i.test(withoutUiLabels(text)))
        .map(() => id),
    );
    expect(wording).toEqual([]);
  });

  it("stays searchable by each problem and keyword the entry lists", () => {
    const index = entries.map((entry) => ({ ...entry }));
    const missed = entries.flatMap(({ id, problems, keywords }) =>
      [...problems, ...keywords]
        .filter(
          (text) =>
            !searchDirectory(index, { text, facets: {} }).some(
              (found) => found.id === id,
            ),
        )
        .map((text) => `${id}: ${text}`),
    );
    expect(missed).toEqual([]);
  });
});
