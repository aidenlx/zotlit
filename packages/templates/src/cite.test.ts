import cite from "@defaults/cite.eta?raw";
import cite2 from "@defaults/cite2.eta?raw";
import { describe, expect, it } from "vitest";

import { TemplateEngine } from "./index";

/** A Citation Item at default props, optionally overriding citation-scoped props. */
function citation(
  citationKey: string | null,
  props: Partial<{
    locator: string | null;
    label: string | null;
    labelShort: string;
    suppressAuthor: boolean;
    prefix: string | null;
    suffix: string | null;
  }> = {},
) {
  return {
    item: { citationKey },
    locator: null,
    label: null,
    labelShort: "p.",
    suppressAuthor: false,
    prefix: null,
    suffix: null,
    ...props,
  };
}

/** The `{ items, citations }` cite-template contract from a list of citekeys. */
function data(...citationKeys: (string | null)[]) {
  const citations = citationKeys.map((key) => citation(key));
  return { items: citations.map((c) => c.item), citations };
}

/** The `{ items, citations }` contract from fully-built Citation Items. */
function dataFrom(...citations: ReturnType<typeof citation>[]) {
  return { items: citations.map((c) => c.item), citations };
}

function renderCite(name: "cite" | "cite2", source: string) {
  const engine = new TemplateEngine();
  engine.define(name, source);
  return (...citationKeys: (string | null)[]) =>
    engine.render(name, data(...citationKeys)).trim();
}

describe("default cite templates", () => {
  it("renders a single cited item bracketed via zt.citations", () => {
    expect(renderCite("cite", cite)("smith2024")).toBe("[@smith2024]");
  });

  it("renders cite2 without brackets", () => {
    expect(renderCite("cite2", cite2)("smith2024")).toBe("@smith2024");
  });

  it("joins multiple cited items with a semicolon", () => {
    expect(renderCite("cite", cite)("a2020", "b2021")).toBe("[@a2020; @b2021]");
  });

  it("drops cited items whose citation key is null", () => {
    expect(renderCite("cite", cite)("a2020", null, "b2021")).toBe(
      "[@a2020; @b2021]",
    );
  });

  it("keeps a sentinel citekey so unresolved cites stay greppable", () => {
    expect(renderCite("cite", cite)("KX67D9YM?")).toBe("[@KX67D9YM?]");
  });
});

describe("default cite templates: citation-scoped props (9.2-CSL #02)", () => {
  function renderCiteData(name: "cite" | "cite2", source: string) {
    const engine = new TemplateEngine();
    engine.define(name, source);
    return (data: ReturnType<typeof dataFrom>) =>
      engine.render(name, data).trim();
  }

  it("renders a page locator with its labelShort abbreviation", () => {
    const render = renderCiteData("cite", cite);
    expect(render(dataFrom(citation("smith2024", { locator: "62" })))).toBe(
      "[@smith2024, p. 62]",
    );
  });

  it("renders a non-page labelShort abbreviation", () => {
    const render = renderCiteData("cite", cite);
    expect(
      render(
        dataFrom(
          citation("smith2024", {
            locator: "3",
            label: "chapter",
            labelShort: "chap.",
          }),
        ),
      ),
    ).toBe("[@smith2024, chap. 3]");
  });

  it("prefixes a suppressed-author citation with a dash", () => {
    const render = renderCiteData("cite", cite);
    expect(
      render(dataFrom(citation("smith2024", { suppressAuthor: true }))),
    ).toBe("[-@smith2024]");
  });

  it("composes suppress-author with the sentinel citekey", () => {
    const render = renderCiteData("cite", cite);
    expect(
      render(dataFrom(citation("KX67D9YM?", { suppressAuthor: true }))),
    ).toBe("[-@KX67D9YM?]");
  });

  it("joins multiple items, each rendering its own citation-scoped props", () => {
    const render = renderCiteData("cite", cite);
    expect(
      render(
        dataFrom(
          citation("a2020", { locator: "62" }),
          citation("b2021", { suppressAuthor: true }),
        ),
      ),
    ).toBe("[@a2020, p. 62; -@b2021]");
  });

  it("carries prefix/suffix in data but omits them from the default output", () => {
    const render = renderCiteData("cite", cite);
    expect(
      render(
        dataFrom(citation("smith2024", { prefix: "see ", suffix: ", note 4" })),
      ),
    ).toBe("[@smith2024]");
  });

  it("renders cite2 without brackets, keeping the locator", () => {
    const render = renderCiteData("cite2", cite2);
    expect(render(dataFrom(citation("smith2024", { locator: "62" })))).toBe(
      "@smith2024, p. 62",
    );
  });
});
