import { describe, expect, it } from "vitest";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";
import { buildDisplayTree, renderSnippet } from "@zotlit/workbench/explorer";
import type { DisplayNode } from "@zotlit/workbench/explorer";
import { DEFAULT_PROFILE_SOURCE, SAMPLE_ITEMS } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

import {
  commonRows,
  insertRange,
  insertSnippet,
  rootData,
  rowMatches,
  templateRootAt,
} from "./fields";
import type { SampleItem, TemplateRoot } from "./fields";

const controller = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
const profile = controller.document!;
const source = controller.source;
const filename = controller.filenameSlice;

const [journalArticle, conferencePaper, book] = SAMPLE_ITEMS as readonly [
  SampleItem,
  SampleItem,
  SampleItem,
];

function rowsOf(snapshot: SampleItem, root: TemplateRoot) {
  const data = rootData(snapshot, root)!;
  return commonRows(root, buildDisplayTree(data, { expanded: new Set() }));
}

function nodeFor(root: TemplateRoot, label: string): DisplayNode {
  return rowsOf(journalArticle, root).find((row) => row.label === label)!.node;
}

describe("templateRootAt", () => {
  it("reads the note body as the note root", () => {
    const offset = source.indexOf("# {{ zt.title }}");
    expect(templateRootAt(profile, filename, offset)).toBe("note");
  });

  it("reads the Annotation Section as the annotation root", () => {
    const offset = source.indexOf("[!note] Page");
    // The note pane stops at the section header, so this is a caret only the
    // Advanced editor can put there — and it still switches the root.
    expect(offset).toBeGreaterThan(controller.sliceRange("note").to);
    expect(templateRootAt(profile, filename, offset)).toBe("annotation");
  });

  it("reads the manifest's filename value as the filename root", () => {
    const offset = source.indexOf("zt.citationKey | default");
    expect(templateRootAt(profile, filename, offset)).toBe("filename");
  });

  it("reads the rest of the manifest as the note root", () => {
    const offset = source.indexOf("frontmatter:");
    expect(templateRootAt(profile, filename, offset)).toBe("note");
  });

  it("reads a draft that does not parse as the note root", () => {
    expect(templateRootAt(null, null, 0)).toBe("note");
  });
});

describe("commonRows", () => {
  it("leads the note root with eleven rows in a fixed order", () => {
    expect(rowsOf(journalArticle, "note").map((row) => row.label)).toEqual([
      m.workbench_field_title(),
      m.workbench_field_authors(),
      m.workbench_field_date(),
      m.workbench_field_abstract(),
      m.workbench_field_publication_title(),
      m.workbench_field_citation_key(),
      m.workbench_field_tags(),
      m.workbench_field_collections(),
      m.workbench_field_backlink(),
      m.workbench_field_attachments(),
      m.workbench_field_annotations(),
    ]);
  });

  it("shows this paper's own values", () => {
    const values = new Map(
      rowsOf(journalArticle, "note").map((row) => [row.label, row.value]),
    );
    expect(values.get(m.workbench_field_title())).toBe(
      "Why Most Published Research Findings Are False",
    );
    expect(values.get(m.workbench_field_authors())).toBe(
      "John P. A. Ioannidis",
    );
    expect(values.get(m.workbench_field_date())).toBe("2005");
    expect(values.get(m.workbench_field_publication_title())).toBe(
      "PLoS Medicine",
    );
    expect(values.get(m.workbench_field_collections())).toBe("Shared key");
    expect(values.get(m.workbench_field_attachments())).toBe(
      "ioannidis-2005.pdf",
    );
    // An empty list and an absent value both read as no value at all.
    expect(values.get(m.workbench_field_tags())).toBe("");
    expect(values.get(m.workbench_field_abstract())).toBe("");
  });

  it("drops a row the paper carries no field for", () => {
    const labels = rowsOf(book, "note").map((row) => row.label);
    expect(labels).not.toContain(m.workbench_field_publication_title());
    expect(labels).toContain(m.workbench_field_title());
  });

  it("leads the annotation root with the highlight's own fields", () => {
    const rows = rowsOf(conferencePaper, "annotation");
    const values = new Map(rows.map((row) => [row.label, row.value]));
    expect(rows[0]?.label).toBe(m.workbench_field_text());
    expect(values.get(m.workbench_field_text())).toBe(
      "A reproducible interface makes its inputs and outputs inspectable.",
    );
    expect(values.get(m.workbench_field_page_label())).toBe("1");
    expect(values.get(m.workbench_field_parent_item())).toBe(
      "Designing reproducible research interfaces",
    );
  });

  it("leads the filename root with the parts of a note name", () => {
    expect(rowsOf(journalArticle, "filename").map((row) => row.label)).toEqual([
      m.workbench_field_title(),
      m.workbench_field_authors(),
      m.workbench_field_date(),
      m.workbench_field_citation_key(),
      m.workbench_field_key(),
    ]);
  });
});

describe("rootData", () => {
  it("has no annotation root for a paper with no highlights", () => {
    expect(rootData(journalArticle, "annotation")).toBeNull();
  });
});

describe("rowMatches", () => {
  const rows = rowsOf(journalArticle, "note");
  const match = (query: string) =>
    rows.filter((row) => rowMatches(row, query)).map((row) => row.label);

  it("matches the name the reader sees", () => {
    expect(match("author")).toEqual([m.workbench_field_authors()]);
  });

  it("leaves the raw key behind the name to Advanced", () => {
    expect(match("citationKey")).toEqual([]);
  });

  it("matches this paper's value", () => {
    expect(match("PLoS")).toEqual([m.workbench_field_publication_title()]);
  });
});

describe("snippets", () => {
  it("offers the Liquid output form for a value row", () => {
    expect(
      renderSnippet(
        nodeFor("note", m.workbench_field_title()),
        "liquid",
        "output",
      ),
    ).toBe("{{ zt.title }}");
  });

  it("offers the loop form for a list row", () => {
    expect(
      renderSnippet(
        nodeFor("note", m.workbench_field_authors()),
        "liquid",
        "loop",
      ),
    ).toBe("{% for author in zt.authors %}{{ author }}{% endfor %}");
  });
});

describe("insertRange", () => {
  const note = controller.sliceRange("note");

  it("lands on the selection the editor last reported", () => {
    const caret = { from: note.from + 4, to: note.from + 4 };
    expect(insertRange(note, caret)).toEqual(caret);
  });

  it("covers the two braces the popup opened over", () => {
    const trigger = { from: note.from + 4, to: note.from + 6 };
    expect(insertRange(note, trigger)).toEqual(trigger);
  });

  it("holds a caret left outside the pane at the pane's edge", () => {
    const inAnnotationSection = { from: note.to + 20, to: note.to + 20 };
    expect(insertRange(note, inAnnotationSection)).toEqual({
      from: note.to,
      to: note.to,
    });
  });
});

describe("insertSnippet", () => {
  // The text both Put in note and Copy hand over for the Title row.
  const snippet = renderSnippet(
    nodeFor("note", m.workbench_field_title()),
    "liquid",
    "output",
  );
  const heading = source.indexOf("# {{ zt.title }}");

  it("patches the master at the saved selection", () => {
    const draft = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
    const head = insertSnippet(draft, "note", {
      target: { from: heading, to: heading },
      snippet,
    });
    expect(draft.source.slice(heading, heading + snippet.length)).toBe(snippet);
    expect(draft.sliceText("note")).toContain(`${snippet}# {{ zt.title }}`);
    // Focus returns to the caret the reader is left holding, past the snippet.
    expect(head).toBe(heading + snippet.length);
  });

  it("takes the place of the `{{` the popup opened on", () => {
    const draft = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
    // The two braces the reader types are what opens the popup.
    draft.dispatch({
      changes: { from: heading, insert: "{{" },
      userEvent: "input.type",
    });
    insertSnippet(draft, "note", {
      target: { from: heading, to: heading + 2 },
      snippet,
    });
    expect(draft.source.slice(heading, heading + snippet.length)).toBe(snippet);
    // The braces went away with the popup: the draft grew by the snippet alone.
    expect(draft.source.length).toBe(source.length + snippet.length);
  });

  it("holds an insertion meant for another pane inside this one", () => {
    const draft = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
    const note = draft.sliceRange("note");
    const head = insertSnippet(draft, "note", {
      target: { from: note.to + 20, to: note.to + 20 },
      snippet,
    });
    expect(head).toBe(note.to + snippet.length);
  });
});
