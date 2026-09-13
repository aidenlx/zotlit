import citationEta from "@defaults/citation.eta?raw";
import citationLiquid from "@defaults/citation.liquid?raw";
import { describe, expect, it } from "vitest";

import { TemplateFacade } from "./facade";
import { inlineCitation } from "./inline-citation";

type CitationVariant = "main" | "alt";

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

/** The citation-template contract for one Citation Variant, from citekeys. */
function data(variant: CitationVariant, ...citationKeys: (string | null)[]) {
  const citations = citationKeys.map((key) => citation(key));
  return { variant, items: citations.map((c) => c.item), citations };
}

/** The same contract from fully-built Citation Items. */
function dataFrom(
  variant: CitationVariant,
  ...citations: ReturnType<typeof citation>[]
) {
  return { variant, items: citations.map((c) => c.item), citations };
}

/**
 * Render the built-in Citation Template the way ZotLit inserts it: the
 * template's own line structure collapses through {@link inlineCitation}.
 */
function renderCitation(source: string, language: "liquid" | "eta") {
  const facade = new TemplateFacade();
  facade.define("citation", source, language);
  return (root: ReturnType<typeof dataFrom>) =>
    inlineCitation(facade.render("citation", root));
}

describe("built-in Citation Template", () => {
  const render = renderCitation(citationLiquid, "liquid");

  it("renders the main variant bracketed", () => {
    expect(render(data("main", "smith2024"))).toBe("[@smith2024]");
  });

  it("renders the alt variant author-in-text", () => {
    expect(render(data("alt", "smith2024"))).toBe("@smith2024");
  });

  it("joins multiple cited items with a semicolon under main", () => {
    expect(render(data("main", "a2020", "b2021"))).toBe("[@a2020; @b2021]");
  });

  it("drops cited items whose citation key is null", () => {
    expect(render(data("main", "a2020", null, "b2021"))).toBe(
      "[@a2020; @b2021]",
    );
  });

  it("keeps a sentinel citekey so unresolved citations stay greppable", () => {
    expect(render(data("main", "KX67D9YM?"))).toBe("[@{KX67D9YM?}]");
  });

  it("renders a page locator with its labelShort abbreviation", () => {
    expect(
      render(dataFrom("main", citation("smith2024", { locator: "62" }))),
    ).toBe("[@smith2024, {p. 62}]");
  });

  it("renders a non-page labelShort abbreviation", () => {
    expect(
      render(
        dataFrom(
          "main",
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
    expect(
      render(dataFrom("main", citation("smith2024", { suppressAuthor: true }))),
    ).toBe("[-@smith2024]");
  });

  it("composes suppress-author with the sentinel citekey", () => {
    expect(
      render(dataFrom("main", citation("KX67D9YM?", { suppressAuthor: true }))),
    ).toBe("[-@{KX67D9YM?}]");
  });

  it("joins multiple items, each rendering its own citation-scoped props", () => {
    expect(
      render(
        dataFrom(
          "main",
          citation("a2020", { locator: "62" }),
          citation("b2021", { suppressAuthor: true }),
        ),
      ),
    ).toBe("[@a2020, {p. 62}; -@b2021]");
  });

  it("preserves Citation Prefix and Citation Suffix", () => {
    expect(
      render(
        dataFrom(
          "main",
          citation("smith2024", { prefix: "see ", suffix: ", note 4" }),
        ),
      ),
    ).toBe("[see @smith2024, note 4]");
  });

  it("keeps the alt variant's Locator in trailing brackets", () => {
    expect(
      render(dataFrom("alt", citation("smith2024", { locator: "62" }))),
    ).toBe("@smith2024 [{p. 62}]");
  });

  it("falls the alt variant back to a Citation Cluster for first-item Prefix", () => {
    expect(
      render(
        dataFrom(
          "alt",
          citation("smith2024", { prefix: "see " }),
          citation("wang2025"),
        ),
      ),
    ).toBe("[see @smith2024; @wang2025]");
  });

  it("falls the alt variant back to a Citation Cluster for Suppress Author", () => {
    expect(
      render(dataFrom("alt", citation("smith2024", { suppressAuthor: true }))),
    ).toBe("[-@smith2024]");
  });

  it("groups later alt-variant Citation Items in trailing brackets", () => {
    expect(
      render(
        dataFrom(
          "alt",
          citation("smith2024", { suffix: ", note 4" }),
          citation("wang2025", { suppressAuthor: true }),
        ),
      ),
    ).toBe("@smith2024 [, note 4; -@wang2025]");
  });

  it("reads an unknown variant as the main citation", () => {
    const root = { ...data("main", "smith2024"), variant: "surprise" };
    expect(render(root as ReturnType<typeof dataFrom>)).toBe("[@smith2024]");
  });
});

/**
 * The semantic cases above pin the expected source. This matrix checks that
 * the Liquid and the Eta edition render those behaviors byte-for-byte,
 * including the whitespace each embedded default owns.
 */
describe("the Liquid Citation Template default matches the Eta default byte-for-byte", () => {
  const matrix: [string, ReturnType<typeof dataFrom>][] = (
    ["main", "alt"] as const
  ).flatMap<[string, ReturnType<typeof dataFrom>]>((variant) => [
    [`${variant}: single citekey`, dataFrom(variant, citation("smith2024"))],
    [
      `${variant}: multiple citekeys`,
      dataFrom(variant, citation("a2020"), citation("b2021")),
    ],
    [
      `${variant}: null citekey dropped`,
      dataFrom(variant, citation("a2020"), citation(null), citation("b2021")),
    ],
    [`${variant}: sentinel citekey`, dataFrom(variant, citation("KX67D9YM?"))],
    [
      `${variant}: delimiter-bearing citekey`,
      dataFrom(variant, citation("key;part")),
    ],
    [`${variant}: empty input`, dataFrom(variant)],
    [
      `${variant}: all null citekeys`,
      dataFrom(variant, citation(null), citation(null)),
    ],
    [
      `${variant}: locator with labelShort`,
      dataFrom(variant, citation("smith2024", { locator: "62" })),
    ],
    [
      `${variant}: non-page label`,
      dataFrom(
        variant,
        citation("smith2024", {
          locator: "3",
          label: "chapter",
          labelShort: "chap.",
        }),
      ),
    ],
    [
      `${variant}: suppressAuthor`,
      dataFrom(variant, citation("smith2024", { suppressAuthor: true })),
    ],
    [
      `${variant}: suppressAuthor + sentinel`,
      dataFrom(variant, citation("KX67D9YM?", { suppressAuthor: true })),
    ],
    [
      `${variant}: multiple citation-scoped props`,
      dataFrom(
        variant,
        citation("a2020", { locator: "62" }),
        citation("b2021", { suppressAuthor: true }),
      ),
    ],
    [
      `${variant}: prefix and suffix`,
      dataFrom(
        variant,
        citation("smith2024", { prefix: "see ", suffix: ", note 4" }),
      ),
    ],
    [
      `${variant}: preferred-form prefix fallback`,
      dataFrom(
        variant,
        citation("smith2024", { prefix: "see " }),
        citation("wang2025"),
      ),
    ],
    [
      `${variant}: author suffix and later item`,
      dataFrom(
        variant,
        citation("smith2024", { suffix: ", note 4" }),
        citation("wang2025", { suppressAuthor: true }),
      ),
    ],
  ]);

  it.each(matrix)("%s", (_label, fixture) => {
    const eta = new TemplateFacade();
    eta.define("citation", citationEta, "eta");
    const liquid = new TemplateFacade();
    liquid.define("citation", citationLiquid, "liquid");

    expect(liquid.render("citation", fixture)).toBe(
      eta.render("citation", fixture),
    );
  });
});
