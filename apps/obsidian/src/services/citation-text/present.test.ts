// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { scanCitations } from "@/lib/citation-grammar";

import { citationContent, citationElement, citedWorks } from "./present";
import type { CitationSource } from "./present";

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
  it("keeps source presentation when no complete formatted result exists", () => {
    expect(
      citationContent(citation("[see @a, p. 3]"), {
        formatted: new Map(),
        summaries: new Map([["a", "Zeta (2020)"]]),
      }),
    ).toBeNull();
  });
});

describe("citationElement", () => {
  it("wraps the formatted text in the class themes reach", () => {
    expect(citationElement(document, "Zeta (2020)").outerHTML).toBe(
      '<span class="zt-citation">Zeta (2020)</span>',
    );
  });
});
