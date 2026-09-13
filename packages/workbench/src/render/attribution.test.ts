import { describe, expect, it } from "vitest";

import { TemplateFacade } from "@zotlit/templates/facade";

import { renderFailureDiagnostic } from "./attribution";

describe("render failure attribution", () => {
  it.each([
    "{% for annotation i zt.annotations %}{% endfor %}",
    "{% if true %}",
    "{{ zt.title",
    "{% unknown_tag %}",
  ])("identifies Liquid syntax errors: %s", (source) => {
    const facade = new TemplateFacade();
    expect.assertions(2);
    try {
      facade.define("note", source, "liquid");
      facade.render("note", {});
    } catch (error) {
      const diagnostic = renderFailureDiagnostic(error, {
        source,
        language: "liquid",
      });
      expect(diagnostic.code).toBe("liquid-syntax-error");
      expect(diagnostic.engine).toEqual({
        template: "note",
        line: 1,
        column: 1,
      });
    }
  });

  it.each([false, true])(
    "locates repeated partial calls only when the partial is missing (resolved: %s)",
    (resolved) => {
      const source =
        '{% if false %}{% render "venue-line" %}{% endif %}\n{% render "venue-line" %}';
      const facade = new TemplateFacade();
      facade.define("note", source, "liquid");
      if (resolved)
        facade.define("venue-line", '{{ "bad" | pandoc_cite }}', "liquid");

      expect.assertions(3);
      try {
        facade.render("note", {});
      } catch (error) {
        const diagnostic = renderFailureDiagnostic(error, {
          source,
          language: "liquid",
        });
        expect(diagnostic.code).toBe(
          resolved ? "render-error" : "missing-partial",
        );
        expect(diagnostic.callSite).toEqual(
          resolved ? undefined : { from: 14, to: 39 },
        );
        expect(diagnostic.engine?.template).toBe(
          resolved ? "venue-line" : "note",
        );
      }
    },
  );

  it.each([
    '{{ "bad" | pandoc_cite }}',
    '{{ zt.citations | pandoc_cite: "bad" }}',
    "{{ zt.citations | first | pandoc_cite }}",
    '{% assign zt = "bad" %}{{ zt.citations | pandoc_cite }}',
  ])("keeps invalid Citation text as a render error: %s", (citation) => {
    const source = '{% render "citation" with zt as zt %}';
    const facade = new TemplateFacade();
    facade.define("note", source, "liquid");
    facade.define("citation", citation, "liquid");

    expect.assertions(3);
    try {
      facade.render("note", { citations: [] });
    } catch (error) {
      const diagnostic = renderFailureDiagnostic(error, {
        source,
        language: "liquid",
      });
      expect(diagnostic.code).toBe("render-error");
      expect(diagnostic.engine?.template).toBe("citation");
      expect(diagnostic.callSite).toEqual({ from: 0, to: source.length });
    }
  });

  it.each(['{% render "citation" %}', '{% render "citation" with zt as zt %}'])(
    "identifies invalid caller data at the executed Citation call: %s",
    (source) => {
      const facade = new TemplateFacade();
      facade.define("note", source, "liquid");
      facade.define("citation", "{{ zt.citations | pandoc_cite }}", "liquid");
      expect.assertions(3);
      try {
        facade.render("note", { title: "A note root" });
      } catch (error) {
        const diagnostic = renderFailureDiagnostic(error, {
          source,
          language: "liquid",
        });
        expect(diagnostic.code).toBe("citation-data-mismatch");
        expect(diagnostic.engine?.template).toBe("citation");
        expect(diagnostic.callSite).toEqual({ from: 0, to: source.length });
      }
    },
  );
});
