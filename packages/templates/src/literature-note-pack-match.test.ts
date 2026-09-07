import { expect, it } from "vitest";

import {
  exportLiteratureNotePack,
  updateLiteratureNotePackMetadata,
} from "./literature-note-pack";

const prefix = `---\r
# Keep the authored header\r
id: example.books\r
name: 'Books'\r
version: 1.0.0\r
contract: 2\r
filename: '{{ zt.title }}'\r
`;
const match = `match:\r
  and: [ 'collections.within("Foreign/Books")', 'tags.contains("Reading")' ]\r
`;
const suffix = `---\r
{% managed %}Body{% endmanaged %}\n--- zotlit:annotation ---\r
Annotation`;

it.each([true, false, undefined])(
  "exports a partial-free match document with includeMatch=%s",
  (includeMatch) => {
    expect(
      exportLiteratureNotePack(prefix + match + suffix, [], { includeMatch }),
    ).toBe(prefix + (includeMatch === false ? "" : match) + suffix);
  },
);

it.each([true, false])(
  "bundles a partial and strips folders while preserving match choice %s",
  (includeMatch) => {
    const source = `${prefix}folder: Books\r\nimportFolder: Imported\r\n${
      match
    }${suffix.replace("Body", '{% render "summary" %}')}`;
    const output = exportLiteratureNotePack(
      source,
      [
        {
          name: "summary",
          language: "liquid",
          source: "Shared summary",
        },
      ],
      { includeMatch },
    );
    const expected = `${
      prefix + (includeMatch ? match : "")
    }partials: [{"name":"summary","language":"liquid","source":"Shared summary"}]\r\n${suffix.replace(
      "Body",
      '{% render "summary" %}',
    )}`;
    expect(output).toBe(expected);
    expect(exportLiteratureNotePack(output, [], { includeMatch })).toBe(
      expected,
    );
  },
);

it("retains the incoming layout of already bundled partials", () => {
  const source = `${prefix + match}partials:\r
  - name: summary # The sender's partial\r
    language: liquid\r
    source: Shared summary\r
${suffix.replace("Body", '{% render "summary" %}')}`;
  expect(exportLiteratureNotePack(source, [], { includeMatch: true })).toBe(
    source,
  );
});

it("keeps an absent match byte-identical and retains an empty match", () => {
  expect(
    exportLiteratureNotePack(prefix + suffix, [], { includeMatch: false }),
  ).toBe(prefix + suffix);
  expect(
    exportLiteratureNotePack(`${prefix}match: {and: []}\r\n${suffix}`, []),
  ).toBe(`${prefix}match: {and: []}\r\n${suffix}`);
});

it("changes Share metadata in a flow header without rewriting the match", () => {
  const source = `---\r
{ id: example.books, name: Books, version: 1.0.0, contract: 2, filename: '{{ zt.title }}', match: 'tags.contains("Reading")' }\r
---\r
{% managed %}Body{% endmanaged %}\n--- zotlit:annotation ---\r
Annotation`;
  expect(updateLiteratureNotePackMetadata(source, { version: "2.0.0" })).toBe(
    source.replace("version: 1.0.0", 'version: "2.0.0"'),
  );
});

it("refuses metadata changes that would alter an aliased match", () => {
  const source = `${prefix}author: &condition 'tags.contains("Reading")'\r\nmatch: *condition\r\n${suffix}`;
  expect(() =>
    updateLiteratureNotePackMetadata(source, { author: "Another author" }),
  ).toThrow("These metadata changes would also change the match conditions.");
});

it.each([true, false])(
  "removes both aliased folder bindings before validation with includeMatch=%s",
  (includeMatch) => {
    const source = `${prefix}folder: &notes Books\r\nimportFolder: *notes\r\n${match}${suffix}`;
    expect(exportLiteratureNotePack(source, [], { includeMatch })).toBe(
      prefix + (includeMatch ? match : "") + suffix,
    );
  },
);

it("still refuses aliases left unresolved after the complete metadata edit", () => {
  const source = `${prefix}folder: &notes Books\r\nimportFolder: *notes\r\ndescription: *notes\r\n${match}${suffix}`;
  expect(() => exportLiteratureNotePack(source, [])).toThrow(
    "Unresolved alias",
  );
});

it("validates Match omission and its removed folder aliases as one document edit", () => {
  const source = `${prefix}match: &condition "true"\r\nfolder: *condition\r\nimportFolder: *condition\r\n${suffix}`;
  expect(exportLiteratureNotePack(source, [], { includeMatch: false })).toBe(
    prefix + suffix,
  );
});
