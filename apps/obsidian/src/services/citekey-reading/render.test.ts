// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  citationElement,
  citationTarget,
  citedWorks,
  replaceCitations,
  sectionCitations,
  summarizeCitation,
  type SectionCitation,
} from "./render";

/** One rendered section, as a Markdown post-processor receives it. */
function section(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

/** Puts the citekeys of every citation in its place, so the swap is readable. */
function keysInPlace(root: HTMLElement): string {
  replaceCitations(sectionCitations(root), (citation) =>
    citationElement(
      document,
      citation.keys.map((key) => key.citekey).join("+"),
    ),
  );
  return root.textContent ?? "";
}

describe("sectionCitations", () => {
  it("reads a cluster whole and a bare key on its own", () => {
    expect(
      sectionCitations(section("<p>Blah [see @a, p. 3; @b] and @c.</p>")).map(
        (citation) => citation.source,
      ),
    ).toEqual(["[see @a, p. 3; @b]", "@c"]);
  });

  it("leaves code blocks, inline code, and math alone", () => {
    const root = section(
      "<pre><code>@fenced</code></pre>" +
        "<p>text <code>@inline</code> and " +
        '<span class="math">@math</span> and @real</p>',
    );
    expect(sectionCitations(root).map((citation) => citation.source)).toEqual([
      "@real",
    ]);
  });

  it("leaves a wikilink to Obsidian", () => {
    const root = section(
      '<p><a class="internal-link" href="#">@doe2024</a> and @doe2024</p>',
    );
    expect(sectionCitations(root)).toHaveLength(1);
  });

  it("keeps each key at its offset within the citation's own source", () => {
    const [citation] = sectionCitations(section("<p>x [see @a; @b] y</p>"));
    expect(citation?.keys).toEqual([
      { citekey: "a", start: 5, end: 7 },
      { citekey: "b", start: 9, end: 11 },
    ]);
  });
});

describe("replaceCitations", () => {
  it("replaces every citation of one text node", () => {
    expect(
      keysInPlace(section("<p>Blah [see @a; @b] and @c said so.</p>")),
    ).toBe("Blah a+b and c said so.");
  });

  it("keeps the text that surrounds a citation", () => {
    const root = section("<p>before @a after</p>");
    keysInPlace(root);
    expect(root.querySelector("span.zt-citation")?.textContent).toBe("a");
    expect(root.innerHTML).toBe(
      '<p>before <span class="zt-citation">a</span> after</p>',
    );
  });

  it("leaves a citation the formatter has no answer for", () => {
    const root = section("<p>@a and @b</p>");
    replaceCitations(sectionCitations(root), (citation) =>
      citation.source === "@a" ? citationElement(document, "!") : null,
    );
    expect(root.textContent).toBe("! and @b");
  });
});

const citation = (source: string): SectionCitation =>
  sectionCitations(section(`<p>${source}</p>`))[0]!;

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

describe("citationTarget", () => {
  const works = (source: string) =>
    citedWorks(citation(source), (key) => `Work ${key}`);

  it("opens the one work a single-key citation names", () => {
    expect(citationTarget(works("[see @a, p. 3]"))).toEqual({
      resolution: "open-or-create",
      citekey: "a",
    });
  });

  it("asks which work a multi-key citation means", () => {
    expect(citationTarget(works("[@a; @b]"))).toEqual({
      resolution: "citation-menu",
      citekeys: ["a", "b"],
    });
  });

  it("leaves a citation naming no work inert", () => {
    expect(citationTarget([])).toEqual({ resolution: "unavailable" });
  });
});

describe("summarizeCitation", () => {
  it("puts each key's summary in its place, keeping what the author wrote", () => {
    expect(
      summarizeCitation(citation("[see @a, p. 3; -@b]"), (key) =>
        key === "a" ? "Zeta (2020)" : "Adams (2018)",
      ),
    ).toBe("[see Zeta (2020), p. 3; Adams (2018)]");
  });

  it("leaves a key that reaches no item as written", () => {
    expect(
      summarizeCitation(citation("[@a; @b]"), (key) =>
        key === "a" ? "Zeta (2020)" : undefined,
      ),
    ).toBe("[Zeta (2020); @b]");
  });

  it("answers nothing when no key resolves", () => {
    expect(summarizeCitation(citation("[@a; @b]"), () => undefined)).toBeNull();
  });
});
