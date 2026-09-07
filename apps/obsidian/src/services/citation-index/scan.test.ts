import { expect, it } from "vitest";

import { scanDocumentCitations } from "./scan";

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
