// #1689: extracted facts from every recorded Obsidian 1.14.4 parity case.
// Source: quartz-community/remark-obsidian at a80395a3d80f351e67a0afdb63b51a604e010c8e,
// test/parity/corpus.ts and test/parity/goldens/obsidian.json (compute.links).
//
// Each fixture row derives from `cases[id]` in goldens/obsidian.json. The
// extraction script was not kept, so this is the rule it applied:
// - `text` is the case's `markdown`, verbatim.
// - `links` is `obsidian.compute.links` followed by `obsidian.compute.embeds`.
//   A fact reads `RAW=>TARGET|DISPLAY@L:C-L:C`. `kind` is "wikilink" when RAW is
//   `[[…]]` or `![[…]]`, else "link". `embedded` is true for a compute.embeds
//   fact. `target` is the text after `=>` up to the first `|` (wikilink) or the
//   last `|` (Markdown destination, whose display text is the final field).
//   Offsets are UTF-16, from line start plus column. Facts sort by start offset.
// - `record` projects Citation eligibility only. `record.wikilinks` holds each
//   unembedded, unaliased `[[path]]` fact with a nonempty path and no `#`
//   subpath, as `{ kind, raw: <trimmed path>, position }`. Every other field is
//   empty. The `deliberateDifferences` rows carry scanner-specific records: the
//   comment and bare-URL rows, and probe/autolink/email-escaped, whose record
//   holds its Pandoc Citation.
// The fixture keeps only rows whose text holds a character a reference needs:
// `[`, `@`, `<`, `]]`, `zotero`, `$`, `%%`, a backtick, `---` or `^`. The 836
// rows without one expect an empty record from any scanner that does not throw.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { scanNote } from "./scan-note";
import type { NoteScanRecord } from "./scan-note";

// External URLs are absent from Obsidian's cache. The annotation conformance
// table and the hidden-payload cases below cover those links through the full
// scan record.

const labelPrecedence =
  "Retain Lezer's nested-label and inline-token precedence; matching Obsidian requires replacing the link/reference parser.";
const comments =
  "ADR 0080 excludes every reference in a %% comment; Obsidian's cache indexes these hidden references.";
const bareUrls =
  "#1689 keeps GFM bare-URL recognition off, so it does not consume following wikilinks.";
const emphasis =
  "The trimmed parser omits emphasis; Obsidian's legacy emphasis can consume a link delimiter.";
const tables =
  "#1689 keeps GFM tables off; Obsidian splits the unescaped alias pipe into table cells.";

type LinkFact = readonly [
  kind: "wikilink" | "link",
  embedded: boolean,
  target: string,
  from: number,
  to: number,
];

// Explicit alternatives pin the retained behavior as worked expectations. Every
// row still compares its complete record; an exception never skips an assertion.
// `recordOnly` marks a row whose links still equal the oracle's: the scanner
// differs from the renderer in its citation fields alone.
const deliberateDifferences: Record<
  string,
  { reason: string; links: LinkFact[]; recordOnly?: true }
> = {
  "probe/autolink-trail/wikilink": {
    reason: bareUrls,
    links: [["wikilink", false, "a", 20, 25]],
  },
  "probe/label-precedence/nested-inline": {
    reason: labelPrecedence,
    links: [["link", false, "u", 5, 13]],
  },
  "probe/label-precedence/nested-reference": {
    reason: labelPrecedence,
    links: [["link", false, "u", 5, 13]],
  },
  "probe/label-precedence/reference-inside": {
    reason: labelPrecedence,
    links: [],
  },
  "probe/label-precedence/bracket-no-link": {
    reason: labelPrecedence,
    links: [],
  },
  "probe/label-precedence/double-open": {
    reason: labelPrecedence,
    links: [["link", false, "u", 1, 7]],
  },
  "probe/label-precedence/code-crosses": { reason: labelPrecedence, links: [] },
  "probe/label-precedence/html-attr-crosses": {
    reason: labelPrecedence,
    links: [],
  },
  "probe/label-precedence/autolink-crosses": {
    reason: labelPrecedence,
    links: [],
  },
  "wikilink/table-unescaped": {
    reason: tables,
    links: [["wikilink", false, "Note", 19, 33]],
  },
  "fuzz/comment/10": { reason: comments, links: [] },
  "fuzz/footnote/33": { reason: comments, links: [] },
  "fuzz/embed/82": { reason: comments, links: [] },
  "fuzz/comment/11": { reason: comments, links: [] },
  "fuzz/wikilink/2": {
    reason: bareUrls,
    links: [["wikilink", false, "[&amp;", 23, 33]],
  },
  "fuzz/embed/13": {
    reason: labelPrecedence,
    links: [["wikilink", false, "[a#h", 6, 14]],
  },
  "fuzz/footnote/9": { reason: comments, links: [] },
  "fuzz/comment/4": { reason: comments, links: [] },
  "fuzz/embed/24": { reason: comments, links: [] },
  "fuzz/embed/31": {
    reason: comments,
    links: [["wikilink", true, "<br>", 0, 9]],
  },
  "fuzz/comment/5": { reason: comments, links: [] },
  "fuzz/math/4": {
    reason: bareUrls,
    links: [["wikilink", false, "#tag", 27, 35]],
  },

  "fuzz/comment/6": { reason: comments, links: [] },
  "probe/bracket-nest/link-inner-inline": {
    reason: labelPrecedence,
    links: [["link", false, "u", 3, 9]],
  },
  "probe/bracket-nest/link-inner-pair": { reason: labelPrecedence, links: [] },
  "probe/bracket-nest/link-inner-reference": {
    reason: labelPrecedence,
    links: [],
  },
  "probe/bracket-nest/link-outer-reference": {
    reason: labelPrecedence,
    links: [["link", false, "u", 3, 9]],
  },
  "probe/bracket-nest/link-triple": {
    reason: labelPrecedence,
    links: [["link", false, "u", 6, 12]],
  },
  "probe/bracket-nest/label-code-closer": {
    reason: labelPrecedence,
    links: [["link", false, "u", 0, 10]],
  },
  "probe/bracket-nest/label-autolink-closer": {
    reason: labelPrecedence,
    links: [["link", false, "u", 0, 28]],
  },
  "probe/bracket-nest/label-html-closer": {
    reason: labelPrecedence,
    links: [["link", false, "u", 0, 16]],
  },
  "probe/bracket-nest/label-math-closer": {
    reason: labelPrecedence,
    links: [["link", false, "u", 0, 12]],
  },
  "context/table-cell/wikilink-alias": {
    reason: tables,
    links: [["wikilink", false, "target", 16, 32]],
  },
  "commonmark/code-spans/342": { reason: labelPrecedence, links: [] },
  "commonmark/emphasis-and-strong-emphasis/419": {
    reason: emphasis,
    links: [["link", false, "/url", 5, 18]],
  },
  "commonmark/emphasis-and-strong-emphasis/473": {
    reason: emphasis,
    links: [["link", false, "/url", 1, 13]],
  },
  "commonmark/emphasis-and-strong-emphasis/474": {
    reason: emphasis,
    links: [["link", false, "/url", 5, 17]],
  },

  "commonmark/links/512": { reason: labelPrecedence, links: [] },
  "commonmark/links/518": {
    reason: labelPrecedence,
    links: [["link", false, "/uri", 5, 16]],
  },
  "commonmark/links/519": {
    reason: labelPrecedence,
    links: [["link", false, "/uri", 11, 22]],
  },
  "commonmark/links/521": {
    reason: emphasis,
    links: [["link", false, "/uri", 1, 13]],
  },
  "commonmark/links/524": { reason: labelPrecedence, links: [] },
  "commonmark/links/525": { reason: labelPrecedence, links: [] },
  "commonmark/links/526": { reason: labelPrecedence, links: [] },
  "commonmark/links/532": {
    reason: labelPrecedence,
    links: [["link", false, "/uri", 5, 16]],
  },
  "probe/autolink/email-escaped": {
    reason:
      "The shared Pandoc grammar reads the unescaped @bar.example.com in prose; the renderer has no citation concept.",
    links: [],
    recordOnly: true,
  },
};

const cases = readFileSync(
  new URL("./__fixtures__/scan-note-corpus.jsonl", import.meta.url),
  "utf8",
)
  .trimEnd()
  .split("\n")
  .map(
    (line) =>
      JSON.parse(line) as {
        id: string;
        text: string;
        record: Partial<NoteScanRecord>;
        links: NoteScanRecord["links"];
      },
  );

function position(text: string, from: number, to: number) {
  const location = (offset: number) => {
    const lines = text.slice(0, offset).split("\n");
    return { line: lines.length - 1, col: lines.at(-1)!.length, offset };
  };
  return { start: location(from), end: location(to) };
}

function linkFacts(text: string, facts: LinkFact[]): NoteScanRecord["links"] {
  return facts.map(([kind, embedded, target, from, to]) => ({
    kind,
    embedded,
    target,
    position: position(text, from, to),
  }));
}

const empty: Omit<NoteScanRecord, "ranges"> = {
  links: [],
  citations: [],
  citekeys: [],
  wikilinks: [],
  malformedWikilinks: [],
  annotations: [],
  malformedAnnotationCitations: [],
};

// S4: Citation targets use the same normalized target as Obsidian links.
const normalizedWikilinks: Record<string, NoteScanRecord["wikilinks"]> = {
  "fuzz/embed/26": [
    {
      kind: "wikilink",
      raw: "target",
      position: {
        start: {
          line: 0,
          col: 24,
          offset: 24,
        },
        end: {
          line: 0,
          col: 35,
          offset: 35,
        },
      },
    },
  ],
  "token/wikilink/escaped-close": [
    {
      kind: "wikilink",
      raw: "target",
      position: {
        start: {
          line: 0,
          col: 0,
          offset: 0,
        },
        end: {
          line: 0,
          col: 11,
          offset: 11,
        },
      },
    },
  ],
  "token/embed/both-escaped": [
    {
      kind: "wikilink",
      raw: "target",
      position: {
        start: {
          line: 0,
          col: 2,
          offset: 2,
        },
        end: {
          line: 0,
          col: 13,
          offset: 13,
        },
      },
    },
  ],
};

it.each(cases)("$id", ({ id, text, record, links }) => {
  const difference = deliberateDifferences[id];
  const expectedLinks = difference ? linkFacts(text, difference.links) : links;
  const normalized = normalizedWikilinks[id];
  const { ranges: _ranges, ...occurrences } = scanNote(text);
  expect(
    {
      ...occurrences,
      citations: occurrences.citations.map(({ start, end, keys }) => ({
        start,
        end,
        keys,
      })),
    },
    difference?.reason,
  ).toEqual({
    ...empty,
    ...record,
    ...(normalized ? { wikilinks: normalized } : {}),
    links: expectedLinks,
  });
});

it("compares every corpus case and accounts for deliberate differences (#1689)", () => {
  const ids = new Set(cases.map(({ id }) => id));
  expect(ids.size).toBe(2612);
  for (const id of Object.keys(deliberateDifferences))
    expect(ids.has(id), id).toBe(true);
  const differences = Object.keys(deliberateDifferences).length;
  expect(cases.length - differences).toBe(2566);
  const byId = new Map(cases.map((row) => [row.id, row]));
  for (const [id, difference] of Object.entries(deliberateDifferences).filter(
    ([, difference]) => !difference.recordOnly,
  )) {
    const row = byId.get(id)!;
    expect(
      linkFacts(row.text, difference.links),
      `stale deliberate difference: ${id}`,
    ).not.toEqual(row.links);
  }
});

// The original code/math rows contain no references. These payload substitutions
// make their recorded rendering boundaries observable at the scanner seam.
const uri = "zotero://open/library/items/ABCD2345?annotation=EFGH6789";
const payload = `[[Note]] ![[Embed]] [@key] [](${uri}) ![](${uri})`;

// Obsidian renders each region below as code or math, so every reference in the
// payload stays hidden.
const hiddenPayloads = [
  ["probe/code-run/open-two-close-one", `\`\`${payload}\``],
  ["math/midline-quote", `> tail $$\n> ${payload}\n> $$`],
  ["probe/math-unclosed/four-dollars-then-heading", `$$$$\n${payload}`],
  ["math/unclosed-inner", `$$\n$Math$$\n${payload}\n$$`],
  ["math/unclosed-quote-lazy", `> $$\n${payload}`],
] as const;

it.each(hiddenPayloads)(
  "%s: hides every reference in the payload (#1689)",
  (_id, text) => {
    const { ranges: _ranges, ...occurrences } = scanNote(text);
    expect(occurrences).toEqual(empty);
  },
);

const at = (line: number, col: number, offset: number) => ({
  line,
  col,
  offset,
});

it("token/display-math/newline-escaped-close: an escaped $$ leaves the payload visible (#1689)", () => {
  // The payload starts on line 2 at offset 8, after "$$\n" and "x\$$\n".
  const text = `$$\nx\\$$\n${payload}`;
  const annotation = {
    text: "",
    indexedKey: "EFGH6789",
    attachmentKey: "ABCD2345",
    pageLabel: null,
  };
  const { ranges: _ranges, ...occurrences } = scanNote(text);
  expect({
    ...occurrences,
    citations: occurrences.citations.map(({ start, end, keys }) => ({
      start,
      end,
      keys,
    })),
  }).toEqual({
    ...empty,
    links: [
      {
        kind: "wikilink",
        embedded: false,
        target: "Note",
        position: { start: at(2, 0, 8), end: at(2, 8, 16) },
      },
      {
        kind: "wikilink",
        embedded: true,
        target: "Embed",
        position: { start: at(2, 9, 17), end: at(2, 19, 27) },
      },
    ],
    wikilinks: [
      {
        kind: "wikilink",
        raw: "Note",
        position: { start: at(2, 0, 8), end: at(2, 8, 16) },
      },
    ],
    citations: [
      { start: 28, end: 34, keys: [{ citekey: "key", start: 29, end: 33 }] },
    ],
    citekeys: [
      {
        kind: "citekey",
        raw: "key",
        position: { start: at(2, 21, 29), end: at(2, 25, 33) },
      },
    ],
    annotations: [
      {
        ...annotation,
        form: "citation",
        position: { start: at(2, 27, 35), end: at(2, 87, 95) },
      },
      {
        ...annotation,
        form: "embed",
        position: { start: at(2, 88, 96), end: at(2, 149, 157) },
      },
    ],
  });
});

it("an inline footnote in a link label keeps the Annotation link labelled (#1689)", () => {
  const { ranges: _ranges, ...occurrences } = scanNote(`[^[note]](${uri})`);
  expect({
    ...occurrences,
    citations: occurrences.citations.map(({ start, end, keys }) => ({
      start,
      end,
      keys,
    })),
  }).toEqual({
    ...empty,
    annotations: [
      {
        indexedKey: "EFGH6789",
        attachmentKey: "ABCD2345",
        pageLabel: null,
        form: "labelled",
        text: "^[note]",
        position: { start: at(0, 0, 0), end: at(0, 67, 67) },
      },
    ],
  });
});

it("a footnote definition ends at its first closing bracket, so a following Wikilink stays visible (#1689)", () => {
  const { ranges: _ranges, ...occurrences } = scanNote("[^a] [[Note]]: body");
  expect({
    ...occurrences,
    citations: occurrences.citations.map(({ start, end, keys }) => ({
      start,
      end,
      keys,
    })),
  }).toEqual({
    ...empty,
    links: [
      {
        kind: "wikilink",
        embedded: false,
        target: "Note",
        position: { start: at(0, 5, 5), end: at(0, 13, 13) },
      },
    ],
    wikilinks: [
      {
        kind: "wikilink",
        raw: "Note",
        position: { start: at(0, 5, 5), end: at(0, 13, 13) },
      },
    ],
  });
});
