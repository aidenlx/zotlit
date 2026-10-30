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

describe("tex_cite Liquid filter", () => {
  it("formats the Citation Item array", () => {
    expect(render("liquid", "{{ zt.citations | tex_cite }}")).toBe(
      "\\cite{doe2024}",
    );
  });

  it("accepts a command argument", () => {
    expect(render("liquid", '{{ zt.citations | tex_cite: "autocite" }}')).toBe(
      "\\autocite{doe2024}",
    );
  });

  it("maps the template Locator shape onto the postnote", () => {
    expect(
      render("liquid", "{{ zt.citations | tex_cite }}", [
        { ...citation, locator: "3" },
      ]),
    ).toBe("\\cite[p. 3]{doe2024}");
  });
});

describe("texCite Eta helper", () => {
  it("matches the Liquid filter", () => {
    expect(render("eta", "<%= texCite(zt.citations) %>")).toBe(
      "\\cite{doe2024}",
    );
    expect(render("eta", '<%= texCite(zt.citations, "autocite") %>')).toBe(
      "\\autocite{doe2024}",
    );
  });
});

describe.each([
  {
    name: "Liquid",
    language: "liquid",
    source: '{{ zt.citations | tex_cite: "cite{" }}',
  },
  {
    name: "Eta",
    language: "eta",
    source: '<%= texCite(zt.citations, "cite{") %>',
  },
] as const)("$name rejects an invalid command", ({ language, source }) => {
  it("fails the render rather than emitting broken source", () => {
    expect(() => render(language, source)).toThrow();
  });
});
