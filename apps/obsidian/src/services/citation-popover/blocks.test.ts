import { describe, expect, it } from "vitest";

import type {
  CitationOccurrence,
  ReferenceSource,
} from "@/services/citation-index/service";
import type { HoveredWork } from "@/services/citekey-navigation";
import type { ReferenceEntry } from "@/views/references/entries";

import { citationPopoverBlocks } from "./blocks";

/** One work a citekey citation names, which the document answers for. */
const key = (citekey: string): HoveredWork => ({ citekey });

const occurrence = (raw: string): CitationOccurrence => ({
  kind: "citekey",
  raw,
  position: {
    start: { line: 0, col: 0, offset: 0 },
    end: { line: 0, col: raw.length + 1, offset: raw.length + 1 },
  },
});

const source = (overrides: Partial<ReferenceSource> = {}): ReferenceSource => ({
  csl: { id: "BOOK0001", type: "book", title: "Book" },
  summary: "Doe (2024): Book",
  itemKey: "BOOK0001",
  itemID: 1,
  groupID: null,
  citekey: "doe2024",
  linkpath: "notes/BOOK0001",
  attachments: [],
  ...overrides,
});

const renderedEntry = (
  citekey: string,
  overrides: Partial<Extract<ReferenceEntry, { kind: "rendered" }>> = {},
): ReferenceEntry => ({
  id: `KEY${citekey}`,
  refNumber: 1,
  occurrences: [occurrence(citekey)],
  kind: "rendered",
  source: source(),
  linkpath: "notes/BOOK0001",
  serial: 1,
  marker: undefined,
  content: [{ t: "Str", c: `Entry of ${citekey}` }],
  ...overrides,
});

describe("citationPopoverBlocks", () => {
  it("stacks one block per work, in the order the citation names them", () => {
    const blocks = citationPopoverBlocks(
      [key("smith2025"), key("doe2024")],
      [renderedEntry("doe2024"), renderedEntry("smith2025", { id: "KEY2" })],
      { serials: false },
    );

    expect(blocks.map((block) => block.citekey)).toEqual([
      "smith2025",
      "doe2024",
    ]);
    expect(
      blocks.map((block) => (block.kind === "entry" ? block.content : null)),
    ).toEqual([
      [{ t: "Str", c: "Entry of smith2025" }],
      [{ t: "Str", c: "Entry of doe2024" }],
    ]);
  });

  it("carries what the entry's actions reach", () => {
    const [block] = citationPopoverBlocks(
      [key("doe2024")],
      [
        renderedEntry("doe2024", {
          source: source({
            itemKey: "ITEM0009",
            groupID: 7,
            attachments: [{ key: "ATT1", groupID: 7, label: "paper.pdf" }],
          }),
        }),
      ],
      { serials: false },
    );

    expect(block).toMatchObject({
      kind: "entry",
      citekey: "doe2024",
      itemKey: "ITEM0009",
      groupID: 7,
      attachments: [{ key: "ATT1", groupID: 7, label: "paper.pdf" }],
    });
  });

  it("puts the style's Entry Marker in the gutter, whatever the serials say", () => {
    const marker = [{ t: "Str" as const, c: "[1]" }];
    const [block] = citationPopoverBlocks(
      [key("doe2024")],
      [renderedEntry("doe2024", { marker })],
      { serials: false },
    );

    expect(block).toMatchObject({ marker, serial: undefined });
  });

  it("gutters the Entry Serial only where the document's citations show them", () => {
    const entries = [renderedEntry("doe2024", { serial: 3 })];

    expect(
      citationPopoverBlocks([key("doe2024")], entries, { serials: true })[0],
    ).toMatchObject({ serial: 3 });
    expect(
      citationPopoverBlocks([key("doe2024")], entries, { serials: false })[0],
    ).toMatchObject({ serial: undefined });
  });

  it("falls back to the work's summary where no bibliography formatted it", () => {
    const [block] = citationPopoverBlocks(
      [key("doe2024")],
      [
        {
          id: "KEY1",
          refNumber: 1,
          occurrences: [occurrence("doe2024")],
          kind: "summary",
          source: source(),
          linkpath: null,
        },
      ],
      { serials: false },
    );

    expect(block).toMatchObject({
      kind: "entry",
      content: null,
      summary: "Doe (2024): Book",
    });
  });

  it("keeps a citekey reaching no Item as an unresolved block of its own", () => {
    const blocks = citationPopoverBlocks(
      [key("typo2024"), key("gone2020")],
      [
        {
          id: "@typo2024",
          refNumber: 1,
          occurrences: [occurrence("typo2024")],
          kind: "unresolved",
          citekey: "typo2024",
        },
        {
          id: "GONE0002",
          refNumber: 2,
          occurrences: [occurrence("gone2020")],
          kind: "missing",
          linkpath: null,
        },
      ],
      { serials: false },
    );

    expect(blocks).toEqual([
      { kind: "unresolved", citekey: "typo2024" },
      { kind: "unresolved", citekey: "gone2020" },
    ]);
  });

  it("reaches the entry of a work naming its own Item", () => {
    const blocks = citationPopoverBlocks(
      // What a wikilink Citation names: the Item its Literature Note carries,
      // under a citekey the document never writes as text.
      [{ citekey: "Wang 2020", indexedKey: "KEYdoe2024" }],
      [renderedEntry("doe2024")],
      { serials: false },
    );

    expect(blocks).toMatchObject([
      {
        kind: "entry",
        citekey: "Wang 2020",
        content: [{ t: "Str", c: "Entry of doe2024" }],
      },
    ]);
  });

  it("keeps a work whose Item the document does not cite unresolved", () => {
    expect(
      citationPopoverBlocks(
        [{ citekey: "doe2024", indexedKey: "GONE0002" }],
        [renderedEntry("doe2024")],
        { serials: false },
      ),
    ).toEqual([{ kind: "unresolved", citekey: "doe2024" }]);
  });

  it("keeps a citation none of whose keys is known stacking a block apiece", () => {
    expect(
      citationPopoverBlocks([key("nobody1999"), key("nothing2000")], [], {
        serials: false,
      }),
    ).toEqual([
      { kind: "unresolved", citekey: "nobody1999" },
      { kind: "unresolved", citekey: "nothing2000" },
    ]);
  });
});
