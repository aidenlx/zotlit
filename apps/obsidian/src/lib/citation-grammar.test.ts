import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getPackageRoot } from "@zotlit/scripts/package-roots";

import {
  citekeyAt,
  scanCitationClusters,
  scanCitations,
  scanCitekeys,
} from "./citation-grammar";
import type { CitationCluster } from "./citation-grammar";

const packageRoot = getPackageRoot();

const keys = (text: string) =>
  scanCitekeys(text).map((key) => ({
    citekey: key.citekey,
    raw: text.slice(key.start, key.end),
    suppressAuthor: key.suppressAuthor,
  }));

const citekeys = (text: string) => scanCitekeys(text).map((key) => key.citekey);

const items = (text: string, cluster: CitationCluster) =>
  cluster.items.map((item) => ({
    citekey: item.key.citekey,
    suppressAuthor: item.key.suppressAuthor,
    prefix: item.prefix && text.slice(item.prefix.start, item.prefix.end),
    suffix: item.suffix && text.slice(item.suffix.start, item.suffix.end),
  }));

describe("scanCitekeys", () => {
  it("reads a bare author-in-text key", () => {
    expect(keys("@item1 says blah.")).toEqual([
      { citekey: "item1", raw: "@item1", suppressAuthor: false },
    ]);
  });

  it("keeps single internal punctuation and drops the trailing character", () => {
    expect(citekeys("@Foo_bar.baz. end")).toEqual(["Foo_bar.baz"]);
  });

  it("stops the key at repeated punctuation", () => {
    expect(citekeys("@Foo_bar--baz end")).toEqual(["Foo_bar"]);
  });

  it("accepts a digit, an underscore, and the nocite wildcard as first character", () => {
    expect(citekeys("@2020 and @_key and @* here")).toEqual([
      "2020",
      "_key",
      "*",
    ]);
  });

  it("reads a Unicode key", () => {
    expect(citekeys("@пункт3 unicode")).toEqual(["пункт3"]);
  });

  it("runs a bare URL key past the single-punctuation rule", () => {
    expect(citekeys("@https://example.com/paper end")).toEqual([
      "https://example.com/paper",
    ]);
  });

  it("reads a braced key without its braces", () => {
    expect(keys("a @{https://example.com/paper} b")).toEqual([
      {
        citekey: "https://example.com/paper",
        raw: "@{https://example.com/paper}",
        suppressAuthor: false,
      },
    ]);
  });

  it("keeps nested braces inside a braced key", () => {
    expect(citekeys("a @{a{b}c} b")).toEqual(["a{b}c"]);
  });

  it("reads a braced key containing a closing bracket", () => {
    expect(citekeys("a @{https://ex.com/a]b} c")).toEqual([
      "https://ex.com/a]b",
    ]);
  });

  it("rejects an unbalanced braced key", () => {
    expect(citekeys("a @{unclosed b")).toEqual([]);
  });

  it("reads the suppress-author marker as part of the span", () => {
    expect(keys("[-@item1]")).toEqual([
      { citekey: "item1", raw: "-@item1", suppressAuthor: true },
    ]);
  });

  it("treats a hyphen after a word as text, not author suppression", () => {
    expect(keys("a-@key")).toEqual([
      { citekey: "key", raw: "@key", suppressAuthor: false },
    ]);
  });

  it("reads every key of a citation cluster", () => {
    expect(
      citekeys("A citation group [see @item1 chap. 3; also @пункт3 p. 34-35]."),
    ).toEqual(["item1", "пункт3"]);
  });

  it("reads a key after an underscore", () => {
    expect(citekeys("_@key")).toEqual(["key"]);
  });

  it("ignores a key inside a footnote reference", () => {
    expect(citekeys("a [^@key] b")).toEqual([]);
  });

  it("reads a key inside an inline note or a spaced bracket, which no footnote label allows", () => {
    expect(citekeys("e ^[@key] f")).toEqual(["key"]);
    expect(citekeys("c [^see @key] d")).toEqual(["key"]);
  });

  it("ignores an @ preceded by a word character or a period", () => {
    expect(citekeys("mail me@example.com now")).toEqual([]);
    expect(citekeys("visit https://user@example.com/x")).toEqual([]);
    expect(citekeys("write mailto:a@b.com")).toEqual([]);
    expect(citekeys(".@key and ..@key")).toEqual([]);
  });
});

describe("scanCitationClusters", () => {
  it("splits a cluster into semicolon-separated items with prefix and suffix", () => {
    const text = "[see @doe99, pp. 33-35 and *passim*; @smith04, chap. 1]";
    const [cluster] = scanCitationClusters(text);
    expect(cluster).toBeDefined();
    expect(text.slice(cluster!.start, cluster!.end)).toBe(text);
    expect(items(text, cluster!)).toEqual([
      {
        citekey: "doe99",
        suppressAuthor: false,
        prefix: "see",
        suffix: ", pp. 33-35 and *passim*",
      },
      {
        citekey: "smith04",
        suppressAuthor: false,
        prefix: null,
        suffix: ", chap. 1",
      },
    ]);
  });

  it("carries author suppression per item", () => {
    const text = "[-@item2 p. 30; see also @item3]";
    const [cluster] = scanCitationClusters(text);
    expect(items(text, cluster!)).toEqual([
      {
        citekey: "item2",
        suppressAuthor: true,
        prefix: null,
        suffix: "p. 30",
      },
      {
        citekey: "item3",
        suppressAuthor: false,
        prefix: "see also",
        suffix: null,
      },
    ]);
  });

  it("tolerates padding inside the brackets", () => {
    const text = "a [ @item1 ] b";
    const [cluster] = scanCitationClusters(text);
    expect(text.slice(cluster!.start, cluster!.end)).toBe("[ @item1 ]");
    expect(items(text, cluster!)).toEqual([
      { citekey: "item1", suppressAuthor: false, prefix: null, suffix: null },
    ]);
  });

  it("spans a braced key that contains a closing bracket", () => {
    const text = "a [@{https://ex.com/a]b}, p. 3] c";
    const [cluster] = scanCitationClusters(text);
    expect(text.slice(cluster!.start, cluster!.end)).toBe(
      "[@{https://ex.com/a]b}, p. 3]",
    );
    expect(items(text, cluster!)).toEqual([
      {
        citekey: "https://ex.com/a]b",
        suppressAuthor: false,
        prefix: null,
        suffix: ", p. 3",
      },
    ]);
  });

  it("keeps a semicolon or a closing bracket inside inline code out of the split", () => {
    const text = "a [@a, `x;y]z`] b";
    const [cluster] = scanCitationClusters(text);
    expect(text.slice(cluster!.start, cluster!.end)).toBe("[@a, `x;y]z`]");
    expect(items(text, cluster!)).toEqual([
      {
        citekey: "a",
        suppressAuthor: false,
        prefix: null,
        suffix: ", `x;y]z`",
      },
    ]);
  });

  it("rejects a cluster whose item carries no key", () => {
    expect(scanCitationClusters("a [@a; not a key] b")).toEqual([]);
    expect(scanCitationClusters("a [a@b; @c] d")).toEqual([]);
  });

  it("rejects a footnote reference", () => {
    expect(scanCitationClusters("a [^@key] b")).toEqual([]);
  });

  it("reads a bracket whose caret no footnote label allows", () => {
    const text = "c [^see @key] d";
    const [cluster] = scanCitationClusters(text);
    expect(text.slice(cluster!.start, cluster!.end)).toBe("[^see @key]");
    expect(items(text, cluster!)).toEqual([
      { citekey: "key", suppressAuthor: false, prefix: "^see", suffix: null },
    ]);
  });

  it("rejects an inline link, reference link, or bracketed span", () => {
    expect(scanCitationClusters("a [@a](http://x.com) b")).toEqual([]);
    expect(scanCitationClusters("a [@a][ref] b")).toEqual([]);
    expect(scanCitationClusters("a [@a]{.cls} b")).toEqual([]);
  });

  it("reads a cluster whose trailing delimiter never closes", () => {
    const trailing = (text: string) =>
      scanCitationClusters(text).map((cluster) =>
        text.slice(cluster.start, cluster.end),
      );
    expect(trailing("a [@a](oops b")).toEqual(["[@a]"]);
    expect(trailing("a [@a][ref b")).toEqual(["[@a]"]);
    expect(trailing("a [@a] (spaced) b")).toEqual(["[@a]"]);
  });

  it("leaves an author-in-text locator bracket alone", () => {
    const text = "@item1 [p. 30] says blah.";
    expect(citekeys(text)).toEqual(["item1"]);
    expect(scanCitationClusters(text)).toEqual([]);
  });

  it("never spans a line break", () => {
    expect(scanCitationClusters("[@a;\n@b]")).toEqual([]);
  });

  it("reads each cluster on its own line", () => {
    const text = "[@a] and [@b]\n[@c]";
    expect(
      scanCitationClusters(text).map((cluster) =>
        items(text, cluster).map((item) => item.citekey),
      ),
    ).toEqual([["a"], ["b"], ["c"]]);
  });
});

describe("scanCitations", () => {
  const sources = (text: string) =>
    scanCitations(text).map((citation) => ({
      source: text.slice(citation.start, citation.end),
      keys: citation.keys.map((key) => key.citekey),
    }));

  it("reads a cluster whole and a bare key on its own", () => {
    expect(sources("Blah [see @a, p. 3; @b] and @c said so.")).toEqual([
      { source: "[see @a, p. 3; @b]", keys: ["a", "b"] },
      { source: "@c", keys: ["c"] },
    ]);
  });

  it("keeps the author-suppression dash with the key it belongs to", () => {
    expect(sources("Blah -@a.")).toEqual([{ source: "-@a", keys: ["a"] }]);
  });

  it("leaves a bracket that carries no key as text", () => {
    expect(sources("[an aside] and @a")).toEqual([
      { source: "@a", keys: ["a"] },
    ]);
  });
});

describe("citekeyAt", () => {
  it("resolves a Pandoc citation under the cursor", () => {
    const line = "see [@doe2024alpha] for details";
    expect(citekeyAt(line, 7)).toMatchObject({
      citekey: "doe2024alpha",
      start: 5,
      end: 18,
    });
  });

  it("matches a click on the leading @ and just past the key", () => {
    const line = "[@key]";
    expect(citekeyAt(line, 1)?.citekey).toBe("key");
    expect(citekeyAt(line, 5)?.citekey).toBe("key");
  });

  it("stops the key at a locator separator", () => {
    const line = "[@smith2020, p. 3]";
    const key = citekeyAt(line, 3);
    expect(key?.citekey).toBe("smith2020");
    expect(line.slice(key!.start, key!.end)).toBe("@smith2020");
  });

  it("resolves each key in a multi-citation group", () => {
    const line = "[@a2020; @b2021]";
    expect(citekeyAt(line, 2)?.citekey).toBe("a2020");
    expect(citekeyAt(line, 11)?.citekey).toBe("b2021");
  });

  it("matches a suppress-author citation (`-@key`)", () => {
    const line = "[-@doe2024]";
    expect(citekeyAt(line, 4)?.citekey).toBe("doe2024");
  });

  it("matches a bare citation key", () => {
    expect(citekeyAt("@doe2024 said", 3)?.citekey).toBe("doe2024");
  });

  it("ignores an @ preceded by a word character (emails, handles)", () => {
    expect(citekeyAt("mail me@example.com now", 9)).toBeNull();
  });

  it("returns null when the offset is outside any citation", () => {
    const line = "see [@doe2024] later";
    expect(citekeyAt(line, 0)).toBeNull();
    expect(citekeyAt(line, 18)).toBeNull();
  });
});

/**
 * Pandoc's own citation fixture, vendored byte-for-byte. It is GPL-2.0-or-later,
 * which this AGPL-3.0-or-later package may carry.
 *
 * @see https://github.com/jgm/pandoc/blob/3.10.1/test/markdown-citations.txt
 */
describe("Pandoc's citation fixture", () => {
  const text = readFileSync(
    join(packageRoot, "src/lib/__fixtures__/pandoc-markdown-citations.md"),
    "utf8",
  );

  const tally = (found: string[]) =>
    found.reduce<Record<string, number>>(
      (counts, citekey) => ({
        ...counts,
        [citekey]: (counts[citekey] ?? 0) + 1,
      }),
      {},
    );

  it("finds every citekey Pandoc finds, and no others", () => {
    // Counts read off `pandoc -f markdown -t json` over this fixture at 3.10.1.
    // Pandoc reports them in AST order, which hoists footnote bodies to their
    // reference; the scan reports document order, so only the totals compare.
    expect(tally(citekeys(text))).toEqual({
      item1: 11,
      item2: 3,
      nonexistent: 2,
      пункт3: 5,
    });
  });

  it("reads each bracketed cluster, and leaves the author-in-text locators alone", () => {
    // The eleven brackets of the fixture that carry a key — the ones Pandoc
    // 3.10.1 parses through `normalCite`, read off `-t native`. A bracket
    // that follows an author-in-text key still joins that citation in the
    // AST: `[-@item2 …]` below adds its keys to `@item1`, and the keyless
    // locators (`[p. 30]`, `[p. 12]`) fold in as a suffix. A cluster scan
    // works on the source syntax, so it sees the brackets themselves.
    expect(
      scanCitationClusters(text).map((cluster) =>
        text.slice(cluster.start, cluster.end),
      ),
    ).toEqual([
      "[@nonexistent]",
      "[-@item2 p. 30; see also @пункт3]",
      "[see @item1 chap. 3; also @пункт3 p. 34-35]",
      "[see @item1 p. 34-35]",
      "[@item1 pp. 33, 35-37, and nowhere else]",
      "[@item1 and nowhere else]",
      "[*see* @item1 p. **32**]",
      "[@пункт3]",
      "[see @item1 chap. 3; @пункт3; @item2]",
      "[-@item1]",
      "[-@item2 p. 44]",
    ]);
  });
});
