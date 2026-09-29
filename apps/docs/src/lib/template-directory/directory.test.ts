import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  formatEntrySamples,
  readTemplateDirectory,
  templateDirectoryRoot,
  verifyTemplateDirectory,
} from "./index";

/**
 * The `###` headings of a rendered note, each with the non-blank lines below
 * it up to the next heading.
 */
function groups(markdown: string): [string, string[]][] {
  const found: [string, string[]][] = [];
  for (const line of markdown.split("\n")) {
    if (line.startsWith("### ")) found.push([line.slice(4), []]);
    else if (/^(?:#{1,2} |%%)/.test(line) && found.length > 0) break;
    else if (line.trim() !== "") found.at(-1)?.[1].push(line);
  }
  return found;
}

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

  describe("annotations grouped by color", () => {
    const body = (entry: string, sample: string) =>
      verification.samples
        .get(entry)!
        .notes.find(({ sample: { id } }) => id === sample)!.body!;

    it("puts every annotation under one heading per color meaning, in legend order", () => {
      const clear = "Clear methods make research easier to reproduce.";
      expect(groups(body("partials/color-groups", "every-color"))).toEqual([
        ["Important", [`- highlight annotation, yellow, p. 1: ${clear}`]],
        [
          "Disagree",
          [
            `- highlight annotation, red, p. 1: ${clear}`,
            "- ink annotation, red, p. 6",
          ],
        ],
        [
          "Agree",
          [
            `- highlight annotation, green, p. 1: ${clear}`,
            "- image annotation, green, p. 5: Study design and participant flow.",
          ],
        ],
        [
          "Background",
          [
            `- highlight annotation, blue, p. 1: ${clear}`,
            "- underline annotation, blue, p. 2: Report the assumptions behind each result.",
          ],
        ],
        [
          "Definitions",
          [
            `- highlight annotation, purple, p. 1: ${clear}`,
            "- note annotation, purple, p. 3: Compare these findings with the replication study.",
          ],
        ],
        ["Examples", [`- highlight annotation, magenta, p. 1: ${clear}`]],
        ["Questions", [`- highlight annotation, orange, p. 1: ${clear}`]],
        ["Quotes to use", [`- highlight annotation, gray, p. 1: ${clear}`]],
        ["Paraphrases", [`- highlight annotation, plum, p. 1: ${clear}`]],
        [
          "Other highlights",
          [
            `- highlight annotation, custom color #1f8a70, p. 1: ${clear}`,
            "- text annotation, p. 4: Check the sample size before citing this estimate.",
          ],
        ],
      ]);
    });

    it.each([
      [
        "profiles/reading-notes-by-color",
        [
          "Important",
          "Disagree",
          "Agree",
          "Background",
          "Definitions",
          "Examples",
          "Questions",
          "Quotes to use",
          "Paraphrases",
          "Other highlights",
        ],
      ],
      [
        "profiles/literature-review",
        [
          "Aim",
          "Methods",
          "Findings",
          "Limitations",
          "Gaps and future research",
          "Related work",
          "Definitions",
          "Quotes to use",
          "Paraphrases",
          "Other highlights",
        ],
      ],
      [
        "profiles/critical-reading",
        [
          "Main claims",
          "Definitions",
          "Arguments",
          "Objections",
          "Unclear points",
          "Examples",
          "Other views",
          "Quotes to use",
          "Paraphrases",
          "Other highlights",
        ],
      ],
    ])(
      "groups the annotations of %s by its meaning set, in the order of its colors",
      (entry, headings) => {
        expect(
          groups(body(entry, "every-color")).map(([heading]) => heading),
        ).toEqual(headings);
      },
    );

    it("writes no heading for a color meaning without annotations", () => {
      expect(
        groups(body("partials/color-groups", "conference-paper")).map(
          ([heading]) => heading,
        ),
      ).toEqual(["Important"]);
      expect(body("partials/color-groups", "journal-article").trim()).toBe("");
    });
  });

  describe("Profiles with reading prompts", () => {
    it.each([
      [
        "profiles/reading-notes-by-color",
        ["Key takeaways", "My claims and ideas", "Connections"],
      ],
      [
        "profiles/literature-review",
        [
          "Aim",
          "Methods",
          "Findings",
          "Limitations",
          "Relevance to my project",
        ],
      ],
      [
        "profiles/critical-reading",
        [
          "Main thesis",
          "Key definitions",
          "Arguments",
          "Objections and doubts",
          "Key quotes",
        ],
      ],
    ])(
      "puts the prompts of %s above the part an update refreshes",
      (entry, prompts) => {
        for (const { body } of verification.samples.get(entry)!.notes) {
          const [above, managed] = body!.split("%%zt-managed%%");
          expect(above!.match(/^#+ .*$/gm)).toEqual(
            prompts.map((prompt) => `## ${prompt}`),
          );
          for (const prompt of prompts) {
            expect(managed!.split("\n")).not.toContain(`## ${prompt}`);
          }
        }
      },
    );

    it("keeps the review properties a reader sets by hand", () => {
      const entry = verification.entries.find(
        ({ id }) => id === "profiles/literature-review",
      )!;
      const frontmatter =
        entry.kind === "profile" ? entry.manifest.frontmatter : [];
      expect(
        (frontmatter ?? [])
          .filter(({ key }) =>
            ["status", "date-read", "contribution"].includes(key ?? ""),
          )
          .map(({ key, merge }) => [key, merge]),
      ).toEqual([
        ["status", "keep"],
        ["date-read", "keep"],
        ["contribution", "keep"],
      ]);
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
