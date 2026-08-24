import { describe, expect, it } from "vitest";

import type {
  Citation,
  CitationOccurrence,
  ReferenceSource,
} from "@/services/citation-index/service";
import type { Inlines } from "@/services/pandoc/ast";

import type { ReferenceEntry } from "./entries";
import {
  createReferencesStore,
  minimalReferencesState,
  referencesCopyState,
} from "./store";

const occurrence: CitationOccurrence = {
  kind: "citekey",
  raw: "book",
  position: {
    start: { line: 0, col: 0, offset: 0 },
    end: { line: 0, col: 5, offset: 5 },
  },
};

const citations: readonly Citation[] = [
  {
    indexedKey: "BOOK0001",
    refNumber: 1,
    linkpath: "notes/BOOK0001",
    occurrences: [occurrence],
  },
];

const source: ReferenceSource = {
  csl: { id: "ref-book", type: "book", title: "Book" },
  summary: "Rivers (2020): Book",
  itemKey: "BOOK0001",
  itemID: 1,
  groupID: null,
  citekey: "rivers2020",
  linkpath: "notes/BOOK0001",
  attachments: [],
};

describe("minimalReferencesState", () => {
  it("replaces a stale formatted list after a failed render", () => {
    const content: Inlines = [
      { t: "Str", c: "Stale" },
      { t: "Space" },
      { t: "Str", c: "formatted" },
      { t: "Space" },
      { t: "Str", c: "book" },
    ];
    const store = createReferencesStore();
    store.setState({
      entries: [
        {
          id: "BOOK0001",
          refNumber: 1,
          linkpath: "notes/BOOK0001",
          occurrences: [occurrence],
          kind: "rendered",
          source,
          serial: 1,
          marker: undefined,
          content,
        },
      ],
      listMode: {
        kind: "bibliography",
        hasEntryMarkers: false,
        entrySerials: false,
      },
      formattingFailed: false,
    });

    store.setState(
      minimalReferencesState({
        citations,
        sources: new Map([["BOOK0001", source]]),
        errors: [],
        formattingFailed: true,
      }),
    );

    expect(store.getState()).toMatchObject({
      entries: [{ id: "BOOK0001", kind: "summary", source }],
      listMode: { kind: "minimal" },
      formattingFailed: true,
    });
  });
});

describe("referencesCopyState", () => {
  const rendered: ReferenceEntry = {
    id: "BOOK0001",
    refNumber: 1,
    linkpath: "notes/BOOK0001",
    occurrences: [occurrence],
    kind: "rendered",
    source,
    serial: 1,
    marker: [{ t: "Str", c: "[1]" }],
    content: [{ t: "Str", c: "Book" }],
  };
  const unrendered: ReferenceEntry = {
    id: "BOOK0002",
    refNumber: 2,
    linkpath: "notes/BOOK0002",
    occurrences: [occurrence],
    kind: "unrendered",
    source,
  };

  it("offers a complete, error-free bibliography of the active note", () => {
    expect(
      referencesCopyState({
        path: "notes/tidal.md",
        generation: 3,
        entries: [rendered],
        formatting: "complete",
      }),
    ).toStrictEqual({
      kind: "ready",
      target: { path: "notes/tidal.md", generation: 3 },
    });
  });

  it("refuses a list no active note answers for", () => {
    expect(
      referencesCopyState({
        path: null,
        generation: 3,
        entries: [],
        formatting: "complete",
      }),
    ).toStrictEqual({ kind: "blocked", reason: "no-note" });
  });

  it("refuses a note that cites nothing", () => {
    expect(
      referencesCopyState({
        path: "notes/tidal.md",
        generation: 3,
        entries: [],
        formatting: "complete",
      }),
    ).toStrictEqual({ kind: "blocked", reason: "no-references" });
  });

  it.each(["pending", "unavailable", "failed"] as const)(
    "refuses retained entries while formatting is %s",
    (formatting) => {
      expect(
        referencesCopyState({
          path: "notes/tidal.md",
          generation: 3,
          entries: [rendered],
          formatting,
        }),
      ).toStrictEqual({ kind: "blocked", reason: formatting });
    },
  );

  it("refuses a completed bibliography that left a Reference Error", () => {
    expect(
      referencesCopyState({
        path: "notes/tidal.md",
        generation: 3,
        entries: [rendered, unrendered],
        formatting: "complete",
      }),
    ).toStrictEqual({ kind: "blocked", reason: "errors" });
  });
});
