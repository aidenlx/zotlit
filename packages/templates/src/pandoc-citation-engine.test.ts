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
    unknownForm: expect.stringContaining("Unknown Pandoc Citation form"),
    invalidShape: expect.stringContaining("requires a Citation Item array"),
    unrepresentable: expect.stringContaining(
      "citation key Pandoc cannot represent",
    ),
  },
  {
    name: "Eta",
    language: "eta",
    invalidSource: '<%= pandocCite(zt.citations, "unknown") %>',
    validSource: "<%= pandocCite(zt.citations) %>",
    unknownForm: expect.objectContaining({
      name: "PandocCitationError",
      code: "invalid-input",
      property: "form",
    }),
    invalidShape: expect.objectContaining({
      name: "PandocCitationError",
      code: "invalid-input",
      property: "items",
    }),
    unrepresentable: expect.objectContaining({
      name: "PandocCitationError",
      code: "unrepresentable-value",
      property: "citationKey",
    }),
  },
] as const)(
  "$name Pandoc Citation Adapter",
  ({
    language,
    invalidSource,
    validSource,
    unknownForm,
    invalidShape,
    unrepresentable,
  }) => {
    it("rejects an unknown form", () => {
      const error = domainErrorOf(language, () =>
        render(language, invalidSource),
      );
      expect(error).toEqual(unknownForm);
    });

    it("rejects an invalid input shape", () => {
      const error = domainErrorOf(language, () =>
        render(language, validSource, {}),
      );
      expect(error).toEqual(invalidShape);
    });

    it("propagates domain errors", () => {
      const error = domainErrorOf(language, () =>
        render(language, validSource, [
          { ...citation, item: { citationKey: "Doe 2024" } },
        ]),
      );
      expect(error).toEqual(unrepresentable);
    });
  },
);
