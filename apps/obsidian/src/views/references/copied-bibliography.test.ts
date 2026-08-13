// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { toCopiedBibliography } from "./copied-bibliography";
import type { CopiedBibliographyEntry } from "./copied-bibliography";

function entry(html: string, marker?: string): CopiedBibliographyEntry {
  const content = document.createDocumentFragment();
  const holder = document.createElement("div");
  holder.innerHTML = html;
  content.append(...holder.childNodes);
  return { marker, content };
}

describe("toCopiedBibliography", () => {
  it("separates author-date entries with a blank line and adds no heading", () => {
    const { text } = toCopiedBibliography([
      entry("Rivers, A. (2020). <i>Field notes</i>. Harbour Press."),
      entry("Stone, B. (2018). <i>Tidal margins</i>. Harbour Press."),
    ]);

    expect(text).toBe(
      "Rivers, A. (2020). Field notes. Harbour Press.\n\n" +
        "Stone, B. (2018). Tidal margins. Harbour Press.",
    );
  });

  it("keeps the Entry Markers and the bibliography order of a numeric style", () => {
    const { text } = toCopiedBibliography([
      entry("Stone, B. <i>Tidal margins</i>. Harbour Press, 2018.", "[1]"),
      entry("Rivers, A. <i>Field notes</i>. Harbour Press, 2020.", "[2]"),
    ]);

    expect(text).toBe(
      "[1] Stone, B. Tidal margins. Harbour Press, 2018.\n\n" +
        "[2] Rivers, A. Field notes. Harbour Press, 2020.",
    );
  });

  it("reads the visible text of inline CSL semantics", () => {
    const { text } = toCopiedBibliography([
      entry(
        "Rivers, A. <i>H<sub>2</sub>O</i> at 10<sup>3</sup> m, " +
          '<span style="font-variant: small-caps;">ii</span>.',
      ),
    ]);

    expect(text).toBe("Rivers, A. H2O at 103 m, ii.");
  });

  it("collapses the layout whitespace an entry is formatted across", () => {
    const { text } = toCopiedBibliography([
      entry("\n  Rivers, A.\n  <i>Field\n  notes</i>.\n", "1."),
    ]);

    expect(text).toBe("1. Rivers, A. Field notes.");
  });

  it("keeps non-ASCII text and the spacing a style chose", () => {
    const { text } = toCopiedBibliography([
      entry("李四. 《潮汐边缘》. 港口出版社, 2018."),
      entry("Rivers,\u00a0A. — <i>Field notes</i>."),
    ]);

    expect(text).toBe(
      "李四. 《潮汐边缘》. 港口出版社, 2018.\n\nRivers,\u00a0A. — Field notes.",
    );
  });

  it("returns nothing for an empty bibliography", () => {
    expect(toCopiedBibliography([]).text).toBe("");
  });
});

/**
 * Read the rich representation back as the destination parses it, so a test
 * states what the markup means rather than how it was serialized.
 */
function paragraphs(html: string): HTMLElement[] {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return [...holder.children] as HTMLElement[];
}

describe("toCopiedBibliography rich HTML", () => {
  it("writes one paragraph per entry and nothing above them", () => {
    const { html } = toCopiedBibliography([
      entry("Rivers, A. (2020). <i>Field notes</i>. Harbour Press."),
      entry("Stone, B. (2018). <i>Tidal margins</i>. Harbour Press."),
    ]);
    const rendered = paragraphs(html);

    expect(rendered.map((p) => p.tagName)).toEqual(["P", "P"]);
    expect(rendered.map((p) => p.textContent)).toEqual([
      "Rivers, A. (2020). Field notes. Harbour Press.",
      "Stone, B. (2018). Tidal margins. Harbour Press.",
    ]);
  });

  it("keeps the Entry Markers and the bibliography order of a numeric style", () => {
    const { html } = toCopiedBibliography([
      entry("Stone, B. <i>Tidal margins</i>. Harbour Press, 2018.", "[1]"),
      entry("Rivers, A. <i>Field notes</i>. Harbour Press, 2020.", "[2]"),
    ]);

    expect(paragraphs(html).map((p) => p.textContent)).toEqual([
      "[1] Stone, B. Tidal margins. Harbour Press, 2018.",
      "[2] Rivers, A. Field notes. Harbour Press, 2020.",
    ]);
  });

  it("keeps the inline CSL semantics a style rendered", () => {
    const { html } = toCopiedBibliography([
      entry(
        "Rivers, A. <i>H<sub>2</sub>O</i> at 10<sup>3</sup> m, " +
          '<span style="font-variant: small-caps;">ii</span>. ' +
          '<a href="https://doi.org/10.1000/182">https://doi.org/10.1000/182</a>',
      ),
    ]);
    const [rendered] = paragraphs(html);

    expect(rendered!.querySelector("i")?.textContent).toBe("H2O");
    expect(rendered!.querySelector("sub")?.textContent).toBe("2");
    expect(rendered!.querySelector("sup")?.textContent).toBe("3");
    expect(
      rendered!.querySelector("span")?.style.getPropertyValue("font-variant"),
    ).toBe("small-caps");
    expect(rendered!.querySelector("a")?.getAttribute("href")).toBe(
      "https://doi.org/10.1000/182",
    );
  });

  it("carries the styling of a CSL semantic and no markup of its own", () => {
    const { html } = toCopiedBibliography([
      entry(
        '<span class="nocase" id="ref-tidal" style="font-variant: small-caps;">ii</span>' +
          ' <mark class="zt-hit">Field notes</mark>.',
      ),
    ]);
    const [rendered] = paragraphs(html);
    const semantic = rendered!.querySelector("span")!;

    expect(semantic.getAttributeNames()).toEqual(["style"]);
    expect(semantic.style.getPropertyValue("font-variant")).toBe("small-caps");
    expect(rendered!.querySelector("mark")).toBeNull();
    expect(rendered!.textContent).toBe("ii Field notes.");
  });

  it("keeps a link's text and drops a target no destination should follow", () => {
    const { html } = toCopiedBibliography([
      entry(
        '<a href="javascript:alert(1)">Field notes</a>, ' +
          '<a href="/vault/notes/tidal.md">Tidal margins</a>, ' +
          '<a href="mailto:rivers@example.org">Rivers, A.</a>',
      ),
    ]);
    const [rendered] = paragraphs(html);

    expect(
      [...rendered!.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    ).toEqual([null, null, "mailto:rivers@example.org"]);
    expect(rendered!.textContent).toBe(
      "Field notes, Tidal margins, Rivers, A.",
    );
  });

  it("keeps the punctuation and non-ASCII text of an entry", () => {
    const { html } = toCopiedBibliography([
      entry("李四. 《潮汐边缘》. 港口出版社, 2018."),
      entry("Rivers, A. — <i>Field &amp; notes</i>."),
    ]);

    expect(paragraphs(html).map((p) => p.textContent)).toEqual([
      "李四. 《潮汐边缘》. 港口出版社, 2018.",
      "Rivers, A. — Field & notes.",
    ]);
  });

  it("returns nothing for an empty bibliography", () => {
    expect(toCopiedBibliography([]).html).toBe("");
  });
});
