import { describe, expect, it } from "vitest";

import type { CitationItemInput } from "./citation-items";
import { formatTexCitation, TexCitationError } from "./tex-citation";

function item(
  citationKey: string | null,
  overrides: Partial<CitationItemInput> = {},
): CitationItemInput {
  return {
    citationKey,
    prefix: null,
    suffix: null,
    locator: null,
    suppressAuthor: false,
    ...overrides,
  };
}

function errorOf(formatting: () => string): TexCitationError {
  try {
    formatting();
  } catch (error) {
    if (error instanceof TexCitationError) return error;
    throw error;
  }
  throw new Error("Expected formatting to fail");
}

describe("formatTexCitation", () => {
  it("wraps one citation key in the default command", () => {
    expect(formatTexCitation([item("doe2024")])).toBe("\\cite{doe2024}");
  });

  it("uses the requested command", () => {
    expect(formatTexCitation([item("doe2024")], "autocite")).toBe(
      "\\autocite{doe2024}",
    );
  });

  it("accepts a starred command", () => {
    expect(formatTexCitation([item("doe2024")], "autocite*")).toBe(
      "\\autocite*{doe2024}",
    );
  });

  it("joins every key into one command, in source order", () => {
    expect(
      formatTexCitation([item("doe2024"), item("wang2025"), item("li2023")]),
    ).toBe("\\cite{doe2024,wang2025,li2023}");
  });

  it("omits Citation Items with no citation key", () => {
    expect(formatTexCitation([item(null), item("doe2024"), item(null)])).toBe(
      "\\cite{doe2024}",
    );
  });

  it("returns an empty string when no keyed item remains", () => {
    expect(formatTexCitation([])).toBe("");
    expect(formatTexCitation([item(null)])).toBe("");
  });

  describe("prenote and postnote", () => {
    it("renders a Locator as the postnote", () => {
      expect(
        formatTexCitation([
          item("doe2024", { locator: { label: "p.", value: "3" } }),
        ]),
      ).toBe("\\cite[p. 3]{doe2024}");
    });

    it("renders a Citation Prefix as the prenote, with an empty postnote", () => {
      expect(formatTexCitation([item("doe2024", { prefix: "see " })])).toBe(
        "\\cite[see][]{doe2024}",
      );
    });

    it("renders a Citation Prefix and a Locator in their own slots", () => {
      expect(
        formatTexCitation([
          item("doe2024", {
            prefix: "see ",
            locator: { label: "p.", value: "3" },
          }),
        ]),
      ).toBe("\\cite[see][p. 3]{doe2024}");
    });

    it("appends the Citation Suffix to the Locator in one postnote", () => {
      expect(
        formatTexCitation([
          item("doe2024", {
            locator: { label: "p.", value: "3" },
            suffix: " and following",
          }),
        ]),
      ).toBe("\\cite[p. 3 and following]{doe2024}");
    });

    it("keeps Citation Suffix punctuation next to the Locator", () => {
      expect(
        formatTexCitation([
          item("doe2024", {
            locator: { label: "chap.", value: "2" },
            suffix: ", note 4",
          }),
        ]),
      ).toBe("\\cite[chap. 2, note 4]{doe2024}");
    });

    it("renders a Citation Suffix alone as the postnote", () => {
      expect(
        formatTexCitation([item("doe2024", { suffix: " and following" })]),
      ).toBe("\\cite[and following]{doe2024}");
    });

    it("takes the notes from the first keyed item and keeps later bare keys", () => {
      expect(
        formatTexCitation([
          item("doe2024", { locator: { label: "p.", value: "3" } }),
          item("wang2025"),
        ]),
      ).toBe("\\cite[p. 3]{doe2024,wang2025}");
    });

    it("protects a closing bracket so it cannot end the optional argument", () => {
      expect(
        formatTexCitation([item("doe2024", { suffix: " [review]" })]),
      ).toBe("\\cite[[review{]}]{doe2024}");
    });

    it("leaves an escaped bracket alone, since it ends no argument", () => {
      expect(formatTexCitation([item("doe2024", { suffix: " \\[x\\]" })])).toBe(
        "\\cite[\\[x\\]]{doe2024}",
      );
    });
  });

  describe("unrepresentable input", () => {
    it("rejects Suppress Author, which LaTeX has no general form for", () => {
      const error = errorOf(() =>
        formatTexCitation([item("doe2024", { suppressAuthor: true })]),
      );
      expect(error.code).toBe("unrepresentable-value");
      expect(error.property).toBe("suppressAuthor");
      expect(error.itemIndex).toBe(0);
    });

    it.each([
      { property: "prefix", overrides: { prefix: "compare " } },
      { property: "suffix", overrides: { suffix: ", note 4" } },
      {
        property: "locator",
        overrides: { locator: { label: "p.", value: "9" } },
      },
    ] as const)(
      "rejects a $property on a later keyed item, which has no slot",
      ({ property, overrides }) => {
        const error = errorOf(() =>
          formatTexCitation([item("doe2024"), item("wang2025", overrides)]),
        );
        expect(error.code).toBe("unrepresentable-value");
        expect(error.property).toBe(property);
        expect(error.itemIndex).toBe(1);
      },
    );

    it.each(["doe 2024", "doe,2024", "doe{2024", "doe}2024", "doe%2024", ""])(
      "rejects the citation key %j, which LaTeX cannot carry",
      (citationKey) => {
        const error = errorOf(() => formatTexCitation([item(citationKey)]));
        expect(error.code).toBe("unrepresentable-value");
        expect(error.property).toBe("citationKey");
        expect(error.itemIndex).toBe(0);
      },
    );

    it.each(["see {x", "see }x"])(
      "rejects an affix whose braces do not balance: %j",
      (prefix) => {
        const error = errorOf(() =>
          formatTexCitation([item("doe2024", { prefix })]),
        );
        expect(error.code).toBe("unsafe-affix");
        expect(error.property).toBe("prefix");
        expect(error.itemIndex).toBe(0);
      },
    );

    it("keeps balanced braces in an affix", () => {
      expect(
        formatTexCitation([item("doe2024", { prefix: "\\emph{see} " })]),
      ).toBe("\\cite[\\emph{see}][]{doe2024}");
    });

    it("counts an escaped brace as a literal, not as a group", () => {
      expect(
        formatTexCitation([item("doe2024", { prefix: "set \\{a\\} " })]),
      ).toBe("\\cite[set \\{a\\}][]{doe2024}");
    });

    it("rejects an unescaped percent, which would comment out the command", () => {
      const error = errorOf(() =>
        formatTexCitation([item("doe2024", { suffix: ", 50% more" })]),
      );
      expect(error.code).toBe("unsafe-affix");
      expect(error.property).toBe("suffix");
      expect(error.itemIndex).toBe(0);
    });

    it("keeps an escaped percent in an affix", () => {
      expect(
        formatTexCitation([item("doe2024", { suffix: ", 50\\% more" })]),
      ).toBe("\\cite[, 50\\% more]{doe2024}");
    });
  });

  describe("invalid input", () => {
    it.each(["", "cite{", "cite 2", "cite*x", "\\cite"])(
      "rejects the command %j, which is not a control word",
      (command) => {
        const error = errorOf(() =>
          formatTexCitation([item("doe2024")], command),
        );
        expect(error.code).toBe("invalid-input");
        expect(error.property).toBe("command");
      },
    );

    it("rejects a non-array input", () => {
      const error = errorOf(() => formatTexCitation(undefined as never));
      expect(error.code).toBe("invalid-input");
      expect(error.property).toBe("items");
    });

    it("rejects a Citation Item with an invalid shape", () => {
      const error = errorOf(() =>
        formatTexCitation([{ citationKey: "doe2024" } as never]),
      );
      expect(error.code).toBe("invalid-input");
      expect(error.property).toBe("items");
      expect(error.itemIndex).toBe(0);
    });
  });
});
