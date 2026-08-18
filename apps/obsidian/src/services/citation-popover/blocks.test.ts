import { describe, expect, it } from "vitest";

import { ambiguousCandidates } from "@/services/citation-index/__fixtures__/ambiguous-candidates";
import type { AmbiguousCandidatesOf } from "@/services/citation-index/ambiguity";
import type {
  CitationOccurrence,
  ReferenceSource,
} from "@/services/citation-index/service";
import type { HoveredWork } from "@/services/citekey-navigation";
import type { ReferenceEntry } from "@/views/references/entries";

import { citationPopoverBlocks } from "./blocks";

/** One work a citation names, with the Item its entry is built under. */
const work = (citekey: string): HoveredWork => ({
  citekey,
  indexedKey: `KEY${citekey}`,
});

/** One work whose citekey reaches no Zotero Item at all. */
const unknown = (citekey: string): HoveredWork => ({ citekey });

/** A document whose citekeys name at most one Item apiece. */
const none: AmbiguousCandidatesOf = () => null;

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
      [work("smith2025"), work("doe2024")],
      [renderedEntry("doe2024"), renderedEntry("smith2025")],
      { serials: false, ambiguous: none },
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
      [work("doe2024")],
      [
        renderedEntry("doe2024", {
          source: source({
            itemKey: "ITEM0009",
            groupID: 7,
            attachments: [{ key: "ATT1", groupID: 7, label: "paper.pdf" }],
          }),
        }),
      ],
      { serials: false, ambiguous: none },
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
      [work("doe2024")],
      [renderedEntry("doe2024", { marker })],
      { serials: false, ambiguous: none },
    );

    expect(block).toMatchObject({ marker, serial: undefined });
  });

  it("gutters the Entry Serial only where the document's citations show them", () => {
    const entries = [renderedEntry("doe2024", { serial: 3 })];

    expect(
      citationPopoverBlocks([work("doe2024")], entries, {
        serials: true,
        ambiguous: none,
      })[0],
    ).toMatchObject({ serial: 3 });
    expect(
      citationPopoverBlocks([work("doe2024")], entries, {
        serials: false,
        ambiguous: none,
      })[0],
    ).toMatchObject({ serial: undefined });
  });

  it("falls back to the work's summary where no bibliography formatted it", () => {
    const [block] = citationPopoverBlocks(
      [work("doe2024")],
      [
        {
          id: "KEYdoe2024",
          refNumber: 1,
          occurrences: [occurrence("doe2024")],
          kind: "summary",
          source: source(),
          linkpath: null,
        },
      ],
      { serials: false, ambiguous: none },
    );

    expect(block).toMatchObject({
      kind: "entry",
      content: null,
      summary: "Doe (2024): Book",
    });
  });

  it("keeps a citekey reaching no Item as an unresolved block of its own", () => {
    const blocks = citationPopoverBlocks(
      [unknown("typo2024"), work("gone2020")],
      [
        {
          id: "@typo2024",
          refNumber: 1,
          occurrences: [occurrence("typo2024")],
          kind: "unresolved",
          citekey: "typo2024",
        },
        {
          id: "KEYgone2020",
          refNumber: 2,
          occurrences: [occurrence("gone2020")],
          kind: "missing",
          linkpath: null,
        },
      ],
      { serials: false, ambiguous: none },
    );

    expect(blocks).toEqual([
      { kind: "unresolved", citekey: "typo2024" },
      { kind: "unresolved", citekey: "gone2020" },
    ]);
  });

  it("states the candidates of a citekey that names several Items", () => {
    const blocks = citationPopoverBlocks([unknown("doe2024")], [], {
      serials: false,
      ambiguous: (citekey) =>
        citekey === "doe2024" ? ambiguousCandidates : null,
    });

    expect(blocks).toEqual([
      {
        kind: "ambiguous",
        citekey: "doe2024",
        candidates: ambiguousCandidates,
      },
    ]);
  });

  it("keeps a citekey reaching no Item apart from an ambiguous one", () => {
    const blocks = citationPopoverBlocks(
      [unknown("typo2024"), unknown("doe2024")],
      [],
      {
        serials: false,
        ambiguous: (citekey) =>
          citekey === "doe2024" ? ambiguousCandidates : null,
      },
    );

    expect(blocks.map((block) => block.kind)).toEqual([
      "unresolved",
      "ambiguous",
    ]);
  });

  it("reaches an entry the work's own citekey spelling never names", () => {
    const blocks = citationPopoverBlocks(
      // What a wikilink Citation names: the Item its Literature Note carries,
      // under a citekey the document never writes as text.
      [{ citekey: "Wang 2020", indexedKey: "KEYdoe2024" }],
      [renderedEntry("doe2024")],
      { serials: false, ambiguous: none },
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
        { serials: false, ambiguous: none },
      ),
    ).toEqual([{ kind: "unresolved", citekey: "doe2024" }]);
  });

  it("keeps a citation none of whose keys is known stacking a block apiece", () => {
    expect(
      citationPopoverBlocks(
        [unknown("nobody1999"), unknown("nothing2000")],
        [],
        { serials: false, ambiguous: none },
      ),
    ).toEqual([
      { kind: "unresolved", citekey: "nobody1999" },
      { kind: "unresolved", citekey: "nothing2000" },
    ]);
  });
});
