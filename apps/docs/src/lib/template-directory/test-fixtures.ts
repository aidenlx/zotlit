// A small Template Directory that passes every check, for tests that break one rule at a time.

export const FIXTURE_PROFILE = "profiles/fixture-profile";
export const FIXTURE_PROFILE_FILE = `${FIXTURE_PROFILE}/zotlit-profile.fixture-profile.md`;
export const FIXTURE_HEADING = "partials/fixture-heading";
export const FIXTURE_HEADING_FILE = `${FIXTURE_HEADING}/zotlit-partial.fixture-heading.md`;
export const FIXTURE_QUOTE = "partials/fixture-quote";
export const FIXTURE_QUOTE_FILE = `${FIXTURE_QUOTE}/zotlit-partial.fixture-quote.md`;
export const FIXTURE_PROPERTY = "properties/fixture-year";
export const FIXTURE_PROPERTY_FILE = `${FIXTURE_PROPERTY}/property.yaml`;

const FACETS = `tasks: [general-reading]
problems:
  - I want a fixture.
audience: Tests.
effort: Nothing.`;

const RECIPE = `${FACETS}
minAppVersion: "2.2.0-beta.0"`;

/** The heading partial's source, as its entry and the Profile's packed copy hold it. */
export const HEADING_SOURCE = "## {{ zt.title }}\n";

export const PROFILE_SOURCE = `---
id: FixtureProf1
name: Fixture profile
version: "1.0.0"
author: ZotLit
description: A Profile the verification tests break one rule at a time.
contract: 3
minAppVersion: "2.2.0-beta.0"
sampleItemType: journalArticle
filename: '{{ zt.citekey | default: zt.key }}{% suffix %}'
frontmatter:
  - key: title
    value: {"$eval": "zt.title"}
    merge: replace
partials:
  - name: fixture-heading
    language: liquid
    source: |
      ## {{ zt.title }}
  - name: fixture-quote
    language: liquid
    source: |
      > {{ zt.text }}
---
{% managed %}
{% render "fixture-heading" with zt as zt %}
{% endmanaged %}

## My notes

--- zotlit:annotation ---
{% render "fixture-quote" with zt as zt %}
`;

/** A fresh copy of the fixture Directory, which a test may edit. */
export function fixtureFiles(): Map<string, string> {
  return new Map([
    ["README.md", "# Fixture guide\n"],
    [
      `${FIXTURE_PROFILE}/entry.md`,
      `---\n${FACETS}\n---\n\nA fixture Profile.\n`,
    ],
    [FIXTURE_PROFILE_FILE, PROFILE_SOURCE],
    [
      `${FIXTURE_HEADING}/entry.md`,
      `---\ntitle: Fixture heading\nsummary: The title as a heading.\ncontext: note\n${RECIPE}\n---\n\nA fixture partial.\n`,
    ],
    [FIXTURE_HEADING_FILE, `---\nlanguage: liquid\n---\n${HEADING_SOURCE}`],
    [
      `${FIXTURE_QUOTE}/entry.md`,
      `---\ntitle: Fixture quote\nsummary: The text as a quote.\ncontext: annotation\n${RECIPE}\n---\n\nA fixture partial.\n`,
    ],
    [FIXTURE_QUOTE_FILE, "---\nlanguage: liquid\n---\n> {{ zt.text }}\n"],
    [
      `${FIXTURE_PROPERTY}/entry.md`,
      `---\ntitle: Fixture year\nsummary: The year.\n${RECIPE}\nexpected:\n  journal-article: { year: 2005 }\n  letter: { year: 1887 }\n---\n\nA fixture property.\n`,
    ],
    [
      FIXTURE_PROPERTY_FILE,
      'key: year\nvalue: {"$if": "zt.date && zt.date.year", "then": {"$eval": "zt.date.year"}}\nmerge: replace\n',
    ],
  ]);
}

/**
 * Replace text in one fixture file, failing loudly when the text is not
 * there, so a test never passes on an edit that did not happen.
 */
export function edit(
  files: Map<string, string>,
  path: string,
  [from, to]: readonly [from: string, to: string],
): Map<string, string> {
  const content = files.get(path);
  if (content === undefined || !content.includes(from)) {
    throw new Error(`${path} does not contain ${JSON.stringify(from)}`);
  }
  files.set(path, content.replace(from, to));
  return files;
}
