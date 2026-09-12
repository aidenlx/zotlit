import citationEta from "@defaults/citation.eta?raw";
import citationLiquid from "@defaults/citation.liquid?raw";
import { describe, expect, it } from "vitest";

import {
  foldLegacyCitationTemplates,
  LegacyTemplateConversionError,
  TemplateFacade,
} from "./facade";

/** The citation-template data root for one Citation Variant, from citekeys. */
function data(variant: "main" | "alt", ...citationKeys: string[]) {
  const citations = citationKeys.map((citationKey) => ({
    item: { citationKey },
    locator: null,
    label: null,
    labelShort: "p.",
    suppressAuthor: false,
    prefix: null,
    suffix: null,
  }));
  return { variant, items: citations.map((c) => c.item), citations };
}

const both = {
  main: data("main", "smith2024"),
  alt: data("alt", "smith2024"),
};

describe("foldLegacyCitationTemplates", () => {
  it("reproduces the packaged Liquid Citation Template from the built-in branches", () => {
    expect(foldLegacyCitationTemplates({ language: "liquid" })).toBe(
      citationLiquid,
    );
  });

  it("reproduces the packaged Eta Citation Template from the built-in branches", () => {
    expect(foldLegacyCitationTemplates({ language: "eta" })).toBe(citationEta);
  });

  it("indents each legacy source under the variant branch it answers", () => {
    expect(
      foldLegacyCitationTemplates({
        language: "liquid",
        main: "[{{ zt.citations | pandoc_cite }}]\n",
        alt: "{% for c in zt.citations %}\n@{{ c.item.citationKey }}\n{% endfor %}\n",
      }),
    ).toBe(
      `{% if zt.variant == "alt" %}
  {% for c in zt.citations %}
  @{{ c.item.citationKey }}
  {% endfor %}
{% else %}
  [{{ zt.citations | pandoc_cite }}]
{% endif %}
`,
    );
  });
});

describe("TemplateFacade.convertLegacyCitationTemplates", () => {
  it("keeps both gestures on the text their legacy file rendered", () => {
    const converted = new TemplateFacade().convertLegacyCitationTemplates(
      {
        language: "liquid",
        main: "<{{ zt.citations | pandoc_cite }}>\n",
        alt: "{{ zt.citations | pandoc_cite: 'prefer-author-in-text' }}!\n",
      },
      both,
    );

    expect(converted.rendered).toEqual({
      main: "<[@smith2024]>",
      alt: "@smith2024!",
    });
  });

  it("keeps the gesture whose legacy file the vault never held on the built-in text", () => {
    const converted = new TemplateFacade().convertLegacyCitationTemplates(
      { language: "liquid", main: "<{{ zt.citations | pandoc_cite }}>\n" },
      both,
    );

    expect(converted.rendered).toEqual({
      main: "<[@smith2024]>",
      alt: "@smith2024",
    });
  });

  it("folds an Eta pair through the Eta helper", () => {
    const converted = new TemplateFacade().convertLegacyCitationTemplates(
      {
        language: "eta",
        main: "<%= pandocCite(zt.citations) %>.\n",
        alt: '<%= pandocCite(zt.citations, "prefer-author-in-text") %>.\n',
      },
      both,
    );

    expect(converted.rendered).toEqual({
      main: "[@smith2024].",
      alt: "@smith2024.",
    });
  });

  it("collapses a multi-line legacy source to the same inline citation", () => {
    const converted = new TemplateFacade().convertLegacyCitationTemplates(
      {
        language: "liquid",
        main: "{% for c in zt.citations %}\n@{{ c.item.citationKey }}\n{% endfor %}\n",
      },
      {
        main: data("main", "a2020", "b2021"),
        alt: data("alt", "a2020", "b2021"),
      },
    );

    expect(converted.rendered.main).toBe("@a2020 @b2021");
  });

  it("refuses a legacy source that calls a partial the vault never registered", () => {
    expect(() =>
      new TemplateFacade().convertLegacyCitationTemplates(
        { language: "liquid", main: '{% render "authors" %}\n' },
        both,
      ),
    ).toThrow('Template "authors" not found');
  });

  it("verifies the fold against the registry the removed names have left", () => {
    const facade = new TemplateFacade();
    facade.define("cite", "@{{ zt.citations[0].item.citationKey }}", "liquid");
    const legacy = {
      language: "liquid",
      alt: '{% render "cite" with zt as zt %}!\n',
    } as const;

    // The `cite` slot still renders now, so verifying against the live
    // registry would accept a fold that fails on the first insert after the
    // pass trashes the file behind it.
    expect(
      facade.convertLegacyCitationTemplates(legacy, both).rendered.alt,
    ).toBe("@smith2024!");
    expect(() =>
      facade.convertLegacyCitationTemplates(legacy, both, {
        removedNames: ["cite", "cite2"],
      }),
    ).toThrow(LegacyTemplateConversionError);
    expect(() =>
      facade.convertLegacyCitationTemplates(legacy, both, {
        removedNames: ["cite", "cite2"],
      }),
    ).toThrow('Template "cite" not found');
  });

  it("names the differing variant when a folded branch drifts", () => {
    const facade = new TemplateFacade();
    // A legacy source that reads the Citation Variant itself renders one way
    // standalone and the other through the fold, which is the drift the
    // byte verification exists to catch.
    const drift = () =>
      facade.convertLegacyCitationTemplates(
        { language: "liquid", alt: "{{ zt.variant }}\n" },
        { main: both.main, alt: { ...both.alt, variant: "main" } },
      );

    expect(drift).toThrow(LegacyTemplateConversionError);
    expect(drift).toThrow(/alternate citation output/);
  });
});
