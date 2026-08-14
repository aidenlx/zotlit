// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import type { Attr, Inline, Inlines } from "@/services/pandoc/ast";

import { toCopiedBibliography } from "./copied-bibliography";
import type { CopiedBibliographyEntry } from "./copied-bibliography";

const NO_ATTR: Attr = ["", [], []];

/** One run of text as the flow a style writes it in: words, spaces apart. */
function words(text: string): Inlines {
  const flow: Inline[] = [];
  for (const [index, word] of text.split(" ").entries()) {
    if (index > 0) flow.push({ t: "Space" });
    if (word) flow.push({ t: "Str", c: word });
  }
  return flow;
}

function emph(text: string): Inline {
  return { t: "Emph", c: words(text) };
}

function link(text: string, url: string): Inline {
  return { t: "Link", c: [NO_ATTR, words(text), [url, ""]] };
}

function span(classes: readonly string[], content: Inlines): Inline {
  return { t: "Span", c: [["", classes, []], content] };
}

function note(text: string): Inline {
  return { t: "Note", c: [{ t: "Para", c: words(text) }] };
}

function entry(content: Inlines, marker?: Inlines): CopiedBibliographyEntry {
  return { marker, content };
}

describe("toCopiedBibliography", () => {
  it("separates author-date entries with a blank line and adds no heading", () => {
    const { text } = toCopiedBibliography([
      entry([
        ...words("Rivers, A. (2020). "),
        emph("Field notes"),
        ...words(". Harbour Press."),
      ]),
      entry([
        ...words("Stone, B. (2018). "),
        emph("Tidal margins"),
        ...words(". Harbour Press."),
      ]),
    ]);

    expect(text).toBe(
      "Rivers, A. (2020). Field notes. Harbour Press.\n\n" +
        "Stone, B. (2018). Tidal margins. Harbour Press.",
    );
  });

  it("keeps the Entry Markers and the bibliography order of a numeric style", () => {
    const { text } = toCopiedBibliography([
      entry(
        [
          ...words("Stone, B. "),
          emph("Tidal margins"),
          ...words(". Harbour Press, 2018."),
        ],
        words("[1]"),
      ),
      entry(
        [
          ...words("Rivers, A. "),
          emph("Field notes"),
          ...words(". Harbour Press, 2020."),
        ],
        words("[2]"),
      ),
    ]);

    expect(text).toBe(
      "[1] Stone, B. Tidal margins. Harbour Press, 2018.\n\n" +
        "[2] Rivers, A. Field notes. Harbour Press, 2020.",
    );
  });

  it("reads the visible text of inline CSL semantics", () => {
    const { text } = toCopiedBibliography([
      entry([
        ...words("Rivers, A. "),
        { t: "Str", c: "H" },
        { t: "Subscript", c: words("2") },
        { t: "Str", c: "O" },
        ...words(" at 10"),
        { t: "Superscript", c: words("3") },
        ...words(" m, "),
        { t: "SmallCaps", c: words("ii") },
        { t: "Str", c: "." },
      ]),
    ]);

    expect(text).toBe("Rivers, A. H2O at 103 m, ii.");
  });

  it("collapses the layout a style lays an entry out across", () => {
    const { text } = toCopiedBibliography([
      entry(
        [
          span(["csl-block"], words("Rivers, A.")),
          span(["csl-indent"], [emph("Field notes"), { t: "Str", c: "." }]),
        ],
        words("1."),
      ),
    ]);

    expect(text).toBe("1. Rivers, A. Field notes.");
  });

  it("keeps non-ASCII text and the spacing a style chose", () => {
    const { text } = toCopiedBibliography([
      entry(words("李四. 《潮汐边缘》. 港口出版社, 2018.")),
      entry([
        { t: "Str", c: "Rivers, A." },
        ...words(" — "),
        emph("Field notes"),
        { t: "Str", c: "." },
      ]),
    ]);

    expect(text).toBe(
      "李四. 《潮汐边缘》. 港口出版社, 2018.\n\nRivers, A. — Field notes.",
    );
  });

  it("carries no Entry Serial for a style that writes its citations as notes", () => {
    const { text } = toCopiedBibliography([
      entry([...words("Rivers, A. (2020). Field notes."), note("Ibid., 12.")]),
    ]);

    expect(text).toBe("Rivers, A. (2020). Field notes.");
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
      entry([
        ...words("Rivers, A. (2020). "),
        emph("Field notes"),
        ...words(". Harbour Press."),
      ]),
      entry([
        ...words("Stone, B. (2018). "),
        emph("Tidal margins"),
        ...words(". Harbour Press."),
      ]),
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
      entry(
        words("Stone, B. Tidal margins. Harbour Press, 2018."),
        words("[1]"),
      ),
      entry(
        words("Rivers, A. Field notes. Harbour Press, 2020."),
        words("[2]"),
      ),
    ]);

    expect(paragraphs(html).map((p) => p.textContent)).toEqual([
      "[1] Stone, B. Tidal margins. Harbour Press, 2018.",
      "[2] Rivers, A. Field notes. Harbour Press, 2020.",
    ]);
  });

  it("keeps the inline CSL semantics a style rendered", () => {
    const { html } = toCopiedBibliography([
      entry([
        ...words("Rivers, A. "),
        emph("H"),
        { t: "Subscript", c: words("2") },
        { t: "Str", c: "O" },
        ...words(" at 10"),
        { t: "Superscript", c: words("3") },
        ...words(" m, "),
        { t: "SmallCaps", c: words("ii") },
        ...words(". "),
        link("https://doi.org/10.1000/182", "https://doi.org/10.1000/182"),
      ]),
    ]);
    const [rendered] = paragraphs(html);

    expect(rendered!.querySelector("em")?.textContent).toBe("H");
    expect(rendered!.querySelector("sub")?.textContent).toBe("2");
    expect(rendered!.querySelector("sup")?.textContent).toBe("3");
    expect(
      rendered!.querySelector("span")?.style.getPropertyValue("font-variant"),
    ).toBe("small-caps");
    expect(rendered!.querySelector("a")?.getAttribute("href")).toBe(
      "https://doi.org/10.1000/182",
    );
  });

  it("writes a strikeout as the element pandoc's own writer gives it", () => {
    const { html } = toCopiedBibliography([
      entry([
        { t: "Strikeout", c: words("Retracted") },
        ...words(". Rivers, A. (2020)."),
      ]),
    ]);
    const [rendered] = paragraphs(html);

    expect(rendered!.querySelector("del")?.textContent).toBe("Retracted");
    expect(rendered!.textContent).toBe("Retracted. Rivers, A. (2020).");
  });

  it("carries the styling of a CSL semantic and no markup of its own", () => {
    const { html } = toCopiedBibliography([
      entry([
        span(["nocase"], [{ t: "SmallCaps", c: words("ii") }]),
        ...words(" Field notes."),
      ]),
    ]);
    const [rendered] = paragraphs(html);
    const semantic = rendered!.querySelector("span")!;

    expect(semantic.getAttributeNames()).toEqual(["style"]);
    expect(semantic.style.getPropertyValue("font-variant")).toBe("small-caps");
    expect(rendered!.textContent).toBe("ii Field notes.");
  });

  it("keeps a link's text and drops a target no destination should follow", () => {
    const { html } = toCopiedBibliography([
      entry([
        link("Field notes", "javascript:alert(1)"),
        ...words(", "),
        link("Tidal margins", "/vault/notes/tidal.md"),
        ...words(", "),
        link("Rivers, A.", "mailto:rivers@example.org"),
      ]),
    ]);
    const [rendered] = paragraphs(html);

    expect(
      [...rendered!.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    ).toEqual(["mailto:rivers@example.org"]);
    expect(rendered!.textContent).toBe(
      "Field notes, Tidal margins, Rivers, A.",
    );
  });

  it("keeps the punctuation and non-ASCII text of an entry", () => {
    const { html } = toCopiedBibliography([
      entry(words("李四. 《潮汐边缘》. 港口出版社, 2018.")),
      entry([
        ...words("Rivers, A. — "),
        { t: "Emph", c: words("Field & notes") },
        { t: "Str", c: "." },
      ]),
    ]);

    expect(paragraphs(html).map((p) => p.textContent)).toEqual([
      "李四. 《潮汐边缘》. 港口出版社, 2018.",
      "Rivers, A. — Field & notes.",
    ]);
  });

  it("writes an entry's text as text, whatever a style put in it", () => {
    const { html } = toCopiedBibliography([
      entry(words("Rivers, A. <script>alert(1)</script> & Co.")),
    ]);

    expect(html).not.toContain("<script>");
    expect(paragraphs(html)[0]!.textContent).toBe(
      "Rivers, A. <script>alert(1)</script> & Co.",
    );
  });

  it("carries no Entry Serial for a style that writes its citations as notes", () => {
    const { html } = toCopiedBibliography([
      entry([...words("Rivers, A. (2020). Field notes."), note("Ibid., 12.")]),
    ]);

    expect(paragraphs(html)[0]!.textContent).toBe(
      "Rivers, A. (2020). Field notes.",
    );
  });

  it("returns nothing for an empty bibliography", () => {
    expect(toCopiedBibliography([]).html).toBe("");
  });
});
