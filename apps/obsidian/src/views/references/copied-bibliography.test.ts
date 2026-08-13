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
