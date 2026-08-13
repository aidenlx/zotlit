// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import type {
  Citation,
  CitationOccurrence,
  ReferenceSource,
} from "@/services/citation-index/service";

import { createReferencesStore, minimalReferencesState } from "./store";

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
    const content = document.createDocumentFragment();
    content.append("Stale formatted book");
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
          marker: undefined,
          content,
        },
      ],
      listMode: { kind: "bibliography", hasEntryMarkers: false },
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
