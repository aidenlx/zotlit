import { describe, expect, it } from "vitest";

import { verifyTemplateDirectory } from "./index";
import type { DirectoryProblemCode } from "./index";
import {
  edit,
  FIXTURE_HEADING,
  FIXTURE_HEADING_FILE,
  FIXTURE_PROFILE,
  FIXTURE_PROFILE_FILE,
  FIXTURE_PROPERTY,
  FIXTURE_PROPERTY_FILE,
  FIXTURE_QUOTE,
  FIXTURE_QUOTE_FILE,
  fixtureFiles,
  PROFILE_SOURCE,
} from "./test-fixtures";

function problemsOf(files: ReadonlyMap<string, string>) {
  return verifyTemplateDirectory(files).problems;
}

function rejects(
  files: ReadonlyMap<string, string>,
  entry: string,
  code: DirectoryProblemCode,
): void {
  expect(problemsOf(files)).toContainEqual(
    expect.objectContaining({ entry, code }),
  );
}

const editProfile = (from: string, to: string) =>
  edit(fixtureFiles(), FIXTURE_PROFILE_FILE, [from, to]);

describe("the Directory verification", () => {
  it("passes a Directory that keeps every rule", () => {
    expect(problemsOf(fixtureFiles())).toEqual([]);
  });

  describe("the entry format", () => {
    it("rejects a file outside every entry folder", () => {
      const files = fixtureFiles().set("templates/stray.md", "stray");
      rejects(files, "templates/stray.md", "unexpected-file");
    });

    it("rejects a file an entry does not hold", () => {
      const files = fixtureFiles().set(`${FIXTURE_HEADING}/notes.md`, "x");
      rejects(files, FIXTURE_HEADING, "unexpected-file");
    });

    it("rejects an entry without its artifact", () => {
      const files = fixtureFiles();
      files.delete(FIXTURE_HEADING_FILE);
      rejects(files, FIXTURE_HEADING, "missing-file");
    });

    it("rejects a folder name that is not a lowercase slug", () => {
      const files = fixtureFiles()
        .set("partials/Bad_Name/entry.md", "x")
        .set("partials/Bad_Name/zotlit-partial.Bad_Name.md", "x");
      rejects(files, "partials/Bad_Name", "invalid-slug");
    });

    it("rejects a partial entry under a name the plugin reserves", () => {
      const files = fixtureFiles()
        .set("partials/note/entry.md", "x")
        .set("partials/note/zotlit-partial.note.md", "x");
      rejects(files, "partials/note", "reserved-partial-name");
    });

    it("rejects metadata outside the facet vocabulary", () => {
      const files = edit(fixtureFiles(), `${FIXTURE_HEADING}/entry.md`, [
        "tasks: [general-reading]",
        "tasks: [gardening]",
      ]);
      rejects(files, FIXTURE_HEADING, "invalid-metadata");
    });

    it("rejects an entry with no reader-facing description", () => {
      const files = edit(fixtureFiles(), `${FIXTURE_HEADING}/entry.md`, [
        "A fixture partial.",
        "",
      ]);
      rejects(files, FIXTURE_HEADING, "invalid-metadata");
    });

    it("rejects an artifact that does not parse", () => {
      const files = editProfile("contract: 3", "contract: three");
      rejects(files, FIXTURE_PROFILE, "invalid-artifact");
    });

    it("names the kinds it cannot verify yet", () => {
      const files = fixtureFiles()
        .set(
          "partials/cited-quote/entry.md",
          "---\ntitle: T\nsummary: S\nminAppVersion: '2.2.0'\ncontext: citation\ntasks: [writing]\nproblems: [p]\naudience: a\neffort: e\n---\n\nText.\n",
        )
        .set(
          "partials/cited-quote/zotlit-partial.cited-quote.md",
          "{{ zt.variant }}\n",
        );
      rejects(files, "partials/cited-quote", "unverified");
    });
  });

  describe("Profile invariants", () => {
    it("rejects a Profile ID that is not twelve letters and digits", () => {
      rejects(
        editProfile("id: FixtureProf1", "id: fixture-profile"),
        FIXTURE_PROFILE,
        "profile-id",
      );
    });

    it("rejects two Profile entries with one ID", () => {
      const files = fixtureFiles()
        .set(
          "profiles/second-profile/entry.md",
          fixtureFiles().get(`${FIXTURE_PROFILE}/entry.md`)!,
        )
        .set(
          "profiles/second-profile/zotlit-profile.second-profile.md",
          PROFILE_SOURCE,
        );
      rejects(files, FIXTURE_PROFILE, "duplicate-profile-id");
      rejects(files, "profiles/second-profile", "duplicate-profile-id");
    });

    it.each([
      ["folder", "folder: Literature notes"],
      ["importFolder", "importFolder: Imported"],
      ["citationStyle", "citationStyle: apa"],
      ["importColoredHighlights", "importColoredHighlights: true"],
      ["importAnnotationsAsTemplate", "importAnnotationsAsTemplate: false"],
    ])("rejects a %s binding", (_key, line) => {
      rejects(
        editProfile("contract: 3", `contract: 3\n${line}`),
        FIXTURE_PROFILE,
        "profile-binding",
      );
    });

    it("accepts a match on built-in item types", () => {
      const files = editProfile(
        "contract: 3",
        `contract: 3\nmatch: 'itemType == "book" || itemType == "bookSection"'`,
      );
      expect(problemsOf(files)).toEqual([]);
    });

    it.each([
      ["tags", `'tags.contains("To read")'`],
      ["collections", `'collections.contains("Thesis")'`],
      ["an excluded item type", `'itemType != "book"'`],
      ["every item", `'true'`],
    ])("rejects a match on %s", (_subject, match) => {
      rejects(
        editProfile("contract: 3", `contract: 3\nmatch: ${match}`),
        FIXTURE_PROFILE,
        "profile-match",
      );
    });

    it("rejects a Profile written in Eta", () => {
      rejects(
        editProfile("contract: 3", "contract: 3\nlanguage: eta"),
        FIXTURE_PROFILE,
        "template-language",
      );
    });

    it("rejects a packed partial written in Eta", () => {
      rejects(
        editProfile(
          "  - name: fixture-quote\n    language: liquid",
          "  - name: fixture-quote\n    language: eta",
        ),
        FIXTURE_PROFILE,
        "template-language",
      );
    });

    it.each([
      ["a Liquid expression", "expr: zt.title"],
      ["a JavaScript expression", "js: zt.title"],
    ])("rejects a property written as %s", (_kind, member) => {
      rejects(
        editProfile('value: {"$eval": "zt.title"}', member),
        FIXTURE_PROFILE,
        "property-language",
      );
    });

    it("rejects an older template contract", () => {
      rejects(
        editProfile("contract: 3", "contract: 2"),
        FIXTURE_PROFILE,
        "profile-contract",
      );
    });

    it.each(["author", "description", "sampleItemType", "minAppVersion"])(
      "rejects a manifest without %s",
      (key) => {
        const line = PROFILE_SOURCE.split("\n").find((text) =>
          text.startsWith(`${key}:`),
        )!;
        rejects(
          editProfile(`${line}\n`, ""),
          FIXTURE_PROFILE,
          "profile-metadata",
        );
      },
    );

    it("rejects a note body without a Managed Block", () => {
      rejects(
        editProfile(
          '{% managed %}\n{% render "fixture-heading" with zt as zt %}\n{% endmanaged %}\n',
          '{% render "fixture-heading" with zt as zt %}\n',
        ),
        FIXTURE_PROFILE,
        "managed-block",
      );
    });

    it("rejects template code outside the Managed Block", () => {
      rejects(
        editProfile("## My notes", "## Notes on {{ zt.title }}"),
        FIXTURE_PROFILE,
        "managed-block",
      );
    });
  });

  describe("the one partial namespace", () => {
    it("rejects a call to a partial no entry holds", () => {
      rejects(
        editProfile(
          "{% endmanaged %}",
          '{% render "nowhere" with zt as zt %}\n{% endmanaged %}',
        ),
        FIXTURE_PROFILE,
        "unknown-partial",
      );
    });

    it("rejects a called partial the Profile does not pack", () => {
      rejects(
        editProfile(
          "  - name: fixture-heading\n    language: liquid\n    source: |\n      ## {{ zt.title }}\n",
          "",
        ),
        FIXTURE_PROFILE,
        "partial-not-packed",
      );
    });

    it("rejects a packed partial that differs from its partial entry", () => {
      const files = edit(fixtureFiles(), FIXTURE_HEADING_FILE, [
        "## {{ zt.title }}",
        "### {{ zt.title }}",
      ]);
      rejects(files, FIXTURE_PROFILE, "packed-partial-differs");
    });

    it("rejects a packed partial nothing calls", () => {
      rejects(
        editProfile(
          '{% render "fixture-heading" with zt as zt %}\n',
          "## {{ zt.title }}\n",
        ),
        FIXTURE_PROFILE,
        "packed-partial-uncalled",
      );
    });

    it("rejects a partial entry written in Eta", () => {
      rejects(
        edit(fixtureFiles(), FIXTURE_HEADING_FILE, [
          "language: liquid",
          "language: eta",
        ]),
        FIXTURE_HEADING,
        "template-language",
      );
    });
  });

  describe("rendering", () => {
    it("rejects a Profile that fails to render a Sample Item", () => {
      rejects(
        editProfile(
          "{% endmanaged %}",
          "{{ zt.title | no_such_filter }}\n{% endmanaged %}",
        ),
        FIXTURE_PROFILE,
        "render-diagnostic",
      );
    });

    it("rejects a partial that fails to render", () => {
      rejects(
        edit(fixtureFiles(), FIXTURE_QUOTE_FILE, [
          "> {{ zt.text }}",
          "> {{ zt.text | no_such_filter }}",
        ]),
        FIXTURE_QUOTE,
        "render-diagnostic",
      );
    });

    it.each([
      ["a null value", '{"$eval": "zt.DOI"}'],
      ["the word null", '"Issue: ${str(zt.issue)}"'],
      ["a label without its number", '"Vol. ${zt.volume}"'],
      ["a dangling separator", '{"$eval": "zt.title + \' ·\'"}'],
      ["empty text", '""'],
    ])("rejects a property that writes %s", (_fault, rule) => {
      rejects(
        editProfile('value: {"$eval": "zt.title"}', `value: ${rule}`),
        FIXTURE_PROFILE,
        "property-output",
      );
    });

    it("accepts volume, issue, and page labels that carry their numbers", () => {
      const files = editProfile(
        'value: {"$eval": "zt.title"}',
        'value: "PLoS Medicine. 2005. Vol. 2. № 8. pp. 10–20."',
      );
      expect(problemsOf(files)).toEqual([]);
    });

    it("accepts an empty property the reader fills in and keeps on update", () => {
      const files = editProfile(
        'value: {"$eval": "zt.title"}\n    merge: replace',
        "value: null\n    merge: keep",
      );
      expect(problemsOf(files)).toEqual([]);
    });

    it("shows an empty property as Obsidian writes it into the note", () => {
      const files = editProfile(
        'value: {"$eval": "zt.title"}\n    merge: replace',
        "value: null\n    merge: keep",
      );
      const [note] =
        verifyTemplateDirectory(files).samples.get(FIXTURE_PROFILE)!.notes;
      expect(note!.properties).toBe("title:\n");
    });

    it("rejects a property entry whose result differs from its stated one", () => {
      rejects(
        edit(fixtureFiles(), `${FIXTURE_PROPERTY}/entry.md`, [
          "letter: { year: 1887 }",
          "letter: { year: 1888 }",
        ]),
        FIXTURE_PROPERTY,
        "property-expectation",
      );
    });

    it("rejects a property entry that states a result for no sample", () => {
      rejects(
        edit(fixtureFiles(), `${FIXTURE_PROPERTY}/entry.md`, [
          "letter: { year: 1887 }",
          "postcard: { year: 1887 }",
        ]),
        FIXTURE_PROPERTY,
        "property-expectation",
      );
    });

    describe("a partial's stated call", () => {
      const withCall = (call: string) =>
        edit(fixtureFiles(), `${FIXTURE_QUOTE}/entry.md`, [
          "context: annotation",
          `context: annotation\ncall: '${call}'`,
        ]);

      it("renders the partial through the call its entry states", () => {
        const annotations = verifyTemplateDirectory(
          withCall('Called: {% render "fixture-quote" with zt as zt %}'),
        ).samples.get(FIXTURE_QUOTE)!.annotations;
        expect(annotations[0]!.output?.trim()).toBe(
          "Called: > Clear methods make research easier to reproduce.",
        );
      });

      it("rejects a call that fails to render", () => {
        rejects(
          withCall('{% render "nowhere" with zt as zt %}'),
          FIXTURE_QUOTE,
          "render-diagnostic",
        );
      });
    });

    describe("highlight colors", () => {
      const SAMPLE_ANNOTATION_LABELS = [
        "highlight annotation, yellow",
        "underline annotation, blue",
        "note annotation, purple",
        "text annotation",
        "image annotation, green",
        "ink annotation, red",
      ];

      it.each([
        [FIXTURE_QUOTE, `${FIXTURE_QUOTE}/entry.md`, "context: annotation"],
        [FIXTURE_PROFILE, `${FIXTURE_PROFILE}/entry.md`, "effort: Nothing."],
      ])(
        "renders %s, which shows highlight colors, over a highlight in every other Zotero color and a custom color",
        (entry, entryFile, line) => {
          const files = edit(fixtureFiles(), entryFile, [
            line,
            `${line}\nfeatures: [color-highlights]`,
          ]);
          const annotations =
            verifyTemplateDirectory(files).samples.get(entry)!.annotations;
          expect(annotations.map(({ label }) => label)).toEqual([
            ...SAMPLE_ANNOTATION_LABELS,
            "highlight annotation, red",
            "highlight annotation, green",
            "highlight annotation, blue",
            "highlight annotation, purple",
            "highlight annotation, magenta",
            "highlight annotation, orange",
            "highlight annotation, gray",
            "highlight annotation, plum",
            "highlight annotation, custom color #1f8a70",
          ]);
          expect(annotations.at(-1)!.output?.trim()).toBe(
            "> Clear methods make research easier to reproduce.",
          );
        },
      );

      it("renders an entry that shows no highlight colors over the Sample Annotations alone", () => {
        const annotations =
          verifyTemplateDirectory(fixtureFiles()).samples.get(
            FIXTURE_QUOTE,
          )!.annotations;
        expect(annotations.map(({ label }) => label)).toEqual(
          SAMPLE_ANNOTATION_LABELS,
        );
      });
    });

    it("rejects a property entry that is not a JSON-e rule", () => {
      rejects(
        edit(fixtureFiles(), FIXTURE_PROPERTY_FILE, [
          'value: {"$if": "zt.date && zt.date.year", "then": {"$eval": "zt.date.year"}}',
          "expr: zt.date.year",
        ]),
        FIXTURE_PROPERTY,
        "property-language",
      );
    });
  });
});
