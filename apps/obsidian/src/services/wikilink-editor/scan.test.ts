import { describe, expect, it } from "vitest";

import { scanWikilinks } from "./scan";
import type { TokenNode } from "./scan";

/**
 * The node list Obsidian's stream-parser bridge emits, built from
 * `[text, classes]` pairs in document order. A pair with no classes stands for
 * untyped text: it advances the offset without producing a node, the way plain
 * paragraph text is simply absent from the tree.
 *
 * Every class string below is copied from the tokenizer inventory in
 * docs/research/wikilink-editor-styling-hmd-syntax-tree.md — section 1.2.
 */
function nodes(...pairs: readonly (readonly [string, string])[]): TokenNode[] {
  const built: TokenNode[] = [];
  let offset = 0;
  for (const [text, classes] of pairs) {
    const from = offset;
    offset += text.length;
    if (classes === "") continue;
    built.push({ from, to: offset, classes: classes.split(" "), text });
  }
  return built;
}

const LINK_START = "formatting-link formatting-link-start";
const LINK_END = "formatting-link formatting-link-end";
const EMBED_START = "formatting-embed formatting-link formatting-link-start";

/** `see [[Note]] end` */
const PLAIN = nodes(
  ["see ", ""],
  ["[[", LINK_START],
  ["Note", "hmd-internal-link"],
  ["]]", LINK_END],
  [" end", ""],
);

describe("scanWikilinks", () => {
  it("reads a plain wikilink as Obsidian's own extent", () => {
    expect(scanWikilinks(PLAIN)).toEqual([
      {
        isEmbed: false,
        hasAlias: false,
        inner: { from: 6, to: 10 },
        outer: { from: 4, to: 12 },
        group: { from: 4, to: 12 },
        linktext: "Note",
        tokenClasses: ["hmd-internal-link"],
      },
    ]);
  });

  it("keeps the subpath in the linktext, since the tokenizer does not split it", () => {
    const scanned = scanWikilinks(
      nodes(
        ["[[", LINK_START],
        ["Note#cite:locator=7", "hmd-internal-link"],
        ["]]", LINK_END],
      ),
    );
    expect(scanned[0]?.linktext).toBe("Note#cite:locator=7");
  });

  it("splits the alias off the linktext", () => {
    const scanned = scanWikilinks(
      nodes(
        ["[[", LINK_START],
        ["Note", "hmd-internal-link link-has-alias"],
        ["|", "hmd-internal-link link-alias-pipe"],
        ["Alias", "hmd-internal-link link-alias"],
        ["]]", LINK_END],
      ),
    );
    expect(scanned[0]).toMatchObject({ hasAlias: true, linktext: "Note" });
  });

  it("splits on the first pipe, as Obsidian's own split does", () => {
    const scanned = scanWikilinks(
      nodes(
        ["[[", LINK_START],
        ["a", "hmd-internal-link link-has-alias"],
        ["|", "hmd-internal-link link-alias-pipe"],
        ["b", "hmd-internal-link link-alias"],
        ["|", "hmd-internal-link link-alias-pipe"],
        ["c", "hmd-internal-link link-alias"],
        ["]]", LINK_END],
      ),
    );
    expect(scanned[0]).toMatchObject({ hasAlias: true, linktext: "a" });
  });

  it("drops the backslash of an escaped alias pipe, which a table cell needs", () => {
    const scanned = scanWikilinks(
      nodes(
        ["[[", LINK_START],
        ["X", "hmd-internal-link link-has-alias"],
        ["\\", "formatting-escape hmd-internal-link link-has-alias"],
        ["|", "hmd-internal-link link-alias-pipe"],
        ["y", "hmd-internal-link link-alias"],
        ["]]", LINK_END],
      ),
    );
    expect(scanned[0]).toMatchObject({ hasAlias: true, linktext: "X" });
  });

  it("trims the linktext", () => {
    const scanned = scanWikilinks(
      nodes(
        ["[[", LINK_START],
        [" Note ", "hmd-internal-link"],
        ["]]", LINK_END],
      ),
    );
    expect(scanned[0]?.linktext).toBe("Note");
  });

  it("marks an embed, which Obsidian replaces whole", () => {
    const scanned = scanWikilinks(
      nodes(
        ["![[", EMBED_START],
        ["Image.png", "hmd-embed hmd-internal-link"],
        ["]]", LINK_END],
      ),
    );
    expect(scanned[0]).toMatchObject({ isEmbed: true, linktext: "Image.png" });
  });

  it("carries the contextual classes the token picked up", () => {
    const scanned = scanWikilinks(
      nodes(
        ["> ", ""],
        ["[[", `${LINK_START} quote quote-1`],
        ["Note", "hmd-internal-link quote quote-1"],
        ["]]", `${LINK_END} quote quote-1`],
      ),
    );
    expect(scanned[0]?.tokenClasses).toEqual([
      "hmd-internal-link",
      "quote",
      "quote-1",
    ]);
  });

  it("finds nothing in an empty link, which emits no interior node", () => {
    expect(scanWikilinks(nodes(["[[", LINK_START], ["]]", LINK_END]))).toEqual(
      [],
    );
  });

  it("finds nothing in an unclosed link, which tokenizes as a bare link", () => {
    const scanned = scanWikilinks(
      nodes(
        ["[[", "formatting formatting-link hmd-barelink link"],
        ["Unclosed", "hmd-barelink link"],
      ),
    );
    expect(scanned).toEqual([]);
  });

  it("finds every link of a region, in document order", () => {
    const scanned = scanWikilinks(
      nodes(
        ["[[", LINK_START],
        ["A", "hmd-internal-link"],
        ["]]", LINK_END],
        [" and ", ""],
        ["[[", LINK_START],
        ["B", "hmd-internal-link"],
        ["]]", LINK_END],
      ),
    );
    expect(scanned.map((span) => span.linktext)).toEqual(["A", "B"]);
  });
});

describe("scanWikilinks conceal groups", () => {
  it("ends the group at the first untyped text", () => {
    expect(scanWikilinks(PLAIN)[0]?.group).toEqual({ from: 4, to: 12 });
  });

  it("shares one group between two links written back to back", () => {
    const scanned = scanWikilinks(
      nodes(
        ["[[", LINK_START],
        ["A", "hmd-internal-link"],
        ["]]", LINK_END],
        ["[[", LINK_START],
        ["B", "hmd-internal-link"],
        ["]]", LINK_END],
      ),
    );
    expect(scanned.map((span) => span.group)).toEqual([
      { from: 0, to: 10 },
      { from: 0, to: 10 },
    ]);
  });

  it("grows the group across abutting emphasis", () => {
    const scanned = scanWikilinks(
      nodes(
        ["**", "formatting formatting-strong strong"],
        ["[[", `${LINK_START} strong`],
        ["Note", "hmd-internal-link strong"],
        ["]]", `${LINK_END} strong`],
        ["**", "formatting formatting-strong strong"],
      ),
    );
    expect(scanned[0]?.group).toEqual({ from: 0, to: 12 });
  });

  it("falls back to the link itself when no class names a group", () => {
    const scanned = scanWikilinks(
      nodes(
        ["[[", "formatting-link-start"],
        ["Note", "hmd-internal-link"],
        ["]]", "formatting-link-end"],
      ),
    );
    // The opener and closer carry no group class here, so the group is the run
    // of interior nodes; the link's own extent is the wider answer.
    expect(scanned[0]?.group).toEqual({ from: 0, to: 8 });
  });
});
