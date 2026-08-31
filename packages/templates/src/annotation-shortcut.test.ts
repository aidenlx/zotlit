import { describe, expect, it } from "vitest";

import { TemplateFacade } from "./facade";
import { TemplateEngine } from "./index";
import { createLiquidEngine } from "./liquid";

const callers = [
  {
    language: "liquid",
    source: "{% render_annotation zt.annotation %}",
    native: '{% render "annotation" with zt.annotation as zt %}',
  },
  {
    language: "eta",
    source: "<%~ renderAnnotation(zt.annotation) %>",
    native: '<%~ include("annotation", zt.annotation) %>',
  },
] as const;

describe.each(callers)("$language annotation shortcut", (caller) => {
  it.each(["liquid", "eta"] as const)(
    "binds only the supplied annotation as zt in a %s partial",
    (language) => {
      const facade = new TemplateFacade({
        transformRender: (name, output) =>
          name === "annotation" ? `[${output}]` : output,
      });
      facade.define(
        "annotation",
        language === "liquid"
          ? "{{ zt.pageLabel }}: {{ zt.text }}|{{ zt.title }}"
          : '<%= zt.pageLabel %>: <%= zt.text %>|<%= zt.title ?? "" %>',
        language,
      );
      facade.define("shortcut", caller.source, caller.language);
      facade.define("native", caller.native, caller.language);
      const data = {
        title: "Parent title",
        annotation: { pageLabel: "4", text: "**A**\n> B" },
      };

      expect(facade.render("shortcut", data)).toBe("[4: **A**\n> B|]");
      expect(facade.render("native", data)).toBe("[4: **A**\n> B|]");
    },
  );

  it("uses the current named partial and preserves Liquid precedence", () => {
    const facade = new TemplateFacade();
    facade.define("annotation", "Eta <%= zt.text %>", "eta");
    facade.define("annotation", "Liquid {{ zt.text }}", "liquid");
    facade.define("caller", caller.source, caller.language);
    const data = { annotation: { text: "A" } };

    expect(facade.render("caller", data)).toBe("Liquid A");
    facade.define("annotation", "Changed {{ zt.text }}", "liquid");
    expect(facade.render("caller", data)).toBe("Changed A");
    facade.remove("annotation", "liquid");
    expect(facade.render("caller", data)).toBe("Eta A");
    facade.remove("annotation", "eta");
    expect(() => facade.render("caller", data)).toThrow(
      'Template "annotation" not found',
    );
  });

  it.each([null, undefined])(
    "rejects %s instead of using parent zt",
    (value) => {
      const facade = new TemplateFacade();
      facade.define("annotation", "Wrong fallback", "liquid");
      facade.define("caller", caller.source, caller.language);

      expect(() => facade.render("caller", { annotation: value })).toThrow(
        "requires an annotation",
      );
    },
  );

  it("keeps the named partial separate from the Profile Annotation Block", () => {
    const facade = new TemplateFacade();
    facade.define("annotation", "Named {{ zt.text }}", "liquid");
    const document = facade.parseLiteratureNoteTemplate(`---
id: example
name: Example
version: 1.0.0
contract: 2
language: ${caller.language}
filename: note
---
{% managed %}${caller.source}{% endmanaged %}
{% annotation %}Profile block{% endannotation %}`);

    expect(
      facade.renderLiteratureNoteTemplateForUpdate(document, {
        annotation: { text: "A" },
      }),
    ).toBe("%%zt-managed%%\nNamed A\n%%/zt-managed%%");
    expect(
      facade.renderLiteratureNoteTemplateAnnotation(document, { text: "A" }),
    ).toBe("Profile block");
  });
});

describe("Liquid annotation shortcut", () => {
  it.each([
    "{% render_annotation %}",
    "{% render_annotation zt.annotation as other %}",
    "{% render_annotation zt.annotation, other: zt %}",
  ])("rejects invalid arguments: %s", (source) => {
    expect(() => createLiquidEngine().parse(source)).toThrow(
      "render_annotation requires one annotation argument",
    );
  });

  it.each(["nil", "null"])("rejects the %s literal", (value) => {
    expect(() =>
      createLiquidEngine().parseAndRenderSync(
        `{% render_annotation ${value} %}`,
      ),
    ).toThrow("requires an annotation");
  });

  it("preserves native isolated scope and exposes its input to analysis", () => {
    const facade = new TemplateFacade();
    facade.define(
      "annotation",
      '{{ outside }}{{ zt.text }}{% assign outside = "child" %}',
      "liquid",
    );
    facade.define(
      "caller",
      '{% assign outside = "parent" %}{% for annotation in zt.annotations %}{% render_annotation annotation %}{% endfor %}|{{ outside }}',
      "liquid",
    );

    expect(
      facade.render("caller", { annotations: [{ text: "A" }, { text: "B" }] }),
    ).toBe("AB|parent");
    expect(
      facade.analyzeRootVariables("caller")?.map((use) => use.path),
    ).toEqual(["zt.annotations"]);
    facade.define(
      "unbound",
      "{% render_annotation wrong.annotation %}",
      "liquid",
    );
    expect(facade.analyzeRootVariables("unbound")).toEqual([
      { name: "wrong", path: "wrong.annotation", row: 1, col: 22 },
    ]);
  });

  it("supports liquid statement blocks and native whitespace controls", () => {
    const facade = new TemplateFacade();
    facade.define("annotation", "{{ zt.text }}", "liquid");
    facade.define(
      "caller",
      "Before\n{% liquid\n  render_annotation zt.annotations[0]\n-%}\nAfter",
      "liquid",
    );

    expect(facade.render("caller", { annotations: [{ text: "A" }] })).toBe(
      "Before\nAAfter",
    );
  });

  it("keeps native custom aliases and named arguments available", () => {
    const facade = new TemplateFacade();
    facade.define("annotation", "{{ other.text }}{{ suffix }}", "liquid");
    facade.define(
      "caller",
      '{% render "annotation" with zt.annotation as other, suffix: "!" %}',
      "liquid",
    );

    expect(facade.render("caller", { annotation: { text: "A" } })).toBe("A!");
  });
});

describe("Eta annotation shortcut", () => {
  it("rejects a missing argument", () => {
    const engine = new TemplateEngine();
    engine.define("caller", "<%~ renderAnnotation() %>");

    expect(() => engine.render("caller", {})).toThrow(
      "renderAnnotation requires an annotation",
    );
  });

  it("works in the standalone engine's synchronous and asynchronous renders", async () => {
    const engine = new TemplateEngine();
    engine.define("annotation", "<%= zt.text %>");
    engine.define("caller", "<%~ renderAnnotation(zt.annotation) %>");
    const data = { annotation: { text: "**A**\n> B" } };

    expect(engine.render("caller", data)).toBe("**A**\n> B");
    await expect(engine.renderAsync("caller", data)).resolves.toBe(
      "**A**\n> B",
    );
  });
});
