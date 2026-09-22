// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  activeFormats,
  clearFormatting,
  htmlToComment,
  parseComment,
  toggleFormat,
} from "./comment-format";

/** `[` and `]` mark the selection; one `|` marks a caret. */
function sel(marked: string) {
  const caret = marked.indexOf("|");
  if (caret >= 0) {
    return {
      text: marked.replace("|", ""),
      selection: { anchor: caret, head: caret },
    };
  }
  const from = marked.indexOf("[");
  const to = marked.indexOf("]") - 1;
  return {
    text: marked.replace("[", "").replace("]", ""),
    selection: { anchor: from, head: to },
  };
}

function mark(edit: { text: string; anchor: number; head: number }) {
  const { text, anchor, head } = edit;
  if (anchor === head) return `${text.slice(0, anchor)}|${text.slice(anchor)}`;
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  return `${text.slice(0, from)}[${text.slice(from, to)}]${text.slice(to)}`;
}

describe("parseComment", () => {
  it("reads nested pairs, outer before inner", () => {
    expect(
      parseComment("a<b>x<i>y</i></b>").map((s) => [s.format, s.from, s.to]),
    ).toEqual([
      ["b", 1, 17],
      ["i", 5, 13],
    ]);
  });

  it("keeps an unmatched or crossing tag as text, as Zotero does", () => {
    // Zotero takes `<b>…</b>` first; the `<i>` inside has no `</i>` before
    // the bold ends, so both `<i>` and the trailing `</i>` stay literal.
    expect(parseComment("<b>a<i>b</b>c</i>").map((s) => s.format)).toEqual([
      "b",
    ]);
    expect(parseComment("x <sup>2 y")).toEqual([]);
  });

  it("matches tags in any case", () => {
    expect(parseComment("<B>x</B>").map((s) => s.format)).toEqual(["b"]);
  });
});

describe("toggleFormat", () => {
  it("wraps a plain selection", () => {
    const { text, selection } = sel("H[2]O");
    expect(mark(toggleFormat(text, selection, "sub"))).toBe("H<sub>[2]</sub>O");
  });

  it("removes a format the whole selection carries, splitting the pair", () => {
    const { text, selection } = sel("<b>ab[c]de</b>");
    expect(mark(toggleFormat(text, selection, "b"))).toBe(
      "<b>ab</b>[c]<b>de</b>",
    );
  });

  it("extends a pair the selection only partly covers", () => {
    const { text, selection } = sel("<i>ab[c</i>de]");
    expect(mark(toggleFormat(text, selection, "i"))).toBe("<i>ab[cde]</i>");
  });

  it("keeps other formats while adding one", () => {
    const { text, selection } = sel("[a<i>b</i>]");
    expect(mark(toggleFormat(text, selection, "b"))).toBe("<b>[a<i>b]</i></b>");
  });

  it("opens an empty pair at a bare caret", () => {
    const { text, selection } = sel("x|y");
    expect(mark(toggleFormat(text, selection, "sup"))).toBe("x<sup>|</sup>y");
  });

  it("unwraps the pair a caret stands in", () => {
    const { text, selection } = sel("a<b>b|c</b>d");
    expect(mark(toggleFormat(text, selection, "b"))).toBe("ab|cd");
  });

  it("leaves text outside the selection as it was", () => {
    const { text, selection } = sel("<sub>1</sub> [x] <sup>2</sup>");
    expect(toggleFormat(text, selection, "i").text).toBe(
      "<sub>1</sub> <i>x</i> <sup>2</sup>",
    );
  });
});

describe("clearFormatting", () => {
  it("drops every format in a range", () => {
    const { text, selection } = sel("<b>a[b<i>c</i>]</b>");
    expect(mark(clearFormatting(text, selection))).toBe("<b>a</b>[bc]");
  });

  it("unwraps every pair around a caret", () => {
    const { text, selection } = sel("<b><i>a|</i></b>b");
    expect(mark(clearFormatting(text, selection))).toBe("a|b");
  });
});

describe("activeFormats", () => {
  it("names formats every selected character carries", () => {
    const { text, selection } = sel("<b>[a<i>b</i>]</b>");
    expect([...activeFormats(text, selection.anchor, selection.head)]).toEqual([
      "b",
    ]);
  });

  it("names the pairs a caret stands in", () => {
    const { text, selection } = sel("<b><sub>a|</sub></b>");
    expect(
      [...activeFormats(text, selection.anchor, selection.head)].sort(),
    ).toEqual(["b", "sub"]);
  });
});

describe("htmlToComment", () => {
  const parse = (html: string) =>
    new DOMParser().parseFromString(html, "text/html").body;

  it("keeps the four formats and maps strong and em", () => {
    expect(
      htmlToComment(
        parse(
          '<p>H<sub>2</sub>O is <strong class="x">very</strong> <em>wet</em></p>',
        ),
      ),
    ).toBe("H<sub>2</sub>O is <b>very</b> <i>wet</i>");
  });

  it("turns breaks and blocks into single line breaks", () => {
    expect(
      htmlToComment(
        parse("<div>one<br>two</div>\n  <p>three</p><ul><li>four</li></ul>"),
      ),
    ).toBe("one\ntwo\nthree\nfour");
  });

  it("drops links, scripts, and whitespace-only pairs", () => {
    expect(
      htmlToComment(
        parse('<a href="x">link</a><script>bad()</script><b> </b>end'),
      ),
    ).toBe("link end");
  });
});
