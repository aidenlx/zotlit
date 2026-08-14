// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { scanCitations } from "@/lib/citation-grammar";

import { rendered } from "./__fixtures__";
import {
  citationContent,
  citationElement,
  citedWorks,
  sectionCoordinates,
} from "./present";
import type { CitationSource, DocumentCitations } from "./present";

/** One citation, read out of the source text that is nothing but that citation. */
function citation(source: string): CitationSource {
  const [found] = scanCitations(source);
  return {
    source,
    keys: found!.keys.map(({ citekey, start, end }) => ({
      citekey,
      start,
      end,
    })),
  };
}

describe("citedWorks", () => {
  it("names each work by its summary, in the order the citation writes it", () => {
    expect(
      citedWorks(citation("[see @a, p. 3; -@b]"), (key) =>
        key === "a" ? "Zeta (2020)" : "Adams (2018)",
      ),
    ).toEqual([
      { citekey: "a", label: "Zeta (2020)" },
      { citekey: "b", label: "Adams (2018)" },
    ]);
  });

  it("shows a key that reaches no item by its raw citekey", () => {
    expect(
      citedWorks(citation("[@a; @ghost]"), (key) =>
        key === "a" ? "Zeta (2020)" : undefined,
      ),
    ).toEqual([
      { citekey: "a", label: "Zeta (2020)" },
      { citekey: "ghost", label: "@ghost" },
    ]);
  });

  it("keeps the braces an unresolved braced key is written with", () => {
    expect(
      citedWorks(citation("[@{https://example.com/paper}]"), () => undefined),
    ).toEqual([
      {
        citekey: "https://example.com/paper",
        label: "@{https://example.com/paper}",
      },
    ]);
  });

  it("names a repeated key once", () => {
    expect(
      citedWorks(citation("[@a; @b; @a]"), () => undefined).map(
        (work) => work.citekey,
      ),
    ).toEqual(["a", "b"]);
  });
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
          { start: 6, text: rendered("(Zeta 2020)") },
          { start: 20, text: rendered("(ibid.)") },
        ],
      ],
    ]),
    summaries: new Map([["ALPHA234", "Zeta (2020)"]]),
    literalWorks: new Map([["a", "ALPHA234"]]),
  };
  const CITATION = citation("[@a]");

  it("keeps source presentation when no complete formatted result exists", () => {
    expect(
      citationContent(citation("[see @a, p. 3]"), {
        formatted: new Map(),
        summaries: new Map([["ALPHA234", "Zeta (2020)"]]),
        literalWorks: new Map([["a", "ALPHA234"]]),
      }),
    ).toBeNull();
  });

  it("shows the text of the occurrence an editor offset names", () => {
    expect(
      citationContent(CITATION, HELD, { kind: "offset", start: 20 })?.content,
    ).toEqual(rendered("(ibid.)").content);
  });

  it("shows the text of the occurrence a section's own order names", () => {
    expect(
      citationContent(CITATION, HELD, {
        kind: "section",
        from: 14,
        to: 25,
        ordinal: 0,
      })?.content,
    ).toEqual(rendered("(ibid.)").content);
  });

  it("falls back to the first occurrence where a coordinate reaches none", () => {
    // No coordinate at all, an offset an edit has moved, and a section counting
    // one occurrence more than the document writes there.
    for (const at of [
      undefined,
      { kind: "offset", start: 21 },
      { kind: "section", from: 14, to: 25, ordinal: 1 },
    ] as const) {
      expect(citationContent(CITATION, HELD, at)?.content).toEqual(
        rendered("(Zeta 2020)").content,
      );
    }
  });
});

describe("sectionCoordinates", () => {
  it("counts the occurrences of one identity the section shows, in its order", () => {
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
  });

  it("names no coordinate at all for a section Obsidian places nowhere", () => {
    expect(sectionCoordinates([citation("[@a]")], null)).toEqual([undefined]);
  });
});

describe("citationElement", () => {
  it("wraps the source text in the class themes reach", () => {
    expect(citationElement(document, "Zeta (2020)").outerHTML).toBe(
      '<span class="zt-citation">Zeta (2020)</span>',
    );
  });

  it("shows a formatted citation through the shared renderer", () => {
    const content = citationElement(document, {
      content: [
        { t: "Str", c: "Zeta" },
        { t: "Space" },
        { t: "Emph", c: [{ t: "Str", c: "(2020)" }] },
      ],
      citations: [],
    });

    expect(content.outerHTML).toBe(
      '<span class="zt-citation">Zeta <em>(2020)</em></span>',
    );
  });
});
