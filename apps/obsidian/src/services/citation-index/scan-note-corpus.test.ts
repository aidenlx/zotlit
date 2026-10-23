// #1689: extracted facts from every recorded Obsidian 1.14.4 parity case.
// Source: quartz-community/remark-obsidian at a80395a3d80f351e67a0afdb63b51a604e010c8e,
// test/parity/corpus.ts and test/parity/goldens/obsidian.json (compute.links).
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { scanNote } from "./scan-note";
import type { NoteScanRecord } from "./scan-note";

// The fixture retains every source plus the complete compute.links/embeds facts,
// converted to UTF-16 coordinates. Its record projects citation eligibility only;
// comparing that projection alone made code/math cases with no references vacuous.
// External URLs are absent from Obsidian's cache. The annotation conformance table
// and the payload probes below cover those links through the full scan record.

const labelPrecedence =
  "Retain Lezer's nested-label and inline-token precedence; matching Obsidian requires replacing the link/reference parser.";
const comments =
  "ADR 0079 excludes every reference in a %% comment; Obsidian's cache indexes these hidden references.";
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
const deliberateDifferences: Record<
  string,
  { reason: string; links: LinkFact[] }
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

const empty: NoteScanRecord = {
  links: [],
  citations: [],
  citekeys: [],
  wikilinks: [],
  malformedWikilinks: [],
  annotations: [],
  malformedAnnotationCitations: [],
};

it.each(cases)("$id", ({ id, text, record, links }) => {
  const difference = deliberateDifferences[id];
  const expectedLinks = difference ? linkFacts(text, difference.links) : links;
  expect(scanNote(text), difference?.reason).toEqual({
    ...empty,
    ...record,
    links: expectedLinks,
  });
});

it("compares every corpus case and accounts for deliberate differences (#1689)", () => {
  const ids = new Set(cases.map(({ id }) => id));
  expect(ids.size).toBe(3448);
  for (const id of Object.keys(deliberateDifferences))
    expect(ids.has(id), id).toBe(true);
  const differences = Object.keys(deliberateDifferences).length;
  expect(cases.length - differences).toBe(3402);
  const byId = new Map(cases.map((row) => [row.id, row]));
  for (const [id, difference] of Object.entries(deliberateDifferences).filter(
    ([id]) => id !== "probe/autolink/email-escaped",
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
const probes = [
  ["probe/code-run/open-two-close-one", `\`\`${payload}\``, ""],
  ["math/midline-quote", `> tail $$\n> ${payload}\n> $$`, ""],
  ["probe/math-unclosed/four-dollars-then-heading", `$$$$\n${payload}`, ""],
  [
    "token/display-math/newline-escaped-close",
    `$$\nx\\$$\n${payload}`,
    payload,
  ],
  ["math/unclosed-inner", `$$\n$Math$$\n${payload}\n$$`, ""],
  ["math/unclosed-quote-lazy", `> $$\n${payload}`, ""],
  ["inline footnote in link label", `[^[note]](${uri})`, "annotation"],
  [
    "footnote definition first closing bracket",
    "[^a] [[Note]]: body",
    "wikilink",
  ],
] as const;

it.each(probes)(
  "%s: reference-bearing boundary (#1689)",
  (_id, text, visible) => {
    let expected: NoteScanRecord = { ...empty };
    if (visible === payload) {
      const from = text.indexOf(payload);
      const citekey = from + 21;
      const annotation = {
        indexedKey: "EFGH6789",
        attachmentKey: "ABCD2345",
        pageLabel: null,
      };
      expected = {
        ...empty,
        links: linkFacts(text, [
          ["wikilink", false, "Note", from, from + 8],
          ["wikilink", true, "Embed", from + 9, from + 19],
        ]),
        wikilinks: [
          {
            kind: "wikilink",
            raw: "Note",
            position: position(text, from, from + 8),
          },
        ],
        citations: [
          {
            start: from + 20,
            end: from + 26,
            keys: [{ citekey: "key", start: citekey, end: citekey + 4 }],
          },
        ],
        citekeys: [
          {
            kind: "citekey",
            raw: "key",
            position: position(text, citekey, citekey + 4),
          },
        ],
        annotations: [
          {
            ...annotation,
            form: "citation",
            position: position(text, from + 27, from + 31 + uri.length),
          },
          {
            ...annotation,
            form: "embed",
            position: position(text, from + 32 + uri.length, text.length),
          },
        ],
      };
    } else if (visible === "annotation") {
      expected.annotations = [
        {
          indexedKey: "EFGH6789",
          attachmentKey: "ABCD2345",
          pageLabel: null,
          form: "labelled",
          position: position(text, 0, text.length),
        },
      ];
    } else if (visible === "wikilink") {
      expected.links = linkFacts(text, [["wikilink", false, "Note", 5, 13]]);
      expected.wikilinks = [
        { kind: "wikilink", raw: "Note", position: position(text, 5, 13) },
      ];
    }
    expect(scanNote(text)).toEqual(expected);
  },
);
