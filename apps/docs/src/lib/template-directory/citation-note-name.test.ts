import { describe, expect, it } from "vitest";

import {
  DIRECTORY_SAMPLES,
  EDGE_SAMPLES,
  verifyTemplateDirectory,
} from "./index";
import type { DirectoryProblemCode } from "./index";
import {
  edit,
  FIXTURE_QUOTE,
  FIXTURE_QUOTE_FILE,
  fixtureFiles,
} from "./test-fixtures";

const CITATION = "citations/fixture-citation";
const CITATION_FILE = `${CITATION}/zotlit-citation.md`;
const NOTE_NAME = "note-names/fixture-name";
const NOTE_NAME_FILE = `${NOTE_NAME}/note-name.liquid`;

const RECIPE = `tasks: [writing]
problems:
  - I want a fixture.
audience: Tests.
effort: Nothing.
minAppVersion: "2.2.0-beta.0"`;

/**
 * The fixture Directory with one citation text entry and one note-name entry
 * that keep every rule.
 */
function withRecipes(): Map<string, string> {
  return fixtureFiles()
    .set(
      `${NOTE_NAME}/entry.md`,
      `---\ntitle: Fixture name\nsummary: The item key.\n${RECIPE}\n---\n\nA fixture note name.\n`,
    )
    .set(NOTE_NAME_FILE, "{{ zt.key }}{% suffix %}")
    .set(
      `${CITATION}/entry.md`,
      `---\ntitle: Fixture citation\nsummary: The variant and the item types.\n${RECIPE}\n---\n\nA fixture citation text.\n`,
    )
    .set(
      CITATION_FILE,
      '---\nlanguage: liquid\n---\n{{ zt.variant }}: {{ zt.items | map: "itemType" | join: " and " }}\n',
    );
}

function rejects(
  files: ReadonlyMap<string, string>,
  entry: string,
  code: DirectoryProblemCode,
): void {
  expect(verifyTemplateDirectory(files).problems).toContainEqual(
    expect.objectContaining({ entry, code }),
  );
}

it("passes a citation text and a note name that keep every rule", () => {
  expect(verifyTemplateDirectory(withRecipes()).problems).toEqual([]);
});

it.each([
  ["does not parse", "{{ zt.text | no_such_filter }}"],
  ["is written in Eta", "<%= it.zt.text %>"],
])(
  "verifies citation text and note names beside a partial entry that %s",
  (_fault, broken) => {
    const files = edit(withRecipes(), FIXTURE_QUOTE_FILE, [
      "> {{ zt.text }}",
      broken,
    ]);
    if (broken.startsWith("<%")) {
      edit(files, FIXTURE_QUOTE_FILE, ["language: liquid", "language: eta"]);
    }
    const { problems, samples } = verifyTemplateDirectory(files);
    expect(problems.map(({ entry }) => entry)).toEqual(
      expect.arrayContaining([FIXTURE_QUOTE]),
    );
    expect(
      problems.filter(({ entry }) => entry === CITATION || entry === NOTE_NAME),
    ).toEqual([]);
    expect(samples.has(CITATION) && samples.has(NOTE_NAME)).toBe(true);
  },
);

describe("citation text verification", () => {
  it("renders both variants over one-item and two-item citations", () => {
    const { citations } =
      verifyTemplateDirectory(withRecipes()).samples.get(CITATION)!;
    expect(citations).toContainEqual({
      sample: {
        id: "journal-article",
        itemType: "journalArticle",
        variant: null,
      },
      main: "main: journalArticle",
      alt: "alt: journalArticle",
    });
    expect(citations).toContainEqual({
      sample: { id: "two-items", itemType: null, variant: null },
      main: "main: journalArticle and book",
      alt: "alt: journalArticle and book",
    });
  });

  it("cites every Directory Sample and every Edge Sample alone", () => {
    const { citations } =
      verifyTemplateDirectory(withRecipes()).samples.get(CITATION)!;
    expect(citations!.map(({ sample }) => sample.id)).toEqual(
      expect.arrayContaining(
        [...DIRECTORY_SAMPLES, ...EDGE_SAMPLES].map(({ id }) => id),
      ),
    );
  });

  it.each([
    ["does not parse", "{{ zt.variant | no_such_filter }}"],
    ["fails while it renders", "{{ zt.variant }}{% suffix 0 %}"],
  ])("rejects a citation text that %s", (_failure, broken) => {
    rejects(
      edit(withRecipes(), CITATION_FILE, ["{{ zt.variant }}", broken]),
      CITATION,
      "render-diagnostic",
    );
  });

  it.each([
    ["no text", '{% if zt.variant == "none" %}{{ zt.variant }}{% endif %}'],
    ["empty brackets", "({{ zt.items[0].nothing }})"],
    ["the word null", "{{ zt.variant }} {{ zt.items[0].volume | json }}"],
  ])("rejects a citation text that renders %s", (_fault, broken) => {
    rejects(
      edit(withRecipes(), CITATION_FILE, [
        '{{ zt.variant }}: {{ zt.items | map: "itemType" | join: " and " }}',
        broken,
      ]),
      CITATION,
      "citation-output",
    );
  });

  it("accepts a page label followed by its number", () => {
    const files = edit(withRecipes(), CITATION_FILE, [
      "{{ zt.variant }}: ",
      "{{ zt.variant }}, p. 5: ",
    ]);
    expect(verifyTemplateDirectory(files).problems).toEqual([]);
  });

  it("rejects a citation text written in Eta", () => {
    rejects(
      edit(withRecipes(), CITATION_FILE, ["language: liquid", "language: eta"]),
      CITATION,
      "template-language",
    );
  });
});

describe("note name verification", () => {
  it("names every Directory Sample and every Edge Sample", () => {
    const { notes } =
      verifyTemplateDirectory(withRecipes()).samples.get(NOTE_NAME)!;
    expect(notes.map(({ sample }) => sample.id)).toEqual([
      ...DIRECTORY_SAMPLES.map(({ id }) => id),
      ...EDGE_SAMPLES.map(({ id }) => id),
    ]);
    expect(notes[0]).toMatchObject({
      sample: { id: "journal-article" },
      noteName: DIRECTORY_SAMPLES[0]!.snapshot.item.key,
    });
  });

  it("rejects a note name without a collision suffix", () => {
    rejects(
      edit(withRecipes(), NOTE_NAME_FILE, ["{% suffix %}", ""]),
      NOTE_NAME,
      "note-name-suffix",
    );
  });

  it("rejects a note name that fails to render", () => {
    rejects(
      edit(withRecipes(), NOTE_NAME_FILE, ["{% suffix %}", "{% suffix 0 %}"]),
      NOTE_NAME,
      "render-diagnostic",
    );
  });

  it.each([
    ["a slash, which makes a folder", "{{ zt.key }}/{{ zt.key }}"],
    ["a colon", "{{ zt.key }}: notes"],
    ["no text", "{{ zt.nothing }}"],
    ["a line break", "{{ zt.key }}\nnotes"],
    ["a space at the end", "{{ zt.key }} "],
    ["a dot at the end, which Obsidian removes", "{{ zt.key }} et al."],
    [
      "a title that keeps characters a file name cannot hold",
      '{{ zt.title | replace: ":", " -" }}',
    ],
  ])("rejects a note name with %s", (_fault, broken) => {
    rejects(
      edit(withRecipes(), NOTE_NAME_FILE, ["{{ zt.key }}", broken]),
      NOTE_NAME,
      "note-name-output",
    );
  });
});
