import { describe, expect, it } from "vitest";

import { getPackageRoot } from "@zotlit/scripts/package-roots";

import { parseContentRoute } from "@/lib/markdown-routes";
import { prerenderPages } from "@/lib/prerender-pages";

import { directoryEdition } from "./markdown-edition";
import { readTemplateDirectory, templateDirectoryRoot } from "./read";
import { searchDirectory } from "./search";
import { directorySite } from "./site-data";
import {
  edit,
  FIXTURE_HEADING,
  FIXTURE_PROFILE,
  FIXTURE_PROPERTY,
  FIXTURE_PROPERTY_FILE,
  fixtureFiles,
  HEADING_SOURCE,
  PROFILE_SOURCE,
} from "./test-fixtures";
import { verifyTemplateDirectory } from "./verify";

const packageRoot = getPackageRoot(import.meta.filename);

const pagePaths = (site: ReturnType<typeof directorySite>) =>
  prerenderPages(packageRoot, site).map(({ path }) => path);

/** A partial entry the fixture Directory does not hold. */
function withBylineEntry(files: Map<string, string>): Map<string, string> {
  return files
    .set(
      "partials/fixture-byline/entry.md",
      `---
title: Fixture byline
summary: The first author, then "et al."
minAppVersion: "2.2.0-beta.0"
context: note
tasks: [writing]
problems:
  - My author line lists every author.
audience: Tests.
effort: Nothing.
---

A fixture byline.
`,
    )
    .set(
      "partials/fixture-byline/zotlit-partial.fixture-byline.md",
      "---\nlanguage: liquid\n---\n{{ zt.title }}\n",
    );
}

/** A citation text and a note-name entry, which the fixture Directory does not hold. */
function withCitationAndNoteName(
  files: Map<string, string>,
): Map<string, string> {
  return files
    .set(
      "citations/fixture-citation/entry.md",
      `---\ntitle: Fixture citation\nsummary: The variant and the item type.\nminAppVersion: "2.2.0-beta.0"\ntasks: [writing]\nproblems:\n  - I want a fixture.\naudience: Tests.\neffort: Nothing.\n---\n\nA fixture citation text.\n`,
    )
    .set(
      "citations/fixture-citation/zotlit-citation.md",
      '---\nlanguage: liquid\n---\n{{ zt.variant }}: {{ zt.items | map: "itemType" | join: " and " }}\n',
    )
    .set(
      "note-names/fixture-name/entry.md",
      `---\ntitle: Fixture name\nsummary: The item key.\nminAppVersion: "2.2.0-beta.0"\ntasks: [writing]\nproblems:\n  - I want a fixture.\naudience: Tests.\neffort: Nothing.\n---\n\nA fixture note name.\n`,
    )
    .set(
      "note-names/fixture-name/note-name.liquid",
      "{{ zt.key }}{% suffix %}",
    );
}

describe("the Directory pages", () => {
  it("prerender the index and a page for every entry", () => {
    const site = directorySite(verifyTemplateDirectory(fixtureFiles()));
    expect(pagePaths(site)).toEqual(
      expect.arrayContaining([
        "/templates",
        "/templates/profiles/fixture-profile",
        "/templates/partials/fixture-heading",
        "/templates/partials/fixture-quote",
        "/templates/properties/fixture-year",
      ]),
    );
  });

  it("publish a Markdown edition of the index and of every entry, at the page's own URL plus .md and under /llms.mdx", async () => {
    const site = directorySite(verifyTemplateDirectory(fixtureFiles()));
    const paths = pagePaths(site);
    const pages = [
      "/templates",
      "/templates/profiles/fixture-profile",
      "/templates/partials/fixture-heading",
      "/templates/partials/fixture-quote",
      "/templates/properties/fixture-year",
    ];
    expect(paths).toEqual(
      expect.arrayContaining(pages.map((page) => `${page}.md`)),
    );
    const contentRoutes = paths.filter((path) =>
      path.startsWith("/llms.mdx/templates"),
    );
    expect(contentRoutes.toSorted()).toEqual(
      pages.map((page) => `/llms.mdx${page}/content.md`).toSorted(),
    );
    for (const page of pages) {
      const route = parseContentRoute(`${page.slice(1)}/content.md`)!;
      expect(route.section).toBe("templates");
      expect(await directoryEdition(site, route.slugs)).toMatch(
        new RegExp(`^# .+ \\(${RegExp.escape(page)}\\)\\n`),
      );
    }
  });

  it("list, search, and prerender an entry added to the Directory", () => {
    const site = directorySite(
      verifyTemplateDirectory(withBylineEntry(fixtureFiles())),
    );
    expect(pagePaths(site)).toContain("/templates/partials/fixture-byline");
    expect(
      searchDirectory(site.entries, { text: "et al", facets: {} }).map(
        ({ id }) => id,
      ),
    ).toEqual(["partials/fixture-byline"]);
    expect(site.facets.task).toContainEqual({ value: "writing" });
  });
});

describe("an entry page", () => {
  const site = directorySite(verifyTemplateDirectory(fixtureFiles()));
  const page = (id: string) => site.entries.find((entry) => entry.id === id)!;

  it("copies and downloads the whole Profile document, which Import profile reads", () => {
    expect(page(FIXTURE_PROFILE)).toMatchObject({
      copyText: PROFILE_SOURCE,
      file: { name: "zotlit-profile.fixture-profile.md", text: PROFILE_SOURCE },
    });
  });

  it("downloads each entry under a name of its own: the name ZotLit reads for a template document, else one that names the entry", () => {
    const names = Object.fromEntries(
      directorySite(
        verifyTemplateDirectory(withCitationAndNoteName(fixtureFiles())),
      ).entries.map(({ id, file }) => [id, file.name]),
    );
    expect(names).toEqual({
      "profiles/fixture-profile": "zotlit-profile.fixture-profile.md",
      "partials/fixture-heading": "zotlit-partial.fixture-heading.md",
      "partials/fixture-quote": "zotlit-partial.fixture-quote.md",
      "citations/fixture-citation": "zotlit-citation.md",
      "note-names/fixture-name": "zotlit-note-name.fixture-name.liquid",
      "properties/fixture-year": "zotlit-property.fixture-year.yaml",
    });
  });

  it("copies a partial's template without its manifest, the text a new partial holds", () => {
    expect(page(FIXTURE_HEADING)).toMatchObject({
      copyText: HEADING_SOURCE,
      file: { name: "zotlit-partial.fixture-heading.md" },
      details: { kind: "partial", context: "note" },
    });
  });

  it("shows the line a Profile writes to call a partial, or the call its entry states, as the verification renders it", () => {
    expect(page(FIXTURE_HEADING).details).toEqual({
      kind: "partial",
      context: "note",
      call: '{% render "fixture-heading" with zt as zt -%}',
    });
    const stated = directorySite(
      verifyTemplateDirectory(
        edit(fixtureFiles(), `${FIXTURE_HEADING}/entry.md`, [
          "context: note\n",
          'context: note\ncall: |\n  {% render "fixture-heading" with zt as zt, level: 3 -%}\n',
        ]),
      ),
    ).entries.find(({ id }) => id === FIXTURE_HEADING)!;
    expect(stated.details).toMatchObject({
      call: '{% render "fixture-heading" with zt as zt, level: 3 -%}',
    });
  });

  it("shows a property the reader fills in as empty", () => {
    const keep = directorySite(
      verifyTemplateDirectory(
        edit(fixtureFiles(), FIXTURE_PROPERTY_FILE, [
          'value: {"$if": "zt.date && zt.date.year", "then": {"$eval": "zt.date.year"}}\nmerge: replace\n',
          "value: null\nmerge: keep\n",
        ]),
      ),
    ).entries.find(({ id }) => id === FIXTURE_PROPERTY)!;
    expect(keep.notes[0]?.properties).toEqual([{ key: "year", value: null }]);
  });

  it("copies a property's rule as the JSON the rule editor shows, and names the property and its update behavior", () => {
    expect(page(FIXTURE_PROPERTY)).toMatchObject({
      copyText:
        '{\n  "$if": "zt.date && zt.date.year",\n  "then": {\n    "$eval": "zt.date.year"\n  }\n}',
      details: { kind: "property", key: "year", merge: "replace" },
    });
  });

  it("shows each example item's note, its properties as rows", () => {
    const article = page(FIXTURE_PROFILE).notes[0]!;
    expect(article).toMatchObject({
      id: "journal-article-full-details",
      noteName: "kahnemanProspectTheoryAnalysis1979",
      properties: [
        {
          key: "title",
          value: "Prospect theory: An analysis of decision under risk",
        },
      ],
    });
    expect(article.body).toContain(
      "## Prospect theory: An analysis of decision under risk",
    );
    expect(
      page(FIXTURE_PROPERTY).notes.find(({ id }) => id === "letter")
        ?.properties,
    ).toEqual([{ key: "year", value: "1887" }]);
  });

  it("lists a fixed set of example items across item types for a Profile with no match, and no item types it is chosen for automatically", () => {
    expect(page(FIXTURE_PROFILE).matchedItemTypes).toBeNull();
    expect(page(FIXTURE_PROFILE).notes.map(({ id }) => id)).toEqual([
      "journal-article-full-details",
      "book-full-details",
      "book-section-full-details",
      "journal-article-no-annotations",
    ]);
  });

  it("lists only the items a Profile's match takes, and names the item types it is chosen for", () => {
    const matched = directorySite(
      verifyTemplateDirectory(
        edit(
          fixtureFiles(),
          `${FIXTURE_PROFILE}/zotlit-profile.fixture-profile.md`,
          [
            "sampleItemType: journalArticle\n",
            "sampleItemType: journalArticle\nmatch:\n  or:\n    - 'itemType == \"journalArticle\"'\n    - 'itemType == \"book\"'\n",
          ],
        ),
      ),
    ).entries.find(({ id }) => id === FIXTURE_PROFILE)!;
    expect(matched.matchedItemTypes).toEqual(["book", "journalArticle"]);
    expect(matched.notes.map(({ id }) => id)).toEqual([
      "journal-article-full-details",
      "book-full-details",
      "journal-article-few-details",
      "journal-article-no-annotations",
    ]);
  });

  it("shows the citations a citation text inserts under both variants, and the note names a note-name entry gives", () => {
    const recipes = directorySite(
      verifyTemplateDirectory(withCitationAndNoteName(fixtureFiles())),
    ).entries;
    const citation = recipes.find(
      ({ id }) => id === "citations/fixture-citation",
    )!;
    expect(citation.citations[0]).toEqual({
      id: "journal-article",
      main: "main: journalArticle",
      alt: "alt: journalArticle",
    });
    const noteName = recipes.find(
      ({ id }) => id === "note-names/fixture-name",
    )!;
    expect(noteName.notes[0]).toMatchObject({
      id: "journal-article",
      noteName: "IANNP5A2",
      body: null,
    });
  });
});

const directory = directorySite(
  verifyTemplateDirectory(
    await readTemplateDirectory(await templateDirectoryRoot()),
  ),
);

describe("the color key of a Profile", () => {
  const keyOf = (slug: string) =>
    directory.entries.find(({ id }) => id === `profiles/${slug}`)!.colorKey;

  it("names each Zotero color with the meaning the Profile's own highlight gives it, and the other colors last", () => {
    expect(keyOf("books")).toEqual({
      rows: [
        { color: "yellow", hex: "#ffd400", meaning: "Important" },
        { color: "red", hex: "#ff6666", meaning: "Disagree" },
        { color: "green", hex: "#5fb236", meaning: "Agree" },
        { color: "blue", hex: "#2ea8e5", meaning: "Background" },
        { color: "purple", hex: "#a28ae5", meaning: "Definitions" },
        { color: "magenta", hex: "#e56eee", meaning: "Examples" },
        { color: "orange", hex: "#f19837", meaning: "Questions" },
        { color: "gray", hex: "#aaaaaa", meaning: "Quotes to use" },
        { color: "plum", hex: "#a6507b", meaning: "Paraphrases" },
        { color: null, hex: null, meaning: "Other highlights" },
      ],
      changeWith: "partials/color-meanings",
    });
  });

  it("follows the meanings a Profile brings, and links the page that sets them", () => {
    const key = keyOf("critical-reading")!;
    expect(key.rows.map(({ meaning }) => meaning).slice(0, 2)).toEqual([
      "Main claims",
      "Objections",
    ]);
    expect(key.changeWith).toBe("partials/color-meanings-argument");
  });

  it("gives every Profile that sets color meanings a key of nine colors", () => {
    const keyed = directory.entries.filter(
      ({ kind, colorKey }) => kind === "profile" && colorKey !== null,
    );
    expect(keyed.map(({ id }) => id).toSorted()).toEqual([
      "profiles/book-chapters",
      "profiles/books",
      "profiles/color-coded-reading-note",
      "profiles/critical-reading",
      "profiles/literature-review",
      "profiles/reading-notes-by-color",
      "profiles/theses-and-dissertations",
    ]);
    for (const { colorKey } of keyed) {
      expect(colorKey!.rows.filter(({ color }) => color !== null)).toHaveLength(
        9,
      );
    }
  });

  it("gives no key to a Profile with plain quotes", () => {
    expect(keyOf("course-reading")).toBeNull();
    expect(keyOf("simple-reading-note")).toBeNull();
    expect(keyOf("primary-sources-and-archives")).toBeNull();
  });

  describe("from a highlight's rendered callout", () => {
    const keyWith = (format: string) => {
      const files = edit(fixtureFiles(), `${FIXTURE_PROFILE}/entry.md`, [
        "tasks: [general-reading]\n",
        "tasks: [general-reading]\nfeatures: [color-highlights]\n",
      ]);
      edit(files, `${FIXTURE_PROFILE}/zotlit-profile.fixture-profile.md`, [
        '--- zotlit:annotation ---\n{% render "fixture-quote" with zt as zt %}\n',
        `--- zotlit:annotation ---\n${format}\n{% render "fixture-quote" with zt as zt %}\n`,
      ]);
      return directorySite(verifyTemplateDirectory(files)).entries.find(
        ({ id }) => id === FIXTURE_PROFILE,
      )!.colorKey;
    };

    it("shows the callout's title, without its page, whatever the callout type", () => {
      const key = keyWith(
        "> [!note] {{ zt.colorName | default: 'other' | capitalize }} reading · p. {{ zt.pageLabel }}",
      )!;
      expect(key.rows[0]).toMatchObject({
        color: "yellow",
        meaning: "Yellow reading",
      });
      expect(key.changeWith).toBeNull();
    });

    it("shows no key when every color gets the same callout title", () => {
      expect(keyWith("> [!note] Highlight · p. {{ zt.pageLabel }}")).toBeNull();
    });

    it("keeps a title that holds a dot, and a callout that folds", () => {
      const key = keyWith(
        "> [!note]- {{ zt.colorName | default: 'other' }} · notes · p. {{ zt.pageLabel }}",
      )!;
      expect(key.rows[0]).toMatchObject({
        color: "yellow",
        meaning: "yellow · notes",
      });
    });

    it("leaves out the row for other colors when their callout has no title", () => {
      const key = keyWith(
        "> [!note] {% if zt.colorName %}{{ zt.colorName }}{% endif %} · p. {{ zt.pageLabel }}",
      )!;
      expect(key.rows).toHaveLength(9);
      expect(key.rows.at(-1)).toMatchObject({ color: "plum" });
    });

    it("gives no key when a highlight is not a titled callout", () => {
      expect(keyWith("> [!quote]\n> {{ zt.text }}")).toBeNull();
    });
  });
});
