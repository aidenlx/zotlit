import { describe, expect, it } from "vitest";

import { TemplateFacade } from "./facade";

const citation = {
  item: { citationKey: "doe2024" },
  prefix: null,
  suffix: null,
  locator: null,
  labelShort: "p.",
  suppressAuthor: false,
};

function render(
  language: "liquid" | "eta",
  source: string,
  citations: unknown = [citation],
): string {
  const facade = new TemplateFacade();
  facade.define("cite", source, language);
  return facade.render("cite", { citations });
}

function errorOf(rendering: () => string): Error {
  try {
    rendering();
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected rendering to fail");
}

function domainErrorOf(
  language: "liquid" | "eta",
  rendering: () => string,
): unknown {
  const error = errorOf(rendering);
  return language === "liquid" ? error.message : error.cause;
}

describe("pandoc_cite Liquid filter", () => {
  it("formats the Citation Item array", () => {
    expect(render("liquid", "{{ zt.citations | pandoc_cite }}")).toBe(
      "[@doe2024]",
    );
  });

  it("accepts prefer-author-in-text", () => {
    expect(
      render(
        "liquid",
        '{{ zt.citations | pandoc_cite: "prefer-author-in-text" }}',
      ),
    ).toBe("@doe2024");
  });
});

describe("pandocCite Eta helper", () => {
  it("matches the Liquid filter", () => {
    expect(render("eta", "<%= pandocCite(zt.citations) %>")).toBe("[@doe2024]");
    expect(
      render("eta", '<%= pandocCite(zt.citations, "prefer-author-in-text") %>'),
    ).toBe("@doe2024");
  });
});

describe.each([
  {
    name: "Liquid",
    language: "liquid",
    invalidSource: '{{ zt.citations | pandoc_cite: "unknown" }}',
    validSource: "{{ zt.citations | pandoc_cite }}",
  },
  {
    name: "Eta",
    language: "eta",
    invalidSource: '<%= pandocCite(zt.citations, "unknown") %>',
    validSource: "<%= pandocCite(zt.citations) %>",
  },
] as const)(
  "$name Pandoc Citation Adapter",
  ({ language, invalidSource, validSource }) => {
    it("rejects an unknown form", () => {
      const error = domainErrorOf(language, () =>
        render(language, invalidSource),
      );
      if (language === "liquid") {
        expect(error).toContain("Unknown Pandoc Citation form");
      } else {
        expect(error).toEqual(
          expect.objectContaining({
            name: "PandocCitationError",
            code: "invalid-input",
            property: "form",
          }),
        );
      }
    });

    it("rejects an invalid input shape", () => {
      const error = domainErrorOf(language, () =>
        render(language, validSource, {}),
      );
      if (language === "liquid") {
        expect(error).toContain("requires a Citation Item array");
      } else {
        expect(error).toEqual(
          expect.objectContaining({
            name: "PandocCitationError",
            code: "invalid-input",
            property: "items",
          }),
        );
      }
    });

    it("propagates domain errors", () => {
      const error = domainErrorOf(language, () =>
        render(language, validSource, [
          { ...citation, item: { citationKey: "Doe 2024" } },
        ]),
      );
      if (language === "liquid") {
        expect(error).toContain("citation key Pandoc cannot represent");
      } else {
        expect(error).toEqual(
          expect.objectContaining({
            name: "PandocCitationError",
            code: "unrepresentable-value",
            property: "citationKey",
          }),
        );
      }
    });
  },
);
