import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  formatPandocCitation,
  PandocCitationError,
  scanPandocCitations,
} from "./pandoc-citation";
import type { PandocCitationItem } from "./pandoc-citation";

function item(
  citationKey: string | null,
  overrides: Partial<PandocCitationItem> = {},
): PandocCitationItem {
  return {
    citationKey,
    prefix: null,
    suffix: null,
    locator: null,
    suppressAuthor: false,
    ...overrides,
  };
}

describe("formatPandocCitation", () => {
  it("formats one complete normal Citation", () => {
    expect(formatPandocCitation([item("doe2024")])).toBe("[@doe2024]");
  });

  it("keeps Citation Items in source order", () => {
    expect(formatPandocCitation([item("doe2024"), item("wang2025")])).toBe(
      "[@doe2024; @wang2025]",
    );
  });

  it("preserves each Citation Prefix and Citation Suffix byte", () => {
    expect(
      formatPandocCitation([
        item("doe2024", { prefix: "see ", suffix: ", note 4" }),
        item("wang2025", { prefix: "compare ", suffix: " [review]" }),
      ]),
    ).toBe("[see @doe2024, note 4; compare @wang2025 [review]]");
  });

  it("formats Suppress Author on the Citation Item that requests it", () => {
    expect(
      formatPandocCitation([
        item("doe2024"),
        item("wang2025", { suppressAuthor: true }),
      ]),
    ).toBe("[@doe2024; -@wang2025]");
  });

  it.each(["3", "iv", "章三", "3-5, 7"])(
    "uses explicit Locator syntax for %s",
    (value) => {
      expect(
        formatPandocCitation([
          item("doe2024", { locator: { label: "p.", value } }),
        ]),
      ).toBe(`[@doe2024, {p. ${value}}]`);
    },
  );

  it("uses the braced key form when the simple form would lose punctuation", () => {
    expect(
      formatPandocCitation([
        item("KX67D9YM?"),
        item("doe,2024"),
        item("a{b}c"),
      ]),
    ).toBe("[@{KX67D9YM?}; @{doe,2024}; @{a{b}c}]");
  });

  it("omits null-keyed items and keeps the remaining order", () => {
    expect(
      formatPandocCitation([
        item("a"),
        item(null, { prefix: "ignored ", suffix: " ignored" }),
        item("b"),
      ]),
    ).toBe("[@a; @b]");
  });

  it("returns empty source when no keyed Citation Item remains", () => {
    expect(formatPandocCitation([])).toBe("");
    expect(formatPandocCitation([item(null)])).toBe("");
  });

  it.each(["", "Doe 2024", "line\nbreak"])(
    "rejects the unrepresentable citation key %j",
    (citationKey) => {
      expect(() => formatPandocCitation([item(citationKey)])).toThrowError(
        expect.objectContaining({
          name: "PandocCitationError",
          code: "unrepresentable-value",
          itemIndex: 0,
          property: "citationKey",
        }),
      );
    },
  );

  it("uses one typed error family", () => {
    expect(
      (() => {
        try {
          formatPandocCitation([item("")]);
        } catch (error) {
          return error;
        }
      })(),
    ).toBeInstanceOf(PandocCitationError);
  });

  it("prefers a standalone Author-in-text Citation", () => {
    expect(
      formatPandocCitation([item("doe2024")], "prefer-author-in-text"),
    ).toBe("@doe2024");
  });

  it("keeps a first-item Locator and Citation Suffix in trailing brackets", () => {
    expect(
      formatPandocCitation(
        [
          item("doe2024", {
            locator: { label: "p.", value: "3" },
            suffix: ", note 4",
          }),
        ],
        "prefer-author-in-text",
      ),
    ).toBe("@doe2024 [{p. 3}, note 4]");
  });

  it("groups later Citation Items with the Author-in-text Citation", () => {
    expect(
      formatPandocCitation(
        [
          item("doe2024"),
          item("wang2025"),
          item("lee2026", { suppressAuthor: true }),
        ],
        "prefer-author-in-text",
      ),
    ).toBe("@doe2024 [@wang2025; -@lee2026]");
  });

  it("keeps first-item trailing properties before later Citation Items", () => {
    expect(
      formatPandocCitation(
        [
          item("doe2024", {
            locator: { label: "chap.", value: "iv" },
            suffix: ", overview",
          }),
          item("wang2025", { prefix: "compare " }),
        ],
        "prefer-author-in-text",
      ),
    ).toBe("@doe2024 [{chap. iv}, overview; compare @wang2025]");
  });

  it.each([
    ["Citation Prefix", { prefix: "see " }],
    ["Suppress Author", { suppressAuthor: true }],
  ] as const)("falls back to normal form for first-item %s", (_name, first) => {
    expect(
      formatPandocCitation(
        [item(null), item("doe2024", first), item("wang2025")],
        "prefer-author-in-text",
      ),
    ).toBe(
      "suppressAuthor" in first
        ? "[-@doe2024; @wang2025]"
        : "[see @doe2024; @wang2025]",
    );
  });

  it.each([
    ["prefix", "[see @other] ", null],
    ["suffix", null, "; @other"],
    ["suffix", null, "] @other"],
    ["prefix", "line\nbreak ", null],
  ] as const)(
    "rejects a %s that changes Citation structure",
    (property, prefix, suffix) => {
      expect(() =>
        formatPandocCitation([item("doe2024", { prefix, suffix })]),
      ).toThrowError(
        expect.objectContaining({
          code: "unsafe-affix",
          itemIndex: 0,
          property,
        }),
      );
    },
  );

  it.each([
    ["locator.label", { label: "p. extra", value: "3" }],
    ["locator.label", { label: "", value: "3" }],
    ["locator.label", { label: "p.}", value: "3" }],
    ["locator.value", { label: "p.", value: "" }],
    ["locator.value", { label: "p.", value: "3}" }],
    ["locator.value", { label: "p.", value: "3-5; appendix" }],
    ["locator.value", { label: "p.", value: "3\n4" }],
  ] as const)("rejects an unsafe %s", (property, locator) => {
    expect(() =>
      formatPandocCitation([item("doe2024", { locator })]),
    ).toThrowError(
      expect.objectContaining({
        code: "unsafe-locator",
        itemIndex: 0,
        property,
      }),
    );
  });

  it.each([
    ["items", null],
    ["items", {}],
    ["items", [{ citationKey: "doe2024" }]],
  ] as const)("rejects invalid %s input", (property, input) => {
    expect(() =>
      formatPandocCitation(input as unknown as PandocCitationItem[]),
    ).toThrowError(
      expect.objectContaining({ code: "invalid-input", property }),
    );
  });

  it("rejects an unknown form", () => {
    expect(() =>
      formatPandocCitation([item("doe2024")], "author-in-text" as "normal"),
    ).toThrowError(
      expect.objectContaining({ code: "invalid-input", property: "form" }),
    );
  });
});

describe("scanPandocCitations", () => {
  it("scans one normal Citation through the public Interface", () => {
    expect(scanPandocCitations("See [@doe2024].")).toEqual([
      {
        start: 4,
        end: 14,
        mode: "normal",
        items: [
          {
            start: 5,
            end: 13,
            citationKey: "doe2024",
            mode: "normal",
            suppressAuthor: false,
            prefix: null,
            suffix: null,
            locator: null,
          },
        ],
      },
    ]);
  });

  it("retains normal Citation Item properties and key spans", () => {
    const source = "[see @doe2024, {p. 3}, note 4; compare -@wang2025]";
    const [citation] = scanPandocCitations(source);

    expect(citation).toMatchObject({
      start: 0,
      end: source.length,
      mode: "normal",
      items: [
        {
          citationKey: "doe2024",
          mode: "normal",
          suppressAuthor: false,
          prefix: "see ",
          suffix: ", note 4",
          locator: { label: "p.", value: "3" },
        },
        {
          citationKey: "wang2025",
          mode: "suppress-author",
          suppressAuthor: true,
          prefix: "compare ",
          suffix: null,
          locator: null,
        },
      ],
    });
    expect(
      citation!.items.map(({ start, end }) => source.slice(start, end)),
    ).toEqual(["@doe2024", "-@wang2025"]);
  });

  it("groups an Author-in-text Citation with its trailing items", () => {
    const source =
      "Before @doe2024 [{chap. iv}, overview; compare @wang2025; -@lee2026] after";
    const [citation] = scanPandocCitations(source);

    expect(source.slice(citation!.start, citation!.end)).toBe(
      "@doe2024 [{chap. iv}, overview; compare @wang2025; -@lee2026]",
    );
    expect(citation).toMatchObject({
      mode: "author-in-text",
      items: [
        {
          citationKey: "doe2024",
          mode: "author-in-text",
          prefix: null,
          suffix: ", overview",
          locator: { label: "chap.", value: "iv" },
        },
        {
          citationKey: "wang2025",
          mode: "normal",
          prefix: "compare ",
        },
        {
          citationKey: "lee2026",
          mode: "suppress-author",
          suppressAuthor: true,
        },
      ],
    });
  });

  it("recognizes standalone Author-in-text and Suppress Author Citations", () => {
    expect(
      scanPandocCitations("@doe2024 and -@wang2025").map((citation) => ({
        mode: citation.mode,
        itemMode: citation.items[0]!.mode,
        citationKey: citation.items[0]!.citationKey,
      })),
    ).toEqual([
      {
        mode: "author-in-text",
        itemMode: "author-in-text",
        citationKey: "doe2024",
      },
      {
        mode: "suppress-author",
        itemMode: "suppress-author",
        citationKey: "wang2025",
      },
    ]);
  });

  it("uses half-open UTF-16 offsets before and inside a Citation", () => {
    const source = "😀 [@{文献?}]";
    const [citation] = scanPandocCitations(source);
    const [citationItem] = citation!.items;

    expect(citation).toMatchObject({ start: 3, end: 11 });
    expect(citationItem).toMatchObject({ start: 4, end: 10 });
    expect(source.slice(citation!.start, citation!.end)).toBe("[@{文献?}]");
    expect(source.slice(citationItem!.start, citationItem!.end)).toBe(
      "@{文献?}",
    );
  });

  it("finds Citations in source order and leaves ordinary text alone", () => {
    expect(
      scanPandocCitations(
        "mail a@b.com; [an aside]; malformed [@a; prose]; `[@code]`; [@ok] then @text",
      ).map(({ mode, items }) => [mode, items.map((item) => item.citationKey)]),
    ).toEqual([
      ["author-in-text", ["a"]],
      ["normal", ["ok"]],
      ["author-in-text", ["text"]],
    ]);
  });

  it("does not treat link labels, attributes, or footnote references as Citations", () => {
    expect(
      scanPandocCitations(
        "[@link](https://example.com) [@ref][id] [@span]{.class} [^@foot] @ok",
      ).map((citation) => citation.items.map((item) => item.citationKey)),
    ).toEqual([["ok"]]);
  });

  it("matches Pandoc 3.10.1's pinned citation fixture", () => {
    const source = readFileSync(
      new URL("./__fixtures__/pandoc-markdown-citations.md", import.meta.url),
      "utf8",
    );
    const citationKeys = scanPandocCitations(source).flatMap((citation) =>
      citation.items.map((item) => item.citationKey),
    );
    const tally = Object.groupBy(citationKeys, (citationKey) => citationKey);

    expect(
      Object.fromEntries(
        Object.entries(tally).map(([citationKey, entries]) => [
          citationKey,
          entries!.length,
        ]),
      ),
    ).toEqual({
      item1: 11,
      item2: 3,
      nonexistent: 2,
      пункт3: 5,
    });
  });
});
