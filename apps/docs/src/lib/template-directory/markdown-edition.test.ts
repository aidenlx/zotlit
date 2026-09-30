import { describe, expect, it } from "vitest";

import { m } from "@/paraglide/messages.js";

import { directoryEdition, directoryLlmsIndex } from "./markdown-edition";
import { directorySite } from "./site-data";
import {
  edit,
  FIXTURE_PROPERTY,
  FIXTURE_PROPERTY_FILE,
  fixtureFiles,
  PROFILE_SOURCE,
} from "./test-fixtures";
import { verifyTemplateDirectory } from "./verify";

const site = (files = fixtureFiles()) =>
  directorySite(verifyTemplateDirectory(files));

describe("an entry's edition", () => {
  it("gives a Profile's facets, who it is for, its description, the one-click import with the manual path, its partials, the file, and what it makes", async () => {
    const edition = (await directoryEdition(site(), [
      "profiles",
      "fixture-profile",
    ]))!;

    expect(edition).toMatch(
      /^# Fixture profile \(\/templates\/profiles\/fixture-profile\)\n\n> A Profile the verification tests break one rule at a time\.\n\n/,
    );
    expect(edition).toContain(`- ${m.docs_directory_facet_kind()}: Profile
- ${m.docs_directory_facet_level()}: ${m.docs_directory_level_ready()}
- ${m.docs_directory_tasks()}: General reading
- ${m.docs_directory_item_types()}: ${m.docs_directory_any_item_type()}
- ${m.docs_directory_problems()}:
  - I want a fixture.
- ${m.docs_directory_requires({ version: "2.2.0-beta.0" })}
`);
    expect(edition).toContain(`

**${m.docs_directory_audience()}:** Tests.

**${m.docs_directory_effort()}:** Nothing.

A fixture Profile.
`);
    expect(edition).toContain(`## ${m.docs_directory_use_heading()}

1. Select **${m.docs_directory_import()}**.`);
    expect(edition).toContain(
      `   - Select **${m.docs_directory_copy_profile()}**, or download the file.
   - In Obsidian, run \`ZotLit: ${m.command_import_profile_name()}\` and select **${m.profile_import_clipboard()}**, or **${m.profile_import_file()}** for the downloaded file.
2. `,
    );
    expect(edition).toContain(
      "3. Create a literature note and choose **Fixture profile** as its profile.",
    );
    expect(edition).toContain(`## ${m.docs_directory_calls_heading()}

${m.docs_directory_calls_profile()}

- [Fixture heading](/templates/partials/fixture-heading.md): The title as a heading.
- [Fixture quote](/templates/partials/fixture-quote.md): The text as a quote.
`);
    expect(edition).toContain(`## ${m.docs_directory_file_heading()}

\`zotlit-profile.fixture-profile.md\`

\`\`\`markdown
${PROFILE_SOURCE}\`\`\`
`);
    expect(edition).toContain(`## ${m.docs_directory_samples_heading()}

${m.docs_directory_samples_intro()}

### Journal article

${m.docs_directory_sample_note_name()}: \`ioannidisWhyMost2005\`
`);
  });
});

describe("the labels of an edition's samples", () => {
  const RECIPE = `minAppVersion: "2.2.0-beta.0"
tasks: [writing]
problems:
  - I want a fixture.
audience: Tests.
effort: Nothing.`;
  /** The fixture Directory with a note name and a citation text, which it does not hold. */
  const withNameAndCitation = () =>
    fixtureFiles()
      .set(
        "note-names/fixture-citekey/entry.md",
        `---\ntitle: Fixture citekey\nsummary: The citation key as the note name.\n${RECIPE}\n---\n\nA fixture note name.\n`,
      )
      .set(
        "note-names/fixture-citekey/note-name.liquid",
        "{{ zt.citekey | default: zt.key }}{% suffix %}",
      )
      .set(
        "citations/fixture-citekey/entry.md",
        `---\ntitle: Fixture citation\nsummary: The citation key in brackets.\n${RECIPE}\n---\n\nA fixture citation text.\n`,
      )
      .set(
        "citations/fixture-citekey/zotlit-citation.md",
        "---\nlanguage: liquid\n---\n[{% for cite in zt.citations %}@{{ cite.item.citekey }}{% endfor %}]",
      );

  it("heads a Profile's annotations from the site's messages", async () => {
    const edition = (await directoryEdition(site(), [
      "profiles",
      "fixture-profile",
    ]))!;

    expect(edition).toContain(
      `### ${m.docs_directory_samples_annotations()}\n\n#### `,
    );
  });

  it("heads the note-name table from the site's messages", async () => {
    const edition = (await directoryEdition(site(withNameAndCitation()), [
      "note-names",
      "fixture-citekey",
    ]))!;

    expect(edition).toContain(
      `| ${m.docs_directory_samples_item()} | ${m.docs_directory_sample_note_name()} |\n| --- | --- |\n`,
    );
  });

  it("heads the citation table from the site's messages", async () => {
    const edition = (await directoryEdition(site(withNameAndCitation()), [
      "citations",
      "fixture-citekey",
    ]))!;

    expect(edition).toContain(
      `| ${m.docs_directory_citation_cited()} | ${m.docs_directory_citation_main()} | ${m.docs_directory_citation_alt()} |\n| --- | --- | --- |\n`,
    );
  });
});

describe("a property entry's edition", () => {
  it("gives the values to enter as a table of their own, and the downloaded file", async () => {
    const edition = (await directoryEdition(site(), [
      "properties",
      "fixture-year",
    ]))!;

    expect(edition)
      .toContain(`2. Select **${m.workbench_properties_add()}**, then enter these values:

   | ${m.docs_directory_input()} | ${m.docs_directory_value()} |
   | --- | --- |
   | **${m.workbench_properties_name()}** | \`year\` |
`);
    expect(edition).toContain(`## ${m.docs_directory_file_heading()}

\`zotlit-property.fixture-year.yaml\`

\`\`\`yaml
key: year
`);
  });

  it("marks a sample the rule leaves the property out of, the way the page does", async () => {
    const files = edit(fixtureFiles(), FIXTURE_PROPERTY_FILE, [
      'value: {"$if": "zt.date && zt.date.year", "then": {"$eval": "zt.date.year"}}',
      'value: {"$if": "false", "then": "never"}',
    ]);
    const edition = (await directoryEdition(site(files), [
      "properties",
      "fixture-year",
    ]))!;

    expect(edition).toContain(`### Journal article

_${m.docs_directory_sample_left_out()}_
`);
    expect(edition).not.toContain("_No output._");
  });
});

describe("the Directory in llms.txt", () => {
  it("lists every entry under its level, linked to its page, the way the docs tree lists a folder", () => {
    expect(directoryLlmsIndex(site()))
      .toBe(`- [${m.docs_directory_title()}](/templates): ${m.docs_directory_description()}
  - Start here: ready-made notes: ${m.docs_directory_group_ready_description()}
    - [Fixture profile](/templates/profiles/fixture-profile): A Profile the verification tests break one rule at a time.
  - Change one part of your notes: ${m.docs_directory_group_customize_description()}
    - [Fixture heading](/templates/partials/fixture-heading): The title as a heading.
    - [Fixture quote](/templates/partials/fixture-quote): The text as a quote.
    - [Fixture year](/templates/properties/fixture-year): The year.`);
  });
});

describe("the Directory index edition", () => {
  it("lists every entry under its level, linked to its own edition, with the facets a reader searches by", async () => {
    const index = await directoryEdition(site(), []);

    expect(index).toContain(`## Start here: ready-made notes

${m.docs_directory_group_ready_description()}

- [Fixture profile](/templates/profiles/fixture-profile.md): A Profile the verification tests break one rule at a time.
  - ${m.docs_directory_facet_kind()}: Profile
  - ${m.docs_directory_tasks()}: General reading
  - ${m.docs_directory_item_types()}: ${m.docs_directory_any_item_type()}
  - ${m.docs_directory_problems()}:
    - I want a fixture.
`);
    expect(index).toContain(`## Change one part of your notes

${m.docs_directory_group_customize_description()}

- [Fixture heading](/templates/partials/fixture-heading.md): The title as a heading.
  - ${m.docs_directory_facet_kind()}: Partial
`);
    expect(index).toContain(
      "- [Fixture year](/templates/properties/fixture-year.md): The year.\n",
    );
  });

  it("names every value of an entry's facets, and its search words", async () => {
    const files = edit(fixtureFiles(), `${FIXTURE_PROPERTY}/entry.md`, [
      "tasks: [general-reading]",
      "tasks: [general-reading, literature-review]\nitemTypes: [book, thesis]\nfeatures: [properties, source-links]\nkeywords: [pub date, published]",
    ]);
    const index = await directoryEdition(site(files), []);

    expect(index)
      .toContain(`- [Fixture year](/templates/properties/fixture-year.md): The year.
  - ${m.docs_directory_facet_kind()}: Property
  - ${m.docs_directory_tasks()}: General reading; Literature review
  - ${m.docs_directory_item_types()}: Book; Thesis
  - ${m.docs_directory_features()}: Properties for Bases; Links to Zotero, the PDF, the DOI, and the web page
  - ${m.docs_directory_keywords()}: pub date; published
`);
  });

  it("names the recommended starting points first", async () => {
    const files = edit(fixtureFiles(), `${FIXTURE_PROPERTY}/entry.md`, [
      "tasks: [general-reading]",
      "tasks: [general-reading]\nrecommended: true",
    ]);
    const index = await directoryEdition(site(files), []);

    expect(index).toContain(`## ${m.docs_directory_recommended()}

- [Fixture year](/templates/properties/fixture-year.md): The year.

## Start here: ready-made notes`);
  });

  it("presents the two paths in order, under the headings the page uses", async () => {
    const index = (await directoryEdition(site(), [])) ?? "";

    expect(index.match(/^## .*$/gm)).toEqual([
      "## Start here: ready-made notes",
      "## Change one part of your notes",
    ]);
  });
});
