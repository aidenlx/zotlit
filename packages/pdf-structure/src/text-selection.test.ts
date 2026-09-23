import { describe, expect, it } from "vitest";

import type { StructuredChar, StructuredPage } from "@/chars";
import { offsetsByRects, selectText, textRange } from "@/text-selection";
import type { TextLayerSelection } from "@/text-selection";

type Flags = Pick<
  StructuredChar,
  "ignorable" | "lineBreakAfter" | "paragraphBreakAfter" | "spaceAfter"
>;

/**
 * One line of Structured Characters as the line grouping leaves them: glyphs
 * 5 pt wide from `x`, a word break at every space of `text`, and a line break
 * after the last glyph. `inlineRect` is taller than `rect`, as a line's is.
 */
function line(
  text: string,
  { x = 100, y = 700, last = {} as Flags } = {},
): Partial<StructuredChar>[] {
  const chars: Partial<StructuredChar>[] = [];
  let at = x;
  for (const c of text) {
    if (c === " ") {
      chars.at(-1)!.spaceAfter = true;
      at += 5;
      continue;
    }
    chars.push({
      c,
      rect: [at, y, at + 5, y + 8],
      inlineRect: [at, y - 1, at + 5, y + 9],
      rotation: 0,
    });
    at += 5;
  }
  Object.assign(chars.at(-1)!, { lineBreakAfter: true }, last);
  return chars;
}

function page(
  pageIndex: number,
  ...lines: Partial<StructuredChar>[][]
): StructuredPage {
  return {
    pageIndex,
    viewBox: [0, 0, 612, 792],
    chars: lines
      .flat()
      .map(
        (char, offset) => ({ offset, pageIndex, ...char }) as StructuredChar,
      ),
  };
}

/** A hyphen the line grouping marked as a discretionary line-end one. */
const hyphenated = (text: string, y: number) =>
  line(text, { y, last: { ignorable: true } as Flags });

function layer(
  pageIndex: number,
  layerText: string,
  selected: string | null,
): TextLayerSelection {
  if (selected === null) {
    return { pageIndex, layerText, start: null, end: null, rects: [] };
  }
  const start = layerText.indexOf(selected);
  return {
    pageIndex,
    layerText,
    start,
    end: start + selected.length,
    rects: [],
  };
}

const pagesOf = (...pages: StructuredPage[]) =>
  new Map(pages.map((one) => [one.pageIndex, one]));

describe("a range of Structured Characters", () => {
  const { chars } = page(0, line("the quick"), line("brown fox", { y: 690 }));

  it("draws one rectangle per line, the union of the line boxes", () => {
    // "quick" is chars 3–7, "brown" chars 8–12.
    expect(textRange(chars, 3, 13).rects).toEqual([
      [120, 699, 145, 709],
      [100, 689, 125, 699],
    ]);
  });

  it("puts a space at a line end and after a word", () => {
    expect(textRange(chars, 0, 16).text).toBe("the quick brown fox");
  });

  it("reads the same range from either end", () => {
    expect(textRange(chars, 13, 3)).toEqual(textRange(chars, 3, 13));
  });

  it("is empty when both ends meet", () => {
    expect(textRange(chars, 4, 4)).toEqual({ rects: [], text: "" });
  });

  it("drops a discretionary hyphen from the text but not from the rects", () => {
    const { chars: hyphen } = page(
      0,
      hyphenated("impor-", 700),
      line("tant", { y: 690 }),
    );

    const range = textRange(hyphen, 0, hyphen.length);

    expect(range.text).toBe("important");
    expect(range.rects).toEqual([
      [100, 699, 130, 709],
      [100, 689, 120, 699],
    ]);
  });

  it("rounds every coordinate to three decimals, as Zotero writes them", () => {
    const [char] = page(0, line("a")).chars;
    const precise = [
      { ...char!, inlineRect: [1.23456, 2.00049, 3.1, 4.9999] as const },
    ];

    expect(textRange(precise, 0, 1).rects).toEqual([[1.235, 2, 3.1, 5]]);
  });
});

describe("the characters under a highlight's rectangles", () => {
  const { chars } = page(0, line("the quick"), line("brown fox", { y: 690 }));

  it("runs from the first centre in the first rect to the last in the last", () => {
    expect(
      offsetsByRects(chars, [
        [118, 698, 146, 710],
        [99, 688, 126, 700],
      ]),
    ).toEqual({ from: 3, to: 13 });
  });

  it("finds nothing where no centre falls inside", () => {
    expect(offsetsByRects(chars, [[300, 300, 310, 310]])).toBeNull();
  });
});

describe("a DOM text selection mapped onto the page's characters", () => {
  it("quotes and draws one line", () => {
    const pages = pagesOf(page(0, line("the quick brown fox")));

    expect(
      selectText(
        {
          text: "quick brown",
          pages: [layer(0, "the quick brown fox", "quick brown")],
        },
        pages,
      ),
    ).toEqual({
      pageIndex: 0,
      rects: [[120, 699, 175, 709]],
      text: "quick brown",
    });
  });

  it("puts the space back across a line break the text layer glued", () => {
    // PDF.js puts a line's text in its own span with nothing between the
    // spans, so the DOM reads "thisprocess".
    const pages = pagesOf(
      page(0, line("do this"), line("process", { y: 690 })),
    );

    const selected = selectText(
      {
        text: "this\nprocess",
        pages: [layer(0, "do thisprocess", "thisprocess")],
      },
      pages,
    );

    expect(selected?.text).toBe("this process");
    expect(selected?.rects).toHaveLength(2);
  });

  it("drops a line-end hyphen the text layer keeps", () => {
    const pages = pagesOf(
      page(0, hyphenated("impor-", 700), line("tant role", { y: 690 })),
    );

    const selected = selectText(
      {
        text: "impor-\ntant",
        pages: [layer(0, "impor-tant role", "impor-tant")],
      },
      pages,
    );

    expect(selected?.text).toBe("important");
  });

  it("spills onto the next page as nextPageRects, the text joined by one space", () => {
    const pages = pagesOf(
      page(0, line("end of one")),
      page(1, line("start of two")),
    );

    const selected = selectText(
      {
        text: "of one\nstart",
        pages: [
          { ...layer(0, "end of one", "of one"), end: null },
          { ...layer(1, "start of two", "start"), start: null },
        ],
      },
      pages,
    );

    expect(selected).toEqual({
      pageIndex: 0,
      rects: [[120, 699, 150, 709]],
      nextPageRects: [[100, 699, 125, 709]],
      text: "of one start",
    });
  });

  it("keeps the first two pages of a longer selection", () => {
    const pages = pagesOf(
      page(0, line("one")),
      page(1, line("two")),
      page(2, line("three")),
    );

    const selected = selectText(
      {
        text: "one two three",
        pages: [0, 1, 2].map((pageIndex) =>
          layer(pageIndex, ["one", "two", "three"][pageIndex]!, null),
        ),
      },
      pages,
    );

    expect(selected?.text).toBe("one two");
    expect(selected?.nextPageRects).toHaveLength(1);
  });

  it("leaves out a page the selection only touches past its last character", () => {
    const pages = pagesOf(page(0, line("one")), page(1, line("two")));

    const selected = selectText(
      {
        text: "two",
        pages: [
          { ...layer(0, "one", "one"), start: 3, end: null },
          { ...layer(1, "two", "two"), start: null },
        ],
      },
      pages,
    );

    expect(selected).toEqual({
      pageIndex: 1,
      rects: [[100, 699, 115, 709]],
      text: "two",
    });
  });

  it("falls back to the selection's boxes when the text layer disagrees", () => {
    // A text layer that shares no run with the page's characters: the
    // alignment walks it one for one, and the text check rejects the result.
    const pages = pagesOf(page(0, line("the quick brown fox")));

    const selected = selectText(
      {
        text: "quick",
        pages: [
          {
            pageIndex: 0,
            layerText: "zzzzzzzzzzzzzzzz",
            start: 0,
            end: 5,
            rects: [[119, 698, 146, 710]],
          },
        ],
      },
      pages,
    );

    expect(selected?.text).toBe("quick");
    expect(selected?.rects).toEqual([[120, 699, 145, 709]]);
  });

  it("refuses a selection neither the text nor the boxes can place", () => {
    const pages = pagesOf(page(0, line("the quick brown fox")));

    expect(
      selectText(
        {
          text: "lorem",
          pages: [
            { ...layer(0, "lorem", "lorem"), rects: [[119, 698, 146, 710]] },
          ],
        },
        pages,
      ),
    ).toBeNull();
  });

  it("places nothing on a page it has no characters for", () => {
    expect(
      selectText(
        { text: "quick", pages: [layer(3, "the quick", "quick")] },
        pagesOf(page(0, line("the quick"))),
      ),
    ).toBeNull();
  });
});
