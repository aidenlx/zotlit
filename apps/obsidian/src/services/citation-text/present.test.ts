// @vitest-environment happy-dom
import { describe, expect } from "vitest";

import { scanPandocCitations } from "@zotlit/templates/pandoc-citation";

import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";
import {
  lookupAnswer,
  lookupForWorks,
} from "@/services/citation-index/__fixtures__/lookup";

import { rendered } from "./__fixtures__";
import {
  citationContent,
  citationState,
  citationStateHooks,
  citedWorks,
  citekeyState,
  literalKeyStateOf,
  presentedCitationEqual,
  sectionCoordinates,
} from "./present";
import type {
  CitationKeyState,
  CitationSource,
  CitationState,
  DocumentCitations,
} from "./present";

/** One citation, read out of the source text that is nothing but that citation. */
function citation(source: string): CitationSource {
  const [found] = scanPandocCitations(source);
  return {
    source,
    keys: found!.items.map(({ citationKey, start, end }) => ({
      citekey: citationKey,
      start,
      end,
    })),
  };
}

/**
 * The citations of a document whose literal keys name the given Items.
 *
 * @param works the Indexed Key and summary each literal citekey names; a key
 *   left out of it is one that reaches no Zotero Item.
 */
function citedDocument(
  works: Record<string, { indexedKey: string; summary: string }> = {},
): DocumentCitations {
  const entries = Object.entries(works);
  return {
    formatted: new Map(),
    entrySerials: false,
    summaries: new Map(
      entries.map(([, { indexedKey, summary }]) => [indexedKey, summary]),
    ),
    lookup: lookupForWorks(
      new Map(
        entries.map(([citekey, { indexedKey }]) => [citekey, indexedKey]),
      ),
    ),
    literalWorks: new Map(
      entries.map(([citekey, { indexedKey }]) => [citekey, indexedKey]),
    ),
  };
}

describe("citedWorks", () => {
  it.effect("names each work by its Item and summary, in citation order", () =>
    Effect.sync(() => {
      expect(
        citedWorks(
          citation("[see @a, p. 3; -@b]"),
          citedDocument({
            a: { indexedKey: "1/ZETA", summary: "Zeta (2020)" },
            b: { indexedKey: "1/ADAMS", summary: "Adams (2018)" },
          }),
        ),
      ).toEqual([
        { citekey: "a", indexedKey: "1/ZETA", label: "Zeta (2020)" },
        { citekey: "b", indexedKey: "1/ADAMS", label: "Adams (2018)" },
      ]);
    }),
  );

  it.effect("shows a key that reaches no item by its raw citekey", () =>
    Effect.sync(() => {
      expect(
        citedWorks(
          citation("[@a; @ghost]"),
          citedDocument({
            a: { indexedKey: "1/ZETA", summary: "Zeta (2020)" },
          }),
        ),
      ).toEqual([
        { citekey: "a", indexedKey: "1/ZETA", label: "Zeta (2020)" },
        { citekey: "ghost", indexedKey: undefined, label: "@ghost" },
      ]);
    }),
  );

  it.effect("keeps the braces an unresolved braced key is written with", () =>
    Effect.sync(() => {
      expect(
        citedWorks(citation("[@{https://example.com/paper}]"), citedDocument()),
      ).toEqual([
        {
          citekey: "https://example.com/paper",
          indexedKey: undefined,
          label: "@{https://example.com/paper}",
        },
      ]);
    }),
  );

  it.effect("names a repeated key once", () =>
    Effect.sync(() => {
      expect(
        citedWorks(citation("[@a; @b; @a]"), citedDocument()).map(
          (work) => work.citekey,
        ),
      ).toEqual(["a", "b"]);
    }),
  );
});

describe("citationState", () => {
  const stateFor = (
    ...states: readonly CitationKeyState[]
  ): CitationState | undefined => citationState(states);

  it.effect("reads a citation whose every key names an Item as resolved", () =>
    Effect.sync(() => {
      expect(stateFor("resolved", "resolved")).toBe("resolved");
    }),
  );

  it.effect(
    "reads a citation no key of which names an Item as unresolved",
    () =>
      Effect.sync(() => {
        expect(stateFor("missing", "missing")).toBe("unresolved");
      }),
  );

  it.effect(
    "reads a cluster of resolved and missing keys as partly unresolved",
    () =>
      Effect.sync(() => {
        expect(stateFor("resolved", "missing")).toBe("partially-unresolved");
      }),
  );

  it.effect(
    "reads a key naming several Items as ambiguous, beside resolved keys",
    () =>
      Effect.sync(() => {
        expect(stateFor("ambiguous")).toBe("ambiguous");
        expect(stateFor("resolved", "ambiguous")).toBe("ambiguous");
      }),
  );

  // The strongest failure stays visible: a key that reaches nothing at all
  // outranks one that reaches several.
  it.effect("lets a missing key outrank ambiguity in a mixed cluster", () =>
    Effect.sync(() => {
      expect(stateFor("ambiguous", "missing")).toBe("unresolved");
      expect(stateFor("resolved", "ambiguous", "missing")).toBe(
        "partially-unresolved",
      );
    }),
  );

  it.effect("reads a citation naming no key at all as resolved", () =>
    Effect.sync(() => {
      expect(citationState([])).toBe("resolved");
    }),
  );

  it.effect("keeps a pending citation neutral", () =>
    Effect.sync(() => {
      expect(stateFor("pending")).toBe("pending");
      expect(stateFor("resolved", "pending")).toBe("pending");
    }),
  );
});

// The class names are a public promise to themes, so the state each one stands
// for is asserted by its literal name.
describe("citationStateHooks", () => {
  it.effect("names one public theme hook per state a citation reads as", () =>
    Effect.sync(() => {
      expect(citationStateHooks("resolved")).toEqual([]);
      expect(citationStateHooks("pending")).toEqual([
        "zt-citation-key-pending",
      ]);
      expect(citationStateHooks("unresolved")).toEqual([
        "zt-citation-key-unresolved",
      ]);
      expect(citationStateHooks("partially-unresolved")).toEqual([
        "zt-citation-key-partially-unresolved",
      ]);
      expect(citationStateHooks("ambiguous")).toEqual([
        "zt-citation-key-ambiguous",
      ]);
    }),
  );
});

describe("citekeyState", () => {
  it.effect("reads what one resolution names", () =>
    Effect.sync(() => {
      expect(citekeyState(null)).toBe("pending");
      expect(citekeyState({ kind: "missing" })).toBe("missing");
      expect(
        citekeyState({
          kind: "unique",
          item: {
            itemID: 1,
            libraryID: 1,
            key: "ZETA1234",
            indexedKey: "ZETA1234",
          },
        }),
      ).toBe("resolved");
      expect(citekeyState({ kind: "ambiguous", candidates: [] })).toBe(
        "ambiguous",
      );
    }),
  );
});

describe("literalKeyStateOf", () => {
  const citations = {
    ...citedDocument({ a: { indexedKey: "1/ZETA", summary: "Zeta (2020)" } }),
    lookup: lookupAnswer({
      a: {
        kind: "unique",
        item: { itemID: 1, libraryID: 1, key: "ZETA", indexedKey: "1/ZETA" },
      },
      b: {
        kind: "unique",
        item: {
          itemID: 2,
          libraryID: 1,
          key: "UNREAD",
          indexedKey: "1/UNREAD",
        },
      },
      twin: { kind: "ambiguous", candidates: [] },
      ghost: { kind: "missing" },
    }),
  };

  it.effect("reads a key the document's own read reached as resolved", () =>
    Effect.sync(() => {
      expect(literalKeyStateOf(citations)("a")).toBe("resolved");
    }),
  );

  it.effect("reads a key that reached no work by what the snapshot names", () =>
    Effect.sync(() => {
      expect(literalKeyStateOf(citations)("twin")).toBe("ambiguous");
      expect(literalKeyStateOf(citations)("ghost")).toBe("missing");
    }),
  );

  // The Item resolves, but the read could not render a summary for it, so no
  // surface has anything to show in the citation's place.
  it.effect(
    "reads a key whose Item the document could not read as missing",
    () =>
      Effect.sync(() => {
        expect(literalKeyStateOf(citations)("b")).toBe("missing");
      }),
  );

  it.effect("keeps a key neutral before the first snapshot settles", () =>
    Effect.sync(() => {
      expect(literalKeyStateOf(citations)("unrequested")).toBe("pending");
    }),
  );
});

describe("presentedCitationEqual", () => {
  it.effect("compares rendered text and Entry Serials", () =>
    Effect.sync(() => {
      const citation = { text: rendered("Zeta (2020)"), serials: [1] };

      expect(
        presentedCitationEqual(citation, {
          text: rendered("Zeta (2020)"),
          serials: [1],
        }),
      ).toBe(true);
      expect(
        presentedCitationEqual(citation, {
          text: rendered("Adams (2018)"),
          serials: [1],
        }),
      ).toBe(false);
      expect(
        presentedCitationEqual(citation, {
          text: rendered("Zeta (2020)"),
          serials: [2],
        }),
      ).toBe(false);
    }),
  );
});

describe("citationContent", () => {
  /**
   * `First [@a]. Then [@a].` under a position-dependent style: the second
   * occurrence of one source reads as the subsequent form citeproc gave it.
   */
  const HELD: DocumentCitations = {
    formatted: new Map([
      [
        "[@a]",
        [
          { start: 6, text: rendered("(Zeta 2020)"), serials: [] },
          { start: 20, text: rendered("(ibid.)"), serials: [] },
        ],
      ],
    ]),
    entrySerials: false,
    summaries: new Map([["ALPHA234", "Zeta (2020)"]]),
    lookup: lookupForWorks(new Map([["a", "ALPHA234"]])),
    literalWorks: new Map([["a", "ALPHA234"]]),
  };
  const CITATION = citation("[@a]");

  it.effect(
    "keeps source presentation when no complete formatted result exists",
    () =>
      Effect.sync(() => {
        expect(
          citationContent(citation("[see @a, p. 3]"), {
            formatted: new Map(),
            entrySerials: false,
            summaries: new Map([["ALPHA234", "Zeta (2020)"]]),
            lookup: lookupForWorks(new Map([["a", "ALPHA234"]])),
            literalWorks: new Map([["a", "ALPHA234"]]),
          }),
        ).toBeNull();
      }),
  );

  it.effect("shows the text of the occurrence an editor offset names", () =>
    Effect.sync(() => {
      expect(
        citationContent(CITATION, HELD, { kind: "offset", start: 20 })?.text
          .content,
      ).toEqual(rendered("(ibid.)").content);
    }),
  );

  it.effect(
    "shows the text of the occurrence a section's own order names",
    () =>
      Effect.sync(() => {
        expect(
          citationContent(CITATION, HELD, {
            kind: "section",
            from: 14,
            to: 25,
            ordinal: 0,
          })?.text.content,
        ).toEqual(rendered("(ibid.)").content);
      }),
  );

  it.effect(
    "falls back to the first occurrence where a coordinate reaches none",
    () =>
      Effect.sync(() => {
        // No coordinate at all, an offset an edit has moved, and a section counting
        // one occurrence more than the document writes there.
        for (const at of [
          undefined,
          { kind: "offset", start: 21 },
          { kind: "section", from: 14, to: 25, ordinal: 1 },
        ] as const) {
          expect(citationContent(CITATION, HELD, at)?.text.content).toEqual(
            rendered("(Zeta 2020)").content,
          );
        }
      }),
  );
});

describe("sectionCoordinates", () => {
  it.effect(
    "counts the occurrences of one identity the section shows, in its order",
    () =>
      Effect.sync(() => {
        expect(
          sectionCoordinates(
            [citation("[@a]"), citation("[@b]"), citation("[@a]")],
            { from: 14, to: 40 },
          ),
        ).toEqual([
          { kind: "section", from: 14, to: 40, ordinal: 0 },
          { kind: "section", from: 14, to: 40, ordinal: 0 },
          { kind: "section", from: 14, to: 40, ordinal: 1 },
        ]);
      }),
  );

  it.effect(
    "names no coordinate at all for a section Obsidian places nowhere",
    () =>
      Effect.sync(() => {
        expect(sectionCoordinates([citation("[@a]")], null)).toEqual([
          undefined,
        ]);
      }),
  );
});
