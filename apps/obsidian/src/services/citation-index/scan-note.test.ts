// Adapted payloads from quartz-community/remark-obsidian, with each case ID below.
// Source: https://github.com/quartz-community/remark-obsidian/blob/a80395a3d80f351e67a0afdb63b51a604e010c8e/test/parity/corpus.ts
import { expect, it } from "vitest";

import { scanNote } from "./scan-note";
import type { NoteScanRecord } from "./scan-note";

const empty: Omit<NoteScanRecord, "links" | "ranges"> = {
  citations: [],
  citekeys: [],
  wikilinks: [],
  malformedWikilinks: [],
  annotations: [],
  malformedAnnotationCitations: [],
};
const uri = "zotero://open/library/items/ABCD2345?annotation=EFGH6789";
const annotation = {
  text: "",
  indexedKey: "EFGH6789",
  attachmentKey: "ABCD2345",
  pageLabel: null,
};
const hidden = `[@k] [[Note]] [[Note#cite:]] [](${uri}) [](zotero://open/bad)`;

// All coordinates are worked literals in UTF-16, independent of the scanner.
const pos = (from: number, to: number) => ({
  start: { line: 0, col: from, offset: from },
  end: { line: 0, col: to, offset: to },
});

const afterLink = (line: number, col: number, offset: number) => ({
  kind: "wikilink" as const,
  raw: "After",
  position: {
    start: { line, col, offset },
    end: { line, col: col + 9, offset: offset + 9 },
  },
});

// Every row below is a #1689 case. Wrong forms, lost group identity, and shifted
// source positions are the failure modes at this text-in / record-out seam.
// A row whose hidden region has an end carries a visible [[After]] tail, so it
// proves the region ends as well as that it hides.
const conformance: {
  name: string;
  text: string;
  record: Partial<NoteScanRecord>;
}[] = [
  // remark-obsidian/test/parity/corpus.ts: probe/math-marker/dash-then-opener.
  {
    name: "unclosed display math in a list item ends at the list boundary",
    text: "- $$x\n  [[Note]]\n\n[[After]]",
    record: {
      wikilinks: [
        {
          kind: "wikilink",
          raw: "Note",
          position: {
            start: { line: 1, col: 2, offset: 8 },
            end: { line: 1, col: 10, offset: 16 },
          },
        },
        {
          kind: "wikilink",
          raw: "After",
          position: {
            start: { line: 3, col: 0, offset: 18 },
            end: { line: 3, col: 9, offset: 27 },
          },
        },
      ],
    },
  },
  // remark-obsidian/test/parity/corpus.ts: probe/math-unclosed/callout-title.
  {
    name: "unclosed display math in a callout body ends with the callout",
    text: "> [!note]\n> $$x\n> [[Note]]\n\n[[After]]",
    record: {
      wikilinks: [
        {
          kind: "wikilink",
          raw: "Note",
          position: {
            start: { line: 2, col: 2, offset: 18 },
            end: { line: 2, col: 10, offset: 26 },
          },
        },
        {
          kind: "wikilink",
          raw: "After",
          position: {
            start: { line: 4, col: 0, offset: 28 },
            end: { line: 4, col: 9, offset: 37 },
          },
        },
      ],
    },
  },
  // remark-obsidian/test/parity/corpus.ts: comment/inline.
  {
    name: "a comment inside an Annotation embed label leaves the embed visible",
    text: `![%%hidden%%](${uri})`,
    record: {
      annotations: [
        {
          ...annotation,
          form: "embed",
          text: "%%hidden%%",
          position: pos(0, 71),
        },
      ],
    },
  },
  // remark-obsidian/test/parity/corpus.ts: probe/math-unclosed/quote-same-line.
  {
    name: "a fence after an unclosed math opener in a quote still opens code",
    text: "> $$x\n> ```\n> [[Note]]\n\n[[After]]",
    record: {
      wikilinks: [
        {
          kind: "wikilink",
          raw: "After",
          position: {
            start: { line: 4, col: 0, offset: 24 },
            end: { line: 4, col: 9, offset: 33 },
          },
        },
      ],
    },
  },
  // remark-obsidian/test/parity/corpus.ts: math/in-blockquote.
  {
    name: "display math in a quote continues across a bare quote marker",
    text: "> $$x\n>\n> [[Note]]\n> $$\n\n[[After]]",
    record: {
      wikilinks: [
        {
          kind: "wikilink",
          raw: "After",
          position: {
            start: { line: 5, col: 0, offset: 25 },
            end: { line: 5, col: 9, offset: 34 },
          },
        },
      ],
    },
  },
  // remark-obsidian/test/parity/corpus.ts: probe/cross/highlight-wikilink.
  {
    name: "a highlight crossing a Wikilink opener leaves no Wikilink",
    text: "==a[[b==c]]\n",
    record: {},
  },
  // remark-obsidian/test/parity/corpus.ts: probe/label-wikilink/after-plain-bracket.
  {
    name: "a double bracket after a bracketed label is a reference label, not a Wikilink",
    text: "a [x][[w]] b\n",
    record: {},
  },
  // remark-obsidian/test/parity/corpus.ts: probe/footnote-embed/ref-wikilink.
  {
    name: "a footnote reference wrapping a Wikilink yields no Wikilink",
    text: "[^[[target]]]\n",
    record: {},
  },
  // remark-obsidian/test/parity/corpus.ts: context/footnote-definition/wikilink.
  {
    name: "a Wikilink in a footnote definition body is a Wikilink",
    text: "[^1]: [[target]]\n",
    record: {
      wikilinks: [{ kind: "wikilink", raw: "target", position: pos(6, 16) }],
    },
  },
  // remark-obsidian/test/parity/corpus.ts: math/text-after-close.
  {
    name: "a display math closer followed by text does not close the math",
    text: "Here is an equation\n$$\nx = x + 1\n$$and text after\n\n[[Test 2]]\n",
    record: {},
  },
  // remark-obsidian/test/parity/corpus.ts: probe/footnote-embed/inline-wikilink.
  {
    name: "an inline footnote around a Wikilink keeps the Wikilink",
    text: "^[[[Note]]]",
    record: {
      wikilinks: [{ kind: "wikilink", raw: "Note", position: pos(2, 10) }],
    },
  },
  // remark-obsidian/test/parity/corpus.ts: comment/inline.
  {
    name: "a comment inside a labelled Annotation link leaves the link visible",
    text: `[visible %%hidden%%](${uri})`,
    record: {
      annotations: [
        {
          ...annotation,
          form: "labelled",
          text: "visible %%hidden%%",
          position: pos(0, 78),
        },
      ],
    },
  },
  // remark-obsidian/test/parity/corpus.ts: probe/label-precedence/wikilink-inside.
  {
    name: "a Wikilink inside a link label is still a Wikilink",
    text: "[foo [[target]] bar](u)",
    record: {
      wikilinks: [{ kind: "wikilink", raw: "target", position: pos(5, 15) }],
    },
  },
  // remark-obsidian/test/parity/corpus.ts: probe/math-unclosed/quote-same-line.
  {
    name: "unclosed display math in a quote ends at the quote boundary",
    text: "> $$x\n> [[Note]]\n\n[[After]]",
    record: {
      wikilinks: [
        {
          kind: "wikilink",
          raw: "Note",
          position: {
            start: { line: 1, col: 2, offset: 8 },
            end: { line: 1, col: 10, offset: 16 },
          },
        },
        {
          kind: "wikilink",
          raw: "After",
          position: {
            start: { line: 3, col: 0, offset: 18 },
            end: { line: 3, col: 9, offset: 27 },
          },
        },
      ],
    },
  },
  // remark-obsidian/test/parity/corpus.ts: probe/math/display-same-line.
  {
    name: "an indented line after one-line display math stays paragraph text",
    text: "$$x$$ tail\n    [[Note]]",
    record: {
      wikilinks: [
        {
          kind: "wikilink",
          raw: "Note",
          position: {
            start: { line: 1, col: 4, offset: 15 },
            end: { line: 1, col: 12, offset: 23 },
          },
        },
      ],
    },
  },
  {
    name: "ATX heading before indented code",
    text: `## heading\n    ${hidden}\n\n[[After]]`,
    record: { wikilinks: [afterLink(3, 0, 128)] },
  },
  {
    name: "setext underline before indented code",
    text: `heading\n===\n    ${hidden}\n\n[[After]]`,
    record: { wikilinks: [afterLink(4, 0, 129)] },
  },
  {
    name: "horizontal rule before indented code",
    text: `***\n    ${hidden}\n\n[[After]]`,
    record: { wikilinks: [afterLink(3, 0, 121)] },
  },
  {
    name: "annotation embed inside a Markdown link",
    text: `[![quote](${uri})](https://example.org)`,
    record: {
      annotations: [
        { ...annotation, form: "embed", text: "quote", position: pos(1, 67) },
      ],
    },
  },
  {
    name: "reference definition before indented code",
    text: `[a]: https://example.org\n    ${hidden}\n\n[[After]]`,
    record: { wikilinks: [afterLink(3, 0, 142)] },
  },
  {
    name: "visible autolink after a Markdown link and label",
    text: `[x](https://example.org) [a]: <${uri}>`,
    record: {
      annotations: [
        { ...annotation, form: "labelled", text: uri, position: pos(30, 88) },
      ],
    },
  },
  {
    name: "named character reference in link destination",
    text: "[](zotero://open/library/items/ABCD2345?page=1&amp;annotation=EFGH6789)",
    record: {
      annotations: [
        {
          ...annotation,
          pageLabel: "1",
          form: "citation",
          position: pos(0, 71),
        },
      ],
    },
  },
  {
    name: "decimal character reference in image destination",
    text: "![](zotero://open/library/items/ABCD2345?page=1&#38;annotation=EFGH6789)",
    record: {
      annotations: [
        { ...annotation, pageLabel: "1", form: "embed", position: pos(0, 72) },
      ],
    },
  },
  {
    name: "hex character reference in link destination",
    text: "[](zotero://open/library/items/ABCD2345?page=1&#x26;annotation=EFGH6789)",
    record: {
      annotations: [
        {
          ...annotation,
          pageLabel: "1",
          form: "citation",
          position: pos(0, 72),
        },
      ],
    },
  },
  {
    name: "autolink keeps character references literal",
    text: `<${uri}&page=&copy;>`,
    record: {
      annotations: [
        {
          ...annotation,
          form: "labelled",
          text: `${uri}&page=&copy;`,
          position: pos(0, 70),
        },
      ],
    },
  },
  {
    name: "escaped ampersand keeps character reference literal",
    text: `[](${uri}&page=\\&copy;)`,
    record: {
      annotations: [{ ...annotation, form: "citation", position: pos(0, 73) }],
    },
  },
  {
    name: "empty-text Annotation Citation",
    text: `[](${uri})`,
    record: {
      annotations: [{ ...annotation, form: "citation", position: pos(0, 60) }],
    },
  },
  {
    name: "escaped Markdown destination",
    text: "[](zotero\\://open/library/items/ABCD2345?annotation=EFGH6789)",
    record: {
      annotations: [{ ...annotation, form: "citation", position: pos(0, 61) }],
    },
  },
  // remark-obsidian/test/parity/corpus.ts: html/passthrough.
  {
    name: "raw HTML block",
    text: `<div>\n${hidden}\n</div>\n\n[[After]]`,
    record: { wikilinks: [afterLink(4, 0, 126)] },
  },
  {
    name: "HTML comment block",
    text: `<!--\n${hidden}\n-->\n\n[[After]]`,
    record: { wikilinks: [afterLink(4, 0, 122)] },
  },
  {
    name: "reference definition with angle-bracket destination",
    text: `[quote][a]\n\n[a]: <${uri}>`,
    record: {},
  },
  {
    name: "reference definition with destination on next line",
    text: `[quote][a]\n\n[a]:\n  <${uri}>`,
    record: {},
  },
  {
    name: "UTF-16 positions after CRLF",
    text: `😀\r\n[](${uri})`,
    record: {
      annotations: [
        {
          ...annotation,
          form: "citation",
          position: {
            start: { line: 1, col: 0, offset: 4 },
            end: { line: 1, col: 60, offset: 64 },
          },
        },
      ],
    },
  },
  // remark-obsidian/test/parity/corpus.ts: frontmatter/closing-line-trailing-text.
  // #1689 requires an exact closing delimiter; this block stays unclosed.
  {
    name: "frontmatter delimiter with trailing text stays prose",
    text: "---\nx: y\n--- [@k]",
    record: {
      citations: [
        { start: 13, end: 17, keys: [{ citekey: "k", start: 14, end: 16 }] },
      ],
      citekeys: [
        {
          kind: "citekey",
          raw: "k",
          position: {
            start: { line: 2, col: 5, offset: 14 },
            end: { line: 2, col: 7, offset: 16 },
          },
        },
      ],
    },
  },
  // Same corpus: token/wikilink/newline. An unclosed opener cannot span lines.
  { name: "wikilinks stay on one line", text: "[[a\nb]]", record: {} },
  {
    name: "angle-bracket destination",
    text: `[](<${uri}>)`,
    record: {
      annotations: [{ ...annotation, form: "citation", position: pos(0, 62) }],
    },
  },
  {
    name: "labelled Annotation Occurrence",
    text: `[p. 4](${uri})`,
    record: {
      annotations: [
        { ...annotation, form: "labelled", text: "p. 4", position: pos(0, 64) },
      ],
    },
  },
  {
    name: "whitespace-only label",
    text: `[ \t](${uri})`,
    record: {
      annotations: [
        { ...annotation, form: "labelled", text: " \t", position: pos(0, 62) },
      ],
    },
  },
  {
    name: "autolink",
    text: `<${uri}>`,
    record: {
      annotations: [
        { ...annotation, form: "labelled", text: uri, position: pos(0, 58) },
      ],
    },
  },
  {
    name: "empty image",
    text: `![](${uri})`,
    record: {
      annotations: [{ ...annotation, form: "embed", position: pos(0, 61) }],
    },
  },
  {
    name: "labelled image",
    text: `![quote](${uri})`,
    record: {
      annotations: [
        { ...annotation, form: "embed", text: "quote", position: pos(0, 66) },
      ],
    },
  },
  {
    name: "group Library and page label",
    text: "[](zotero://open/groups/42/items/ABCD2345?annotation=EFGH6789&page=iv)",
    record: {
      annotations: [
        {
          ...annotation,
          indexedKey: "EFGH6789g42",
          pageLabel: "iv",
          form: "citation",
          position: pos(0, 70),
        },
      ],
    },
  },
  { name: "bare URI", text: uri, record: {} },
  {
    name: "reference-style link",
    text: `[quote][a]\n\n[a]: ${uri}`,
    record: {},
  },
  { name: "HTML anchor", text: `<a href="${uri}">quote</a>`, record: {} },
  {
    name: "Attachment File Link with Annotation Anchor",
    text: "[](file:///paper.pdf#zt-annotation=EFGH6789)",
    record: {},
  },
  {
    name: "malformed Annotation Citation",
    text: "[](zotero://open/library/items/ABCD2345)",
    record: {
      malformedAnnotationCitations: [
        {
          destination: "zotero://open/library/items/ABCD2345",
          position: pos(0, 40),
        },
      ],
    },
  },
  {
    name: "malformed labelled link",
    text: "[ ](zotero://open/library/items/ABCD2345)",
    record: {},
  },
  {
    name: "malformed image",
    text: "![](zotero://open/library/items/ABCD2345)",
    record: {},
  },
  {
    name: "malformed autolink",
    text: "<zotero://open/library/items/ABCD2345>",
    record: {},
  },
  {
    name: "destination-less Link is Pandoc text",
    text: "[@key]",
    record: {
      citations: [
        { start: 0, end: 6, keys: [{ citekey: "key", start: 1, end: 5 }] },
      ],
      citekeys: [{ kind: "citekey", raw: "key", position: pos(1, 5) }],
    },
  },
  // remark-obsidian/test/parity/corpus.ts: probe/wikilink-destination/closer-before-paren.
  {
    name: "wikilink wins over Markdown destination",
    text: `[[a]](${uri})`,
    record: {
      wikilinks: [{ kind: "wikilink", raw: "a", position: pos(0, 5) }],
    },
  },
  {
    name: "valid Citation Fragment",
    text: "[[Note#cite:locator=4]]",
    record: {
      wikilinks: [
        {
          kind: "wikilink",
          raw: "Note",
          fragment: "locator=4",
          position: pos(0, 23),
        },
      ],
    },
  },
  {
    name: "malformed Citation Fragment",
    text: "[[Note#cite:]]",
    record: {
      malformedWikilinks: [
        { occurrence: { kind: "wikilink", raw: "Note", position: pos(0, 14) } },
      ],
    },
  },
  {
    name: "heading, block, empty path, alias and embed",
    text: "[[Note#Heading]] [[Note#^block]] [[#cite:locator=4]] [[Note|Alias]] ![[Note]]",
    record: {},
  },
  // remark-obsidian/test/parity/corpus.ts: token/wikilink/escaped-close;
  // src/lib/syntax/wikilink.ts documents that a backslash cannot escape `]]`.
  {
    name: "wikilink backslash is literal",
    text: "[[Note\\]]",
    record: {
      wikilinks: [{ kind: "wikilink", raw: "Note\\", position: pos(0, 9) }],
    },
  },
  // remark-obsidian/test/parity/corpus.ts: probe/escape/wikilink-opener.
  { name: "escaped wikilink opener", text: "\\[[Note]]", record: {} },
  // remark-obsidian/test/parity/corpus.ts: probe/wikilink-destination/paren-inside.
  {
    name: "citation inside wikilink",
    text: "[[a [@key] b]]",
    record: {
      wikilinks: [
        { kind: "wikilink", raw: "a [@key] b", position: pos(0, 14) },
      ],
    },
  },
  {
    name: "fenced code in quote",
    text: `> \`\`\`\n> ${hidden}\n> \`\`\`\n\n[[After]]`,
    record: { wikilinks: [afterLink(4, 0, 127)] },
  },
  {
    name: "fenced code in callout",
    text: `> [!note]\n> \`\`\`\n> ${hidden}\n> \`\`\`\n\n[[After]]`,
    record: { wikilinks: [afterLink(5, 0, 137)] },
  },
  {
    name: "fenced code in list",
    text: `- item\n\n  \`\`\`\n  ${hidden}\n  \`\`\`\n\n[[After]]`,
    record: { wikilinks: [afterLink(6, 0, 135)] },
  },
  {
    name: "indented code in quote",
    text: `>     ${hidden}\n\n[[After]]`,
    record: { wikilinks: [afterLink(2, 0, 119)] },
  },
  {
    name: "indented code in list",
    text: `- item\n\n      ${hidden}\n\n[[After]]`,
    record: { wikilinks: [afterLink(4, 0, 127)] },
  },
  { name: "unclosed fence", text: `\`\`\`\n${hidden}`, record: {} },
  {
    name: "inline code",
    text: `\`${hidden}\` [[After]]`,
    record: { wikilinks: [afterLink(0, 114, 114)] },
  },
  {
    name: "multiline inline code",
    text: `\`code\n${hidden}\` [[After]]`,
    record: { wikilinks: [afterLink(1, 113, 119)] },
  },
  // remark-obsidian/test/parity/corpus.ts: probe/math/wikilink-inside,
  // with the payload expanded to all occurrence forms.
  {
    name: "inline math consumes every source",
    text: `$x ${hidden}$ [[After]]`,
    record: { wikilinks: [afterLink(0, 116, 116)] },
  },
  // remark-obsidian/test/parity/corpus.ts: math/currency and probe/math/currency-pair.
  {
    name: "currency stays prose",
    text: "$5 and [@k] for $6",
    record: {
      citations: [
        { start: 7, end: 11, keys: [{ citekey: "k", start: 8, end: 10 }] },
      ],
      citekeys: [{ kind: "citekey", raw: "k", position: pos(8, 10) }],
    },
  },
  // Same corpus: probe/math/inline-padded. The leading space refuses the opener.
  {
    name: "space after dollar stays prose",
    text: "$ [@k]$",
    record: {
      citations: [
        { start: 2, end: 6, keys: [{ citekey: "k", start: 3, end: 5 }] },
      ],
      citekeys: [{ kind: "citekey", raw: "k", position: pos(3, 5) }],
    },
  },
  // Same corpus: probe/math/escaped-dollar, token/inline-math/escaped-close.
  {
    name: "escaped math opener",
    text: "\\$x [@k]$",
    record: {
      citations: [
        { start: 4, end: 8, keys: [{ citekey: "k", start: 5, end: 7 }] },
      ],
      citekeys: [{ kind: "citekey", raw: "k", position: pos(5, 7) }],
    },
  },
  {
    name: "escaped dollar does not close math",
    text: `$x\\$ ${hidden}$ [[After]]`,
    record: { wikilinks: [afterLink(0, 118, 118)] },
  },
  // Same corpus: probe/math/inline-across-line and probe/math/display-same-line.
  {
    name: "inline math across lines",
    text: `$x\n${hidden}$ [[After]]`,
    record: { wikilinks: [afterLink(1, 113, 116)] },
  },
  {
    name: "display math inline",
    text: `before $$${hidden}$$ after [[After]]`,
    record: { wikilinks: [afterLink(0, 129, 129)] },
  },
  {
    name: "display math closing-line tail preserves source positions",
    text: "$$x$$ [@k]",
    record: {
      citations: [
        { start: 6, end: 10, keys: [{ citekey: "k", start: 7, end: 9 }] },
      ],
      citekeys: [{ kind: "citekey", raw: "k", position: pos(7, 9) }],
    },
  },
  // Same corpus: probe/math/display-own-lines and math/empty-block.
  {
    name: "display math across blank lines",
    text: `$$\n\n${hidden}\n\n$$\n\n[[After]]`,
    record: { wikilinks: [afterLink(6, 0, 121)] },
  },
  // Same corpus: probe/math/display-open-only.
  { name: "unclosed display math", text: `$$\n${hidden}`, record: {} },
  {
    name: "four hyphens do not close frontmatter",
    text: `---\nx: y\n----\n${hidden}\n---\n[[After]]`,
    record: { wikilinks: [afterLink(5, 0, 130)] },
  },
  {
    name: "hyphens with a suffix do not close frontmatter",
    text: `---\nx: y\n---x\n${hidden}\n---\n[[After]]`,
    record: { wikilinks: [afterLink(5, 0, 130)] },
  },
  {
    name: "exact CRLF frontmatter close preserves following text",
    text: "---\r\nx: y\r\n---\r\n[[Note]]",
    record: {
      wikilinks: [
        {
          kind: "wikilink",
          raw: "Note",
          position: {
            start: { line: 3, col: 0, offset: 16 },
            end: { line: 3, col: 8, offset: 24 },
          },
        },
      ],
    },
  },
  // remark-obsidian/test/parity/corpus.ts: frontmatter/wikilink-value.
  {
    name: "closed frontmatter",
    text: `---\nvalue: '${hidden}'\n---\n[[After]]`,
    record: { wikilinks: [afterLink(3, 0, 129)] },
  },
  // Same corpus: frontmatter/unclosed-fence. The body is ordinary Markdown.
  {
    name: "unclosed frontmatter",
    text: "---\n[@k]",
    record: {
      citations: [
        { start: 4, end: 8, keys: [{ citekey: "k", start: 5, end: 7 }] },
      ],
      citekeys: [
        {
          kind: "citekey",
          raw: "k",
          position: {
            start: { line: 1, col: 1, offset: 5 },
            end: { line: 1, col: 3, offset: 7 },
          },
        },
      ],
    },
  },
  // Same corpus: frontmatter/indented-opener-is-not.
  {
    name: "frontmatter opener must start at zero",
    text: " ---\n[@k]\n---",
    record: {
      citations: [
        { start: 5, end: 9, keys: [{ citekey: "k", start: 6, end: 8 }] },
      ],
      citekeys: [
        {
          kind: "citekey",
          raw: "k",
          position: {
            start: { line: 1, col: 1, offset: 6 },
            end: { line: 1, col: 3, offset: 8 },
          },
        },
      ],
    },
  },
  // remark-obsidian/test/parity/corpus.ts: comment/inline, comment/block,
  // comment/unterminated. Payloads exercise all five recorded occurrence kinds.
  {
    name: "inline comment",
    text: `before %%${hidden}%% [[After]]`,
    record: { wikilinks: [afterLink(0, 123, 123)] },
  },
  {
    name: "block comment",
    text: `%%\n${hidden}\n%%\n\n[[After]]`,
    record: { wikilinks: [afterLink(4, 0, 119)] },
  },
  {
    name: "unclosed comment hides the rest",
    text: `%%\n${hidden}`,
    record: {},
  },
  // Same corpus: probe/quote-comment/crossing-text.
  {
    name: "comment crosses containers",
    text: `> %%\n\n${hidden}\n%%\n\n[[After]]`,
    record: { wikilinks: [afterLink(5, 0, 122)] },
  },
  {
    name: "code markers cannot close a comment",
    text: `%% \`%%\`\n${hidden}\n%%\n\n[[After]]`,
    record: { wikilinks: [afterLink(4, 0, 124)] },
  },
  {
    name: "code markers cannot open a comment",
    text: "`%%` [@k]",
    record: {
      citations: [
        { start: 5, end: 9, keys: [{ citekey: "k", start: 6, end: 8 }] },
      ],
      citekeys: [{ kind: "citekey", raw: "k", position: pos(6, 8) }],
    },
  },
];

it.each(conformance)("$name", ({ text, record }) => {
  const { links: _links, ranges: _ranges, ...citations } = scanNote(text);
  expect(citations).toEqual({ ...empty, ...record });
});

// Existing citation syntax remains stable when the legacy scanner retires.
it.each(
  [
    "Before @a [{p. 3}; @b] after",
    "See [[@a]] and ![[@b|B]], then [@c] and [[Note]] @d.",
    "a [[@x]] b\n[[unclosed @y\n",
    "As @roe2025 wrote, see [[@doe2024]].",
    [
      "---",
      "cite: @doe2024",
      "---",
      "",
      "```md",
      "@doe2024",
      "```",
      "",
      "    @doe2024",
      "",
      "Inline `@doe2024`, math $x = @doe2024$, and %% @doe2024 %% too.",
      "",
      "$$",
      "@doe2024",
      "$$",
      "",
      "Only @roe2025 counts.",
    ].join("\n"),
    [
      "- item",
      "",
      "    Indented under the list, citing @doe2024.",
      "",
      "It cost $5 and @roe2025 says $6 isn't a formula.",
      "",
      "A lone ` backtick keeps @doe2024 readable.",
    ].join("\n"),
  ].map((text, index) => ({ text, index })),
)("preserves existing citekey scan: $text", ({ text, index }) => {
  const expected = [
    ["@a [{p. 3}; @b]"],
    ["[@c]", "@d"],
    ["@y"],
    ["@roe2025"],
    ["@roe2025"],
    ["@doe2024", "@roe2025", "@doe2024"],
  ];
  const sources = scanNote(text).citations.map(({ start, end }) =>
    text.slice(start, end),
  );
  expect(sources).toEqual(expected[index]);
});

it.each([
  { text: "[[Doe 2024]]", eligible: true },
  {
    text: "[[Doe 2024#cite:locator=4]]",
    eligible: true,
    fragment: "locator=4",
  },
  { text: "[[Doe 2024#cite:]]", malformed: true },
  { text: "[[Doe 2024#Heading]]" },
  { text: "[[Doe 2024#^block]]" },
  { text: "[[Doe 2024|Doe]]" },
  { text: "![[Doe 2024]]" },
  { text: "[Doe](Doe%202024)" },
])(
  "preserves existing wikilink eligibility: $text",
  ({ text, eligible, malformed, fragment }) => {
    const occurrence = {
      kind: "wikilink",
      raw: "Doe 2024",
      position: pos(0, text.length),
    };
    const record = scanNote(text);
    expect(record.wikilinks).toEqual(
      eligible
        ? [{ ...occurrence, ...(fragment === undefined ? {} : { fragment }) }]
        : [],
    );
    expect(record.malformedWikilinks).toEqual(
      malformed ? [{ occurrence }] : [],
    );
  },
);

// Intentional #1689 / ADR 0079 changes from the previous scanner (scan.ts).
// Each row names what that scanner did; only the new scanner is asserted.
it.each([
  {
    name: "fenced code nested in a quote hides its Citation (scan.ts read it)",
    text: "> ~~~\n> [@k]\n> ~~~",
    citekeys: [],
  },
  {
    name: "a digit after the math opener leaves a Citation visible (scan.ts hid it)",
    text: "$5 [@k] x$",
    citekeys: ["k"],
  },
  {
    name: "an escaped math closer leaves the math open over a Citation (scan.ts read it)",
    text: "$x\\$ [@k]$",
    citekeys: [],
  },
  {
    name: "an unclosed comment hides the rest of the note (scan.ts read it)",
    text: "%% [@k]",
    citekeys: [],
  },
])("$name", ({ text, citekeys }) => {
  expect(scanNote(text).citekeys.map(({ raw }) => raw)).toEqual(citekeys);
});
