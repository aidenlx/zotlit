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

  it("uses the Profile section for shortcuts, native calls, and shared partials", () => {
    const facade = new TemplateFacade();
    facade.define("annotation", "Global {{ zt.text }}", "liquid");
    facade.define(
      "shared",
      `${caller.source}|${caller.native}`,
      caller.language,
    );
    facade.define("generic", caller.source, caller.language);
    const sharedCall =
      caller.language === "liquid"
        ? '{% render "shared" with zt as zt %}'
        : '<%~ include("shared", zt) %>';
    const annotation =
      caller.language === "liquid"
        ? "{{ outside }}{{ zt.text }}{{ zt.title }}"
        : '<%= typeof outside === "undefined" ? "" : outside %><%= zt.text %><%= zt.title ?? "" %>';
    const outside =
      caller.language === "liquid"
        ? '{% assign outside = "LEAK" %}'
        : '<% const outside = "LEAK"; %>';
    const source = `---
id: example
name: Example
version: 1.0.0
contract: 2
language: ${caller.language}
filename: note
---
${outside}${caller.source}|${caller.native}|${sharedCall}
{% managed %}${outside}${caller.source}|${caller.native}|${sharedCall}{% endmanaged %}
--- zotlit:annotation ---
Profile ${annotation}`;
    const a = facade.parseLiteratureNoteTemplate(source);
    const b = facade.parseLiteratureNoteTemplate(
      source.replace("Profile ", "Other "),
    );
    const data = { title: "LEAK", annotation: { text: "A" } };

    for (const document of [a, b, a]) {
      const expected = document === b ? "Other A" : "Profile A";
      expect(facade.renderLiteratureNoteTemplateForUpdate(document, data)).toBe(
        `%%zt-managed%%\n${expected}|${expected}|${expected}|${expected}\n%%/zt-managed%%`,
      );
      expect(facade.renderLiteratureNoteTemplateForCreate(document, data)).toBe(
        `${expected}|${expected}|${expected}|${expected}\n%%zt-managed%%\n${expected}|${expected}|${expected}|${expected}\n%%/zt-managed%%\n`,
      );
      expect(
        facade.renderLiteratureNoteTemplateAnnotation(document, { text: "A" }),
      ).toBe(expected);
      expect(facade.render("generic", data)).toBe("Global A");
    }
  });

  it("renders an empty Profile section and needs no global annotation partial", () => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(`---
id: empty
name: Empty
version: 1.0.0
contract: 2
language: ${caller.language}
filename: note
---
${caller.source}|${caller.native}
--- zotlit:annotation ---`);
    expect(
      facade.renderLiteratureNoteTemplateForCreate(document, {
        annotation: { text: "A" },
      }),
    ).toBe("|\n");
    expect(
      facade.renderLiteratureNoteTemplateAnnotation(document, { text: "A" }),
    ).toBe("");
  });

  it.each(callers)(
    "keeps the Profile source through a $language shared partial",
    (shared) => {
      const facade = new TemplateFacade();
      facade.define("shared", shared.source, shared.language);
      const call =
        caller.language === "liquid"
          ? '{% render "shared" with zt as zt %}'
          : '<%~ include("shared", zt) %>';
      const document = facade.parseLiteratureNoteTemplate(`---
id: mixed
name: Mixed
version: 1.0.0
contract: 2
language: ${caller.language}
filename: note
---
${call}
--- zotlit:annotation ---
Local ${caller.language === "liquid" ? "{{ zt.text }}" : "<%= zt.text %>"}`);
      expect(
        facade.renderLiteratureNoteTemplateForCreate(document, {
          annotation: { text: "A" },
        }),
      ).toBe("Local A\n");
    },
  );

  it("restores generic lookup after a Profile render fails", () => {
    const facade = new TemplateFacade();
    facade.define("annotation", "Global {{ zt.text }}", "liquid");
    facade.define("generic", caller.source, caller.language);
    const document = facade.parseLiteratureNoteTemplate(`---
id: failure
name: Failure
version: 1.0.0
contract: 2
language: ${caller.language}
filename: note
---
${caller.source}
--- zotlit:annotation ---
${caller.source}`);
    expect(() =>
      facade.renderLiteratureNoteTemplateForCreate(document, {
        annotation: { text: "A" },
      }),
    ).toThrow("requires an annotation");
    expect(facade.render("generic", { annotation: { text: "A" } })).toBe(
      "Global A",
    );
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

describe("Nested Profile rendering", () => {
  it("restores each Profile binding across a nested render and generic render", () => {
    const facade = new TemplateFacade();
    facade.define("annotation", "Global <%= zt.text %>", "eta");
    const source = `---
id: nested
name: Nested
version: 1.0.0
contract: 2
language: eta
filename: note
---
<%~ renderAnnotation(zt.annotation) %>|<%~ zt.nested() %>|<%~ zt.generic() %>|<%~ renderAnnotation(zt.annotation) %>
--- zotlit:annotation ---
Outer <%= zt.text %>`;
    const outer = facade.parseLiteratureNoteTemplate(source);
    const inner = facade.parseLiteratureNoteTemplate(
      source.replace("Outer ", "Inner "),
    );
    expect(
      facade.renderLiteratureNoteTemplateForCreate(outer, {
        annotation: { text: "A" },
        nested: () =>
          facade.renderLiteratureNoteTemplateAnnotation(inner, { text: "B" }),
        generic: () => facade.render("annotation", { text: "C" }),
      }),
    ).toBe("Outer A|Inner B|Global C|Outer A\n");
  });
});
