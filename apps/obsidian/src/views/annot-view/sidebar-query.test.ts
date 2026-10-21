import { describe, expect, it } from "vitest";

import { parseQueryFile } from "@/views/query-view/query-file";

import { savedQueryFileText } from "./sidebar-query";

/** A sidebar that sorts by date added, groups by colour, and has one full filter. */
const SIDEBAR = `filters: attachment == this.attachment
views:
  - type: annotations
    name: Zotero annotations
    from: annotations
    filters:
      and:
        - comment != null
    sort:
      - property: dateAdded
        direction: DESC
    groupBy:
      property: colorName
      direction: ASC
`;

const NO_FILTER = { query: "", colors: [], tags: [] };

function saved(
  input: Partial<Parameters<typeof savedQueryFileText>[0]> = {},
): string {
  const file = parseQueryFile(SIDEBAR);
  return savedQueryFileText({
    file,
    view: file.views[0]!,
    filter: NO_FILTER,
    records: "this-item",
    itemKey: "RUGIER24",
    attachmentKey: "RGRPDF24",
    ...input,
  });
}

describe("savedQueryFileText", () => {
  it("saves 'This item only' as a filter on the followed Attachment, with the sort, grouping and full filter", () => {
    expect(saved()).toBe(`filters: attachment.indexedKey == "RGRPDF24"
views:
  - type: annotations
    name: Zotero annotations
    from: annotations
    filters:
      and:
        - comment != null
    sort:
      - property: dateAdded
        direction: DESC
    groupBy:
      property: colorName
      direction: ASC
`);
  });

  it("saves 'This item only' as a filter on the Item when no Attachment is followed", () => {
    expect(saved({ attachmentKey: null })).toMatch(
      /^filters: item\.indexedKey == "RUGIER24"$/m,
    );
  });

  it("saves 'The item of the note that shows it' as item == this.item", () => {
    expect(saved({ records: "note-item" })).toMatch(
      /^filters: item == this\.item$/m,
    );
  });

  it("adds the colour, tag and search filters to the view's own filters", () => {
    const text = saved({
      filter: {
        query: 'Fig "2"',
        colors: ["#FFD400", "#2EA8E5"],
        tags: ["figure", "method"],
      },
    });
    expect(parseQueryFile(text).views[0]!.filters).toEqual({
      and: [
        "comment != null",
        { or: ['colorName == "yellow"', 'colorName == "blue"'] },
        'tags.containsAny("figure", "method")',
        'text.replace(/<[^>]*>/g, "").lower().contains("fig \\"2\\"") || comment.replace(/<[^>]*>/g, "").lower().contains("fig \\"2\\"") || !tags.filter(value.lower().contains("fig \\"2\\"")).isEmpty() || pageLabel.lower().contains("fig \\"2\\"")',
      ],
    });
  });

  it("saves one colour as one condition, and a colour without one name by its hex code", () => {
    expect(saved({ filter: { ...NO_FILTER, colors: ["#FFD400"] } })).toContain(
      `        - colorName == "yellow"\n`,
    );
    // Two hex codes are orange, and this one has no name at all.
    expect(saved({ filter: { ...NO_FILTER, colors: ["#F19837"] } })).toContain(
      `        - color.lower() == "#f19837"\n`,
    );
    expect(saved({ filter: { ...NO_FILTER, colors: ["#123456"] } })).toContain(
      `        - color.lower() == "#123456"\n`,
    );
  });

  it("gives a view with no filters of its own the colour filter alone", () => {
    const file = parseQueryFile(
      "filters: attachment == this.attachment\nviews:\n  - type: annotations\n    name: Zotero annotations\n    from: annotations\n",
    );
    expect(
      savedQueryFileText({
        file,
        view: file.views[0]!,
        filter: { ...NO_FILTER, colors: ["#FF6666"] },
        records: "note-item",
        itemKey: "RUGIER24",
        attachmentKey: "RGRPDF24",
      }),
    ).toBe(`filters: item == this.item
views:
  - type: annotations
    name: Zotero annotations
    from: annotations
    filters: colorName == "red"
`);
  });
});
