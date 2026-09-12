import { describe, expect, it } from "vitest";

import {
  explorerSectionIds,
  explorerSections,
  fieldLabel,
  sentenceCase,
  visibleSectionIds,
} from "./explorer-sections";
import type { TemplateRoot } from "./store";
import { m } from "./test-messages";

import { buildDisplayTree } from "#/explorer/index";

const nodesOf = (data: Record<string, unknown>) =>
  buildDisplayTree(data, { expanded: new Set() });
const reader = (root: TemplateRoot, locale = "en") => ({
  m,
  root,
  locale,
});

describe("explorerSections", () => {
  it("leads with the common fields and gives every other field one home", () => {
    const sections = explorerSections(
      nodesOf({
        DOI: "10.1/x",
        title: "A paper",
        dateAdded: "2025-02-13",
        tags: [],
        volume: "2",
        weblink: null,
      }),
      reader("note"),
    );
    expect(
      sections.map((section) => [
        section.id,
        section.rows.map((row) => row.node.key),
      ]),
    ).toEqual([
      ["common", ["title", "tags"]],
      ["reference", ["volume"]],
      ["identifiers", ["DOI"]],
      ["links", ["weblink"]],
      ["record", ["dateAdded"]],
    ]);
  });

  it("names rows in the reader's words and keeps Zotero's words for its fields", () => {
    const sections = explorerSections(
      nodesOf({ title: "A paper", shortTitle: "Paper", weblink: null }),
      reader("note"),
    );
    const labels = new Map(
      sections.flatMap((section) =>
        section.rows.map((row) => [row.node.key, row.label]),
      ),
    );
    expect(labels.get("title")).toBe(m.workbench_field_title());
    expect(labels.get("shortTitle")).toBe("Short title");
    expect(labels.get("weblink")).toBe(m.workbench_field_weblink());
  });

  it("places a field the taxonomy does not name in the first section, after the named ones", () => {
    const sections = explorerSections(
      nodesOf({ numPages: "12", volume: "2", title: "A paper" }),
      reader("note"),
    );
    expect(sections[1]?.rows.map((row) => row.node.key)).toEqual([
      "volume",
      "numPages",
    ]);
    expect(sections[1]?.rows[1]?.label).toBe("# of pages");
  });

  it("shows each alias pair once, under the common name", () => {
    const sections = explorerSections(
      nodesOf({
        abstract: "Text",
        abstractNote: "Text",
        publicationTitle: "PLoS Medicine",
        containerTitle: "PLoS Medicine",
      }),
      reader("note"),
    );
    expect(
      sections.flatMap((section) =>
        section.rows.map((row) => [row.node.key, row.label]),
      ),
    ).toEqual([
      ["abstract", m.workbench_field_abstract()],
      ["publicationTitle", m.workbench_field_publication_title()],
    ]);
  });

  it("names the note-name root's abstract in Zotero's words", () => {
    const sections = explorerSections(
      nodesOf({ abstract: "Text", abstractNote: "Text" }),
      reader("filename"),
    );
    expect(sections.flatMap((s) => s.rows.map((r) => r.label))).toEqual([
      "Abstract",
    ]);
  });

  it("hides the note-name stubs that are empty for every item", () => {
    const sections = explorerSections(
      nodesOf({ title: "A paper", notePath: "", noteLink: () => "" }),
      reader("filename"),
    );
    expect(
      sections.flatMap((section) => section.rows.map((row) => row.node.key)),
    ).toEqual(["title"]);
  });

  it("groups an annotation by what it says, where it comes from, and its record", () => {
    const sections = explorerSections(
      nodesOf({
        text: "Read this",
        parentItem: {},
        colorHex: "#ffd400",
        isExternal: false,
      }),
      reader("annotation"),
    );
    expect(sections.map((section) => section.id)).toEqual([
      "common",
      "annotation",
      "record",
    ]);
    expect(sections[1]?.rows[0]?.label).toBe(m.workbench_field_color_hex());
  });

  it("gives the citation root one Common section over its three fields", () => {
    const citation = {
      item: { citationKey: "smith2020" },
      locator: "12-14",
      label: "page",
      labelShort: "p.",
      suppressAuthor: false,
      prefix: null,
      suffix: null,
    };
    const sections = explorerSections(
      nodesOf({
        variant: "main",
        items: [citation.item],
        citations: [citation],
      }),
      reader("citation"),
    );
    // A Citation Item's own properties and a cited item's fields sit under
    // `citations` and `items`; the taxonomy names top-level fields, so the
    // reader reaches both by expanding those two rows.
    expect(
      sections.map((section) => [
        section.id,
        section.rows.map((row) => row.node.key),
      ]),
    ).toEqual([["common", ["variant", "citations", "items"]]]);
  });

  it("tells a host which sections this data shows", () => {
    expect(
      visibleSectionIds({ title: "A paper", DOI: "x" }, reader("note")),
    ).toEqual(["common", "identifiers"]);
    expect(visibleSectionIds(null, reader("note"))).toEqual([]);
  });

  it("lists every section a root can show, common first", () => {
    expect(explorerSectionIds("filename")).toEqual([
      "common",
      "reference",
      "identifiers",
      "content",
      "organization",
      "links",
      "record",
    ]);
  });
});

describe("fieldLabel", () => {
  it("reads Zotero's label in the reader's locale and falls back to the key", () => {
    expect(fieldLabel("dateAdded", reader("note", "zh-CN"))).toBe("添加日期");
    expect(fieldLabel("dateAdded", reader("note"))).toBe("Date added");
    expect(fieldLabel("dateAdded", reader("note", "fr"))).toBe("Date added");
    expect(fieldLabel("mystery", reader("note"))).toBe("mystery");
  });
});

describe("sentenceCase", () => {
  it("lowers later words and keeps initialisms", () => {
    expect(sentenceCase("Date Added")).toBe("Date added");
    expect(sentenceCase("Library Catalog")).toBe("Library catalog");
    expect(sentenceCase("DOI")).toBe("DOI");
    expect(sentenceCase("URL")).toBe("URL");
    expect(sentenceCase("# of Pages")).toBe("# of pages");
  });
});
