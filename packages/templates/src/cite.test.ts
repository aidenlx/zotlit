import cite from "@defaults/cite.eta?raw";
import citeLiquid from "@defaults/cite.liquid?raw";
import cite2 from "@defaults/cite2.eta?raw";
import cite2Liquid from "@defaults/cite2.liquid?raw";
import { describe, expect, it } from "vitest";

import { TemplateFacade } from "./facade";
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

  it("renders cite2 as an Author-in-text Citation", () => {
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
    expect(renderCite("cite", cite)("KX67D9YM?")).toBe("[@{KX67D9YM?}]");
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
      "[@smith2024, {p. 62}]",
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
    ).toBe("[@smith2024, {chap. 3}]");
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
    ).toBe("[-@{KX67D9YM?}]");
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
    ).toBe("[@a2020, {p. 62}; -@b2021]");
  });

  it("preserves Citation Prefix and Citation Suffix", () => {
    const render = renderCiteData("cite", cite);
    expect(
      render(
        dataFrom(citation("smith2024", { prefix: "see ", suffix: ", note 4" })),
      ),
    ).toBe("[see @smith2024, note 4]");
  });

  it("keeps cite2's Locator in trailing brackets", () => {
    const render = renderCiteData("cite2", cite2);
    expect(render(dataFrom(citation("smith2024", { locator: "62" })))).toBe(
      "@smith2024 [{p. 62}]",
    );
  });

  it("falls cite2 back to a Citation Cluster for first-item Prefix", () => {
    const render = renderCiteData("cite2", cite2);
    expect(
      render(
        dataFrom(
          citation("smith2024", { prefix: "see " }),
          citation("wang2025"),
        ),
      ),
    ).toBe("[see @smith2024; @wang2025]");
  });

  it("falls cite2 back to a Citation Cluster for Suppress Author", () => {
    const render = renderCiteData("cite2", cite2);
    expect(
      render(dataFrom(citation("smith2024", { suppressAuthor: true }))),
    ).toBe("[-@smith2024]");
  });

  it("groups later cite2 Citation Items in trailing brackets", () => {
    const render = renderCiteData("cite2", cite2);
    expect(
      render(
        dataFrom(
          citation("smith2024", { suffix: ", note 4" }),
          citation("wang2025", { suppressAuthor: true }),
        ),
      ),
    ).toBe("@smith2024 [, note 4; -@wang2025]");
  });
});

/**
 * The semantic cases above pin the expected source. This matrix checks that
 * Liquid and Eta render those behaviors byte-for-byte, including the trailing
 * newline owned by each embedded default.
 */
describe("Liquid cite/cite2 defaults match Eta defaults byte-for-byte", () => {
  const matrix: [string, ReturnType<typeof dataFrom>][] = [
    ["single citekey", dataFrom(citation("smith2024"))],
    ["multiple citekeys", dataFrom(citation("a2020"), citation("b2021"))],
    [
      "null citekey dropped",
      dataFrom(citation("a2020"), citation(null), citation("b2021")),
    ],
    ["sentinel citekey", dataFrom(citation("KX67D9YM?"))],
    ["delimiter-bearing citekey", dataFrom(citation("key;part"))],
    ["empty input", dataFrom()],
    ["all null citekeys", dataFrom(citation(null), citation(null))],
    [
      "locator with labelShort",
      dataFrom(citation("smith2024", { locator: "62" })),
    ],
    [
      "non-page label",
      dataFrom(
        citation("smith2024", {
          locator: "3",
          label: "chapter",
          labelShort: "chap.",
        }),
      ),
    ],
    [
      "suppressAuthor",
      dataFrom(citation("smith2024", { suppressAuthor: true })),
    ],
    [
      "suppressAuthor + sentinel",
      dataFrom(citation("KX67D9YM?", { suppressAuthor: true })),
    ],
    [
      "multiple citation-scoped props",
      dataFrom(
        citation("a2020", { locator: "62" }),
        citation("b2021", { suppressAuthor: true }),
      ),
    ],
    [
      "prefix and suffix",
      dataFrom(citation("smith2024", { prefix: "see ", suffix: ", note 4" })),
    ],
    [
      "preferred-form prefix fallback",
      dataFrom(citation("smith2024", { prefix: "see " }), citation("wang2025")),
    ],
    [
      "preferred-form suppress-author fallback",
      dataFrom(citation("smith2024", { suppressAuthor: true })),
    ],
    [
      "author suffix and later item",
      dataFrom(
        citation("smith2024", { suffix: ", note 4" }),
        citation("wang2025", { suppressAuthor: true }),
      ),
    ],
  ];

  it.each([
    ["cite", cite, citeLiquid],
    ["cite2", cite2, cite2Liquid],
  ] as const)("%s", (name, etaSource, liquidSource) => {
    const eta = new TemplateFacade();
    eta.define(name, etaSource, "eta");
    const liquid = new TemplateFacade();
    liquid.define(name, liquidSource, "liquid");

    for (const [_label, fixture] of matrix) {
      expect(liquid.render(name, fixture)).toBe(eta.render(name, fixture));
    }
  });
});
