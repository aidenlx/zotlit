import { describe, expect, it } from "vitest";

import { updateLiteratureNoteTemplateMatch } from "./literature-note-template-match";

const prefix = '---\n# Keep this\nname :  Books  # spacing\nversion: "1.0.0"\n';
const suffix =
  "# Next field comment\nid: Bk3Qn7XvT2Lp\ncontract: 2\nfilename: '{{ zt.title }}'\n---\n# Body  \n\n{% managed %}Body{% endmanaged %}\n--- zotlit:annotation ---\nAnnotation";
const fixtures = [
  {
    name: "quoted key and inline comment",
    match: '"match"  :  \'tags.contains("Foreign tag")\'   # own note\n',
    saved: '"match"  :  {"and":[]}   # own note\n',
  },
  {
    name: "block tree",
    match:
      "match:\n  or:\n    - 'library == \"group:999999\"'\n    - 'collections.within(\"Foreign/Books\")'\n",
    saved: 'match:\n  {"and":[]}\n',
  },
  {
    name: "flow tree",
    match: "match : {and: ['tags.contains(\"Foreign tag\")']}\n",
    saved: 'match : {"and":[]}\n',
  },
  {
    name: "folded leaf",
    match:
      'match: >-\n  library == "personal" &&\n  tags.contains("Foreign tag")\n',
    saved: 'match: {"and":[]}\n',
  },
  {
    name: "explicit key",
    match: '? "match"\n: \'tags.contains("Foreign tag")\'\n',
    saved: '? "match"\n: {"and":[]}\n',
  },
  {
    name: "split explicit key",
    match: "?\n  match\n: 'true'\n",
    saved: '?\n  match\n: {"and":[]}\n',
  },
];

describe("updateLiteratureNoteTemplateMatch", () => {
  describe.each(["\n", "\r\n"])("with %j header line endings", (eol) => {
    it.each(fixtures)(
      "saves and removes $name without changing other bytes",
      ({ match, saved }) => {
        const source = (prefix + match + suffix).replaceAll("\n", eol);
        expect(updateLiteratureNoteTemplateMatch(source, { and: [] })).toBe(
          (prefix + saved + suffix).replaceAll("\n", eol),
        );
        expect(updateLiteratureNoteTemplateMatch(source, undefined)).toBe(
          (prefix + suffix).replaceAll("\n", eol),
        );
      },
    );
  });

  it("appends an absent match, preserving mixed body line endings and no final newline", () => {
    const source = (prefix + suffix)
      .replaceAll("\n", "\r\n")
      .replace("# Body  \r\n\r\n", "# Body  \n\r\n");
    const expected = source.replace(
      "---\r\n# Body",
      'match: {"or":[]}\r\n---\r\n# Body',
    );
    expect(updateLiteratureNoteTemplateMatch(source, { or: [] })).toBe(
      expected,
    );
    expect(updateLiteratureNoteTemplateMatch(source, undefined)).toBe(source);
  });

  const flowBase =
    "id: Bk3Qn7XvT2Lp, name : Books, version: \"1.0.0\", contract: 2, filename: '{{ zt.title }}'";
  const body = "\n---\nBody\n--- zotlit:annotation ---\nAnnotation";
  it.each(["\n", "\r\n"])(
    "keeps root indentation when adding a match with %j line endings",
    (eol) => {
      const header = `---
  # Keep this indentation
  name: Books
  id: Bk3Qn7XvT2Lp
  version: "1.0.0"
  contract: 2
  filename: '{{ zt.title }}'`;
      const source = (header + body).replaceAll("\n", eol);
      expect(updateLiteratureNoteTemplateMatch(source, { and: [] })).toBe(
        `${header}\n  match: {"and":[]}${body}`.replaceAll("\n", eol),
      );
    },
  );
  it.each([
    [`{ match: {and: []}, ${flowBase} } # end`, `{  ${flowBase} } # end`],
    [`{ ${flowBase}, match: {and: []} } # end`, `{ ${flowBase}  } # end`],
    [
      `{ id: Bk3Qn7XvT2Lp, match: {and: []}, name : Books, version: "1.0.0", contract: 2, filename: 'Title' }`,
      `{ id: Bk3Qn7XvT2Lp , name : Books, version: "1.0.0", contract: 2, filename: 'Title' }`,
    ],
  ])("removes one root flow pair: %s", (header, removed) => {
    expect(
      updateLiteratureNoteTemplateMatch(`---\n${header}${body}`, undefined),
    ).toBe(`---\n${removed}${body}`);
  });
  it("inserts a root flow pair and preserves its surrounding bytes", () => {
    const source = `---\n{ ${flowBase} } # end${body}`;
    expect(
      updateLiteratureNoteTemplateMatch(source, 'tags.contains("Read")'),
    ).toBe(
      `---\n{ ${flowBase} , match: "tags.contains(\\"Read\\")"} # end${body}`,
    );
  });
  it("inserts after a root flow trailing comma", () => {
    const source = `---\n{ ${flowBase}, } # end${body}`;
    expect(updateLiteratureNoteTemplateMatch(source, { and: [] })).toBe(
      `---\n{ ${flowBase}, match: {"and":[]}} # end${body}`,
    );
  });
  it("replaces one root flow value", () => {
    const source = `---\n{ match: 'true', ${flowBase} } # end${body}`;
    expect(updateLiteratureNoteTemplateMatch(source, { or: [] })).toBe(
      `---\n{ match: {"or":[]}, ${flowBase} } # end${body}`,
    );
  });
  it("refuses to orphan an alias outside the removed match", () => {
    const source = `${prefix}match: &condition 'true'\ndescription: *condition\n${suffix}`;
    expect(() =>
      updateLiteratureNoteTemplateMatch(source, undefined),
    ).toThrow();
  });
  it("refuses to put a match on Default", () => {
    const source = (prefix + suffix).replace("id: Bk3Qn7XvT2Lp", "id: default");
    expect(() =>
      updateLiteratureNoteTemplateMatch(source, { and: [] }),
    ).toThrow();
  });
});
