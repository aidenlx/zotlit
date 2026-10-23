// Adapted payloads from quartz-community/remark-obsidian, with each case ID below.
// Source: https://github.com/quartz-community/remark-obsidian/blob/a80395a3d80f351e67a0afdb63b51a604e010c8e/test/parity/corpus.ts
import { expect, it } from "vitest";

import {
  documentWikilinks,
  scanCitekeyOccurrences,
  scanDocumentCitations,
} from "./scan";
import { scanNote } from "./scan-note";
import type { NoteScanRecord } from "./scan-note";

const empty: NoteScanRecord = {
  citations: [],
  citekeys: [],
  wikilinks: [],
  malformedWikilinks: [],
  annotations: [],
  malformedAnnotationCitations: [],
};
const uri = "zotero://open/library/items/ABCD2345?annotation=EFGH6789";
const annotation = {
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

// #1689: wrong forms, lost group identity, and shifted source positions are
// the failure modes at this text-in / record-out seam.
const conformance: {
  name: string;
  text: string;
  record: Partial<NoteScanRecord>;
}[] = [
  {
    name: "ATX heading before indented code (#1689)",
    text: `## heading\n    ${hidden}`,
    record: {},
  },
  {
    name: "setext underline before indented code (#1689)",
    text: `heading\n===\n    ${hidden}`,
    record: {},
  },
  {
    name: "horizontal rule before indented code (#1689)",
    text: `***\n    ${hidden}`,
    record: {},
  },
  {
    name: "annotation embed inside a Markdown link (#1689)",
    text: `[![quote](${uri})](https://example.org)`,
    record: {
      annotations: [{ ...annotation, form: "embed", position: pos(1, 67) }],
    },
  },
  {
    name: "reference definition before indented code (#1689)",
    text: `[a]: https://example.org\n    ${hidden}`,
    record: {},
  },
  {
    name: "visible autolink after a Markdown link and label (#1689)",
    text: `[x](https://example.org) [a]: <${uri}>`,
    record: {
      annotations: [{ ...annotation, form: "labelled", position: pos(30, 88) }],
    },
  },
  {
    name: "named character reference in link destination (#1689)",
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
    name: "decimal character reference in image destination (#1689)",
    text: "![](zotero://open/library/items/ABCD2345?page=1&#38;annotation=EFGH6789)",
    record: {
      annotations: [
        { ...annotation, pageLabel: "1", form: "embed", position: pos(0, 72) },
      ],
    },
  },
  {
    name: "hex character reference in link destination (#1689)",
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
    name: "autolink keeps character references literal (#1689)",
    text: `<${uri}&page=&copy;>`,
    record: {
      annotations: [{ ...annotation, form: "labelled", position: pos(0, 70) }],
    },
  },
  {
    name: "escaped ampersand keeps character reference literal (#1689)",
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
  { name: "raw HTML block", text: `<div>\n${hidden}\n</div>`, record: {} },
  { name: "HTML comment block", text: `<!--\n${hidden}\n-->`, record: {} },
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
      annotations: [{ ...annotation, form: "labelled", position: pos(0, 64) }],
    },
  },
  {
    name: "whitespace-only label",
    text: `[ \t](${uri})`,
    record: {
      annotations: [{ ...annotation, form: "labelled", position: pos(0, 62) }],
    },
  },
  {
    name: "autolink",
    text: `<${uri}>`,
    record: {
      annotations: [{ ...annotation, form: "labelled", position: pos(0, 58) }],
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
      annotations: [{ ...annotation, form: "embed", position: pos(0, 66) }],
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
      wikilinks: [{ kind: "wikilink", raw: "Note", position: pos(0, 23) }],
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
    text: `> \`\`\`\n> ${hidden}\n> \`\`\``,
    record: {},
  },
  {
    name: "fenced code in callout",
    text: `> [!note]\n> \`\`\`\n> ${hidden}\n> \`\`\``,
    record: {},
  },
  {
    name: "fenced code in list",
    text: `- item\n\n  \`\`\`\n  ${hidden}\n  \`\`\``,
    record: {},
  },
  { name: "indented code in quote", text: `>     ${hidden}`, record: {} },
  {
    name: "indented code in list",
    text: `- item\n\n      ${hidden}`,
    record: {},
  },
  { name: "unclosed fence", text: `\`\`\`\n${hidden}`, record: {} },
  { name: "inline code", text: `\`${hidden}\``, record: {} },
  { name: "multiline inline code", text: `\`code\n${hidden}\``, record: {} },
  // remark-obsidian/test/parity/corpus.ts: probe/math/wikilink-inside,
  // with the payload expanded to all occurrence forms.
  {
    name: "inline math consumes every source",
    text: `$x ${hidden}$`,
    record: {},
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
    text: `$x\\$ ${hidden}$`,
    record: {},
  },
  // Same corpus: probe/math/inline-across-line and probe/math/display-same-line.
  { name: "inline math across lines", text: `$x\n${hidden}$`, record: {} },
  {
    name: "display math inline",
    text: `before $$${hidden}$$ after`,
    record: {},
  },
  {
    name: "display math closing-line tail preserves source positions (#1689)",
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
    text: `$$\n\n${hidden}\n\n$$`,
    record: {},
  },
  // Same corpus: probe/math/display-open-only.
  { name: "unclosed display math", text: `$$\n${hidden}`, record: {} },
  {
    name: "four hyphens do not close frontmatter (#1689)",
    text: `---\nx: y\n----\n${hidden}\n---`,
    record: {},
  },
  {
    name: "hyphens with a suffix do not close frontmatter (#1689)",
    text: `---\nx: y\n---x\n${hidden}\n---`,
    record: {},
  },
  {
    name: "exact CRLF frontmatter close preserves following text (#1689)",
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
    text: `---\nvalue: '${hidden}'\n---`,
    record: {},
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
  { name: "inline comment", text: `before %%${hidden}%% after`, record: {} },
  { name: "block comment", text: `%%\n${hidden}\n%%`, record: {} },
  {
    name: "unclosed comment hides the rest",
    text: `%%\n${hidden}`,
    record: {},
  },
  // Same corpus: probe/quote-comment/crossing-text.
  {
    name: "comment crosses containers",
    text: `> %%\n\n${hidden}\n%%`,
    record: {},
  },
  {
    name: "code markers cannot close a comment",
    text: `%% \`%%\`\n${hidden}\n%%`,
    record: {},
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
  expect(scanNote(text)).toEqual({ ...empty, ...record });
});

// These inputs are the existing scan.test.ts cases and the two syntax fixtures
// in citation-index/service.test.ts. The current scanner is the parity oracle.
it.each([
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
])("preserves existing citekey scan: %s", (text) => {
  expect(scanNote(text).citations).toEqual(scanDocumentCitations(text));
  expect(scanNote(text).citekeys).toEqual(scanCitekeyOccurrences(text));
});

it.each([
  { text: "[[Doe 2024]]", link: "Doe 2024" },
  { text: "[[Doe 2024#cite:locator=4]]", link: "Doe 2024#cite:locator=4" },
  { text: "[[Doe 2024#cite:]]", link: "Doe 2024#cite:" },
  { text: "[[Doe 2024#Heading]]", link: "Doe 2024#Heading" },
  { text: "[[Doe 2024#^block]]", link: "Doe 2024#^block" },
  { text: "[[Doe 2024|Doe]]", link: "Doe 2024" },
  { text: "![[Doe 2024]]", link: "Doe 2024" },
  { text: "[Doe](Doe%202024)", link: "Doe 2024" },
])("preserves existing wikilink eligibility: $text", ({ text, link }) => {
  const old = documentWikilinks([
    { original: text, link, position: pos(0, text.length) },
  ]);
  const record = scanNote(text);
  expect(record.wikilinks).toEqual(old.occurrences);
  expect(record.malformedWikilinks).toEqual(old.malformed);
});

// Intentional #1689 / ADR 0079 changes; old output is pinned to make the
// difference explicit, including the old unclosed-comment and escape behavior.
it.each([
  {
    name: "nested fenced code",
    text: "> ~~~\n> [@k]\n> ~~~",
    old: ["k"],
    current: [],
  },
  {
    name: "digit after math opener",
    text: "$5 [@k] x$",
    old: [],
    current: ["k"],
  },
  { name: "escaped math closer", text: "$x\\$ [@k]$", old: ["k"], current: [] },
  { name: "unclosed comment", text: "%% [@k]", old: ["k"], current: [] },
])("changes $name", ({ text, old, current }) => {
  expect(scanCitekeyOccurrences(text).map(({ raw }) => raw)).toEqual(old);
  expect(scanNote(text).citekeys.map(({ raw }) => raw)).toEqual(current);
});

it("excludes wikilinks that the old cache path included inside comments", () => {
  const text = "%% [[Note]] %%";
  const old = documentWikilinks([
    { original: "[[Note]]", link: "Note", position: pos(3, 11) },
  ]);
  expect(old.occurrences).toEqual([
    { kind: "wikilink", raw: "Note", position: pos(3, 11) },
  ]);
  expect(scanNote(text)).toEqual(empty);
});
