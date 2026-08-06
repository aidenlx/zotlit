// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { type Attachment } from "@zotlit/db";
import { Temporal } from "@zotlit/shared/temporal";

import { type Citation } from "@/services/citation-scan/service";

import {
  buildReferenceEntries,
  toOpenableAttachments,
  type ReferenceSource,
} from "./entries";

function citation(
  indexedKey: string,
  refNumber: number,
  lines: readonly number[] = [refNumber],
): Citation {
  return {
    indexedKey,
    linkpath: `notes/${indexedKey}`,
    refNumber,
    occurrences: lines.map((line) => ({ line, col: 0 })),
  };
}

/** A rendered entry as the engine hands it over: parsed, not markup. */
function fragment(text: string): DocumentFragment {
  const content = createFragment();
  const span = document.createElement("span");
  span.textContent = text;
  content.append(span);
  return content;
}

function source(indexedKey: string, id: string): ReferenceSource {
  return {
    csl: { id, type: "book", title: `Title of ${indexedKey}` },
    summary: `Rivers (2020): Title of ${indexedKey}`,
    itemKey: indexedKey,
    itemID: 1,
    groupID: null,
    attachments: [],
  };
}

function attachment(overrides: Partial<Attachment>): Attachment {
  return {
    itemID: 20,
    libraryID: 1,
    groupID: null,
    key: "ATCH2345",
    indexedKey: "ATCH2345",
    parentItemID: 1,
    path: null,
    contentType: null,
    linkMode: null,
    dateAdded: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("toOpenableAttachments", () => {
  it("names a stored attachment by its filename", () => {
    expect(
      toOpenableAttachments([
        attachment({ path: "storage:Rivers_2020.pdf", linkMode: 0 }),
      ]),
    ).toStrictEqual([
      { key: "ATCH2345", groupID: null, label: "Rivers_2020.pdf" },
    ]);
  });

  it("names a snapshot and a linked file the same way, whatever the format", () => {
    expect(
      toOpenableAttachments([
        attachment({ path: "storage:page.html", linkMode: 1 }),
        attachment({ path: "/Papers/thesis.epub", linkMode: 2 }),
        attachment({ path: "attachments:drafts/notes.docx", linkMode: 2 }),
      ]).map((a) => a.label),
    ).toStrictEqual(["page.html", "thesis.epub", "notes.docx"]);
  });

  it("names a linked file a Windows library recorded, read on any platform", () => {
    expect(
      toOpenableAttachments([
        attachment({ path: "C:\\Papers\\Rivers 2020.pdf", linkMode: 2 }),
      ]).map((a) => a.label),
    ).toStrictEqual(["Rivers 2020.pdf"]);
  });

  it("leaves out an attachment that names no file", () => {
    expect(
      toOpenableAttachments([
        // A bare web link, which Zotero's reader cannot open.
        attachment({ path: "https://example.com/paper", linkMode: 3 }),
        // A stored row whose path lost its `storage:` prefix.
        attachment({ path: "paper.pdf", linkMode: 0 }),
        attachment({ path: null, linkMode: 0 }),
      ]),
    ).toStrictEqual([]);
  });

  it("keeps the library order, so the menu reads as Zotero lists it", () => {
    expect(
      toOpenableAttachments([
        attachment({ key: "ATCHZZZZ", path: "storage:zebra.pdf", linkMode: 0 }),
        attachment({ key: "ATCHAAAA", path: "storage:alpha.pdf", linkMode: 0 }),
      ]).map((a) => a.key),
    ).toStrictEqual(["ATCHZZZZ", "ATCHAAAA"]);
  });

  it("carries the group library through, so the deep link addresses it", () => {
    expect(
      toOpenableAttachments([
        attachment({ path: "storage:shared.pdf", linkMode: 0, groupID: 42 }),
      ]),
    ).toStrictEqual([{ key: "ATCH2345", groupID: 42, label: "shared.pdf" }]);
  });
});

describe("buildReferenceEntries", () => {
  it("keeps document order and reference numbers when the engine renders in another order", () => {
    const citations = [citation("ZEBRA001", 1), citation("ALPHA002", 2)];
    const sources = new Map([
      ["ZEBRA001", source("ZEBRA001", "ref-zebra")],
      ["ALPHA002", source("ALPHA002", "ref-alpha")],
    ]);
    // Alphabetical, as an author-name bibliography style sorts it.
    const alpha = fragment("Alpha");
    const zebra = fragment("Zebra");
    const rendered = new Map([
      ["ref-alpha", alpha],
      ["ref-zebra", zebra],
    ]);

    expect(buildReferenceEntries(citations, sources, rendered)).toStrictEqual([
      {
        indexedKey: "ZEBRA001",
        linkpath: "notes/ZEBRA001",
        refNumber: 1,
        occurrences: [{ line: 1, col: 0 }],
        kind: "rendered",
        source: sources.get("ZEBRA001"),
        content: zebra,
      },
      {
        indexedKey: "ALPHA002",
        linkpath: "notes/ALPHA002",
        refNumber: 2,
        occurrences: [{ line: 2, col: 0 }],
        kind: "rendered",
        source: sources.get("ALPHA002"),
        content: alpha,
      },
    ]);
  });

  it("falls back to the minimal reference list when nothing rendered the entries", () => {
    const citations = [citation("BOOK0001", 1)];
    const sources = new Map([["BOOK0001", source("BOOK0001", "ref-book")]]);

    expect(buildReferenceEntries(citations, sources)).toMatchObject([
      {
        kind: "summary",
        source: { summary: "Rivers (2020): Title of BOOK0001" },
      },
    ]);
  });

  it("falls back per entry when the engine rendered only some of them", () => {
    const citations = [citation("BOOK0001", 1), citation("BOOK0002", 2)];
    const sources = new Map([
      ["BOOK0001", source("BOOK0001", "ref-one")],
      ["BOOK0002", source("BOOK0002", "ref-two")],
    ]);
    const rendered = new Map([["ref-one", fragment("One")]]);

    expect(
      buildReferenceEntries(citations, sources, rendered).map((e) => e.kind),
    ).toStrictEqual(["rendered", "summary"]);
  });

  it("keeps a citation whose Item the database no longer holds, in place", () => {
    const citations = [
      citation("GONE0001", 1),
      citation("BOOK0002", 2, [3, 7]),
    ];
    const sources = new Map([["BOOK0002", source("BOOK0002", "ref-two")]]);

    expect(buildReferenceEntries(citations, sources)).toStrictEqual([
      {
        indexedKey: "GONE0001",
        linkpath: "notes/GONE0001",
        refNumber: 1,
        occurrences: [{ line: 1, col: 0 }],
        kind: "missing",
      },
      {
        indexedKey: "BOOK0002",
        linkpath: "notes/BOOK0002",
        refNumber: 2,
        occurrences: [
          { line: 3, col: 0 },
          { line: 7, col: 0 },
        ],
        kind: "summary",
        source: sources.get("BOOK0002"),
      },
    ]);
  });
});
