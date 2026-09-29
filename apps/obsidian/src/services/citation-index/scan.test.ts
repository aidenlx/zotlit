import { expect, it } from "vitest";

import { maskWikilinks, scanDocumentCitations } from "./scan";

it("groups an Author-in-text Citation with its trailing items", () => {
  const source = "Before @a [{p. 3}; @b] after";
  const citations = scanDocumentCitations(source);

  expect(citations).toHaveLength(1);
  const citation = citations[0]!;
  expect(source.slice(citation.start, citation.end)).toBe("@a [{p. 3}; @b]");
  expect(
    citation.keys.map(({ citekey, start, end }) => ({
      citekey,
      source: source.slice(start, end),
    })),
  ).toEqual([
    { citekey: "a", source: "@a" },
    { citekey: "b", source: "@b" },
  ]);
});

// Pandoc reads `[[@a]]` as a wikilink, so its inner `[@a]` is no citation; only
// the Wikilink Citations path may count such a link.
it("reads no citation inside a wikilink or an embed", () => {
  const source = "See [[@a]] and ![[@b|B]], then [@c] and [[Note]] @d.";
  expect(
    scanDocumentCitations(source).map(({ start, end }) =>
      source.slice(start, end),
    ),
  ).toEqual(["[@c]", "@d"]);
});

it("keeps every offset when it masks a wikilink", () => {
  const source = "a [[@x]] b\n[[unclosed @y\n";
  const masked = maskWikilinks(source);
  expect(masked).toHaveLength(source.length);
  expect(masked).toBe("a        b\n[[unclosed @y\n");
});
