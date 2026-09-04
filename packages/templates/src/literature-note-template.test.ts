import annotationEta from "@defaults/annotation.eta?raw";
import annotationLiquid from "@defaults/annotation.liquid?raw";
import { describe, expect, it } from "vitest";

import type { FrontmatterField } from "./constants";
import {
  convertLegacyFrontmatterFields,
  literatureNoteTemplateManifestRange,
  TemplateFacade,
} from "./facade";
import type { LiteratureNoteTemplateError } from "./facade";
import { formatManagedRegion } from "./obsidian";

function documentWithFrontmatter(frontmatter: string): string {
  return `---
id: example.frontmatter
name: Frontmatter note
version: 1.0.0
author: Ada Example
description: Managed Frontmatter test.
contract: 2
filename: note
frontmatter:${frontmatter}
---
Body\n--- zotlit:annotation ---\nAnnotation`;
}

function expectInvalidFrontmatter(frontmatter: string, target: string): void {
  const facade = new TemplateFacade();
  expect(() =>
    facade.parseLiteratureNoteTemplate(documentWithFrontmatter(frontmatter)),
  ).toThrowError(
    expect.objectContaining<Partial<LiteratureNoteTemplateError>>({
      code: "invalid-manifest",
      message: expect.stringContaining(target),
      recovery: expect.any(String),
    }),
  );
}

describe("Literature Note Template document", () => {
  it.each(["liquid", "eta"] as const)(
    "splits the final %s Annotation Section without changing source bytes",
    (language) => {
      const facade = new TemplateFacade();
      const source = `---\r\nid: section\r\nname: Section\r\nversion: 1.0.0\r\ncontract: 2\r\nfilename: note\r\nlanguage: ${language}\r\n---\r\nNote\r\n\r\n--- zotlit:annotation ---\r\n\r\nAnnotation\r\n`;
      const document = facade.parseLiteratureNoteTemplate(source);

      expect(document.body).toBe("Note\r\n\r\n");
      expect(document.annotationSection.source).toBe("\r\nAnnotation\r\n");
      expect(
        source.slice(
          document.bodyStart,
          document.annotationSection.headerStart,
        ),
      ).toBe("Note\r\n\r\n");
      expect(
        source.slice(
          document.annotationSection.start,
          document.annotationSection.end,
        ),
      ).toBe("\r\nAnnotation\r\n");
      const edited = `${source.slice(0, document.annotationSection.start)}Changed${source.slice(document.annotationSection.end)}`;
      expect(
        facade.parseLiteratureNoteTemplate(edited).annotationSection.source,
      ).toBe("Changed");
    },
  );

  it.each([
    {
      language: "liquid" as const,
      note: 'Before\n{% render "content" with zt as zt %}\nAfter {{ zt.title }}',
      content: "Managed {{ zt.title }}",
      filename: "{{ zt.citationKey }}\n",
    },
    {
      language: "eta" as const,
      note: 'Before\n<%~ include("content", zt) %>\nAfter <%= zt.title %>',
      content: "Managed <%= zt.title %>",
      filename: "<%= zt.citationKey %>\n",
    },
  ])(
    "converts legacy $language templates with byte-identical renders",
    ({ language, note, content, filename }) => {
      const facade = new TemplateFacade({
        transformRender: (name, output) =>
          name === "content" ? formatManagedRegion(output) : output,
      });
      facade.define("note", note, language);
      facade.define("content", content, language);
      facade.define("filename", filename, language);

      const converted = facade.convertLegacyLiteratureNoteTemplates(
        {
          note: { source: note, language },
          content: { source: content, language },
          filename: { source: filename, language },
        },
        {
          note: { title: "Paper" },
          filename: { citationKey: "doePaper" },
        },
      );

      expect(converted.source).toContain(
        `{% managed %}\n${content}{% endmanaged %}`,
      );
      expect(converted.rendered).toEqual({
        create: `${facade.render("note", { title: "Paper" })}\n`,
        update: facade.render("content", { title: "Paper" }),
        filename: facade.render("filename", { citationKey: "doePaper" }),
        annotation: null,
      });
    },
  );

  it("refuses a conversion when the legacy note has no supported content insertion", () => {
    const facade = new TemplateFacade();
    facade.define("note", "User-owned body", "liquid");
    facade.define("content", "Managed", "liquid");
    facade.define("filename", "note", "liquid");

    expect(() =>
      facade.convertLegacyLiteratureNoteTemplates(
        {
          note: { source: "User-owned body", language: "liquid" },
          content: { source: "Managed", language: "liquid" },
          filename: { source: "note", language: "liquid" },
        },
        { note: {}, filename: {} },
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "unsupported-legacy-template",
        difference: "content insertion",
        recovery: expect.any(String),
      }),
    );
  });

  it("moves legacy frontmatter fields structurally and evaluates only the converted entries", () => {
    const facade = new TemplateFacade({
      transformRender: (name, output) =>
        name === "content" ? formatManagedRegion(output) : output,
    });
    const note = '{% render "content" with zt as zt %}';
    facade.define("note", note, "liquid");
    facade.define("content", "Managed", "liquid");
    facade.define("filename", "note", "liquid");
    const data = { title: "Paper", count: 1, evaluations: 0 };
    const fields = [
      {
        key: "title",
        expr: "  zt.title  ",
        merge: "keep",
        language: "liquid",
      },
      {
        key: "count",
        expr: "++zt.evaluations && zt.count + 1",
        merge: "append",
        language: "javascript",
      },
    ] as const satisfies readonly FrontmatterField[];

    const converted = facade.convertLegacyLiteratureNoteTemplates(
      {
        note: { source: note, language: "liquid" },
        content: { source: "Managed", language: "liquid" },
        filename: { source: "note", language: "liquid" },
      },
      { note: data, filename: {} },
      { frontmatter: fields, javascript: true },
    );

    expect(converted.document.manifest.frontmatter).toEqual([
      { key: "title", expr: "  zt.title  ", merge: "keep" },
      {
        key: "count",
        js: "++zt.evaluations && zt.count + 1",
        merge: "append",
      },
    ]);
    expect(converted.frontmatterPatch).toEqual({ title: "Paper", count: 2 });
    expect(data.evaluations).toBe(1);
  });

  it("maps expression strings without parsing or rewriting them", () => {
    expect(
      convertLegacyFrontmatterFields([
        {
          key: "liquid",
          expr: "  invalid | expression: [  ",
          merge: "replace",
          language: "liquid",
        },
        {
          key: "javascript",
          expr: "(()",
          merge: "keep",
          language: "javascript",
        },
      ]),
    ).toEqual([
      {
        key: "liquid",
        expr: "  invalid | expression: [  ",
        merge: "replace",
      },
      { key: "javascript", js: "(()", merge: "keep" },
    ]);
  });

  it("dry-runs every merge strategy across every frontmatter output kind", () => {
    const expressions = [
      ["null", null],
      ["true", true],
      ["42", 42],
      ['"text"', "text"],
      ['["one", "two"]', ["one", "two"]],
      ['({ nested: "value" })', { nested: "value" }],
    ] as const;

    for (const merge of ["replace", "append", "keep"] as const) {
      for (const [expr, expected] of expressions) {
        const facade = new TemplateFacade({
          transformRender: (name, output) =>
            name === "content" ? formatManagedRegion(output) : output,
        });
        const note = '{% render "content" with zt as zt %}';
        facade.define("note", note, "liquid");
        facade.define("content", "Managed", "liquid");
        facade.define("filename", "note", "liquid");

        const converted = facade.convertLegacyLiteratureNoteTemplates(
          {
            note: { source: note, language: "liquid" },
            content: { source: "Managed", language: "liquid" },
            filename: { source: "note", language: "liquid" },
          },
          { note: {}, filename: {} },
          {
            frontmatter: [
              { key: "field", expr, merge, language: "javascript" },
            ],
            javascript: true,
          },
        );

        expect(converted.frontmatterPatch).toEqual({ field: expected });
      }
    }
  });

  it("refuses a conversion when note and content use different languages", () => {
    const facade = new TemplateFacade();
    facade.define("note", '{% render "content" with zt as zt %}', "liquid");
    facade.define("content", "Managed", "eta");
    facade.define("filename", "note", "liquid");

    expect(() =>
      facade.convertLegacyLiteratureNoteTemplates(
        {
          note: {
            source: '{% render "content" with zt as zt %}',
            language: "liquid",
          },
          content: { source: "Managed", language: "eta" },
          filename: { source: "note", language: "liquid" },
        },
        { note: {}, filename: {} },
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "unsupported-legacy-template",
        difference: "template language",
      }),
    );
  });

  it("folds an ejected annotation template with byte-identical output", () => {
    const facade = new TemplateFacade({
      transformRender: (name, output) =>
        name === "content" ? formatManagedRegion(output) : output,
    });
    const note = '{% render "content" with zt as zt %}';
    const content = "Managed {{ zt.title }}";
    const filename = "{{ zt.citationKey }}";
    const annotation = "Annotation {{ zt.text }}";
    facade.define("note", note, "liquid");
    facade.define("content", content, "liquid");
    facade.define("filename", filename, "liquid");
    facade.define("annotation", annotation, "liquid");

    const converted = facade.convertLegacyLiteratureNoteTemplates(
      {
        note: { source: note, language: "liquid" },
        content: { source: content, language: "liquid" },
        filename: { source: filename, language: "liquid" },
        annotation: { source: annotation, language: "liquid" },
      },
      {
        note: { title: "Paper" },
        filename: { citationKey: "doePaper" },
        annotation: { text: "Excerpt" },
      },
    );

    expect(converted.document.annotationSection.source).toBe(annotation);
    expect(converted.rendered.annotation).toBe("Annotation Excerpt");
  });

  it.each(["liquid", "eta"] as const)(
    "checks the %s conversion baseline with generic annotation lookup",
    (language) => {
      const facade = new TemplateFacade({
        transformRender: (name, output) =>
          name === "content" ? formatManagedRegion(output) : output,
      });
      const legacy = {
        note: {
          source:
            language === "liquid"
              ? '{% render "content" with zt as zt %}'
              : '<%~ include("content", zt) %>',
          language,
        },
        content: {
          source:
            language === "liquid"
              ? "{% render_annotation zt.annotation %}"
              : "<%~ renderAnnotation(zt.annotation) %>",
          language,
        },
        filename: { source: "note", language },
        annotation: {
          source:
            language === "liquid"
              ? "Legacy {{ zt.text }}"
              : "Legacy <%= zt.text %>",
          language,
        },
      };
      for (const [name, template] of Object.entries(legacy))
        facade.define(name, template.source, template.language);
      const data = {
        note: { annotation: { text: "A" } },
        filename: {},
        annotation: { text: "A" },
      };
      expect(
        facade.convertLegacyLiteratureNoteTemplates(legacy, data).rendered,
      ).toEqual({
        create: "%%zt-managed%%\nLegacy A\n%%/zt-managed%%\n",
        update: "%%zt-managed%%\nLegacy A\n%%/zt-managed%%",
        filename: "note",
        annotation: "Legacy A",
      });
      expect(() =>
        facade.convertLegacyLiteratureNoteTemplates(
          { ...legacy, annotation: { source: "Changed", language } },
          data,
        ),
      ).toThrowError(
        expect.objectContaining({
          code: "legacy-render-mismatch",
          difference: "create output",
        }),
      );
      expect(facade.render("annotation", { text: "A" })).toBe("Legacy A");
    },
  );

  it("refuses an annotation fold whose rendered bytes differ", () => {
    const facade = new TemplateFacade({
      transformRender: (name, output) =>
        name === "content" ? formatManagedRegion(output) : output,
    });
    const note = '{% render "content" with zt as zt %}';
    facade.define("note", note, "liquid");
    facade.define("content", "Managed", "liquid");
    facade.define("filename", "note", "liquid");
    facade.define("annotation", "Legacy {{ zt.text }}", "liquid");

    expect(() =>
      facade.convertLegacyLiteratureNoteTemplates(
        {
          note: { source: note, language: "liquid" },
          content: { source: "Managed", language: "liquid" },
          filename: { source: "note", language: "liquid" },
          annotation: {
            source: "Changed {{ zt.text }}",
            language: "liquid",
          },
        },
        { note: {}, filename: {}, annotation: { text: "Excerpt" } },
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "legacy-render-mismatch",
        difference: "annotation output",
      }),
    );
  });

  it.each([
    {
      language: "liquid" as const,
      note: '{% render "content" with zt as zt %}',
      defaultAnnotation: annotationLiquid,
    },
    {
      language: "eta" as const,
      note: '<%~ include("content", zt) %>',
      defaultAnnotation: annotationEta,
    },
  ])(
    "seeds the embedded default as a trailing $language Annotation Section for an un-ejected annotation slot",
    ({ language, note, defaultAnnotation }) => {
      const facade = new TemplateFacade({
        transformRender: (name, output) =>
          name === "content" ? formatManagedRegion(output) : output,
      });
      facade.define("note", note, language);
      facade.define("content", "Managed", language);
      facade.define("filename", "note", language);

      const converted = facade.convertLegacyLiteratureNoteTemplates(
        {
          note: { source: note, language },
          content: { source: "Managed", language },
          filename: { source: "note", language },
        },
        { note: {}, filename: {} },
      );

      expect(converted.document.annotationSection.source).toBe(
        defaultAnnotation,
      );
      expect(
        converted.source.endsWith(
          `\n--- zotlit:annotation ---\n${defaultAnnotation}`,
        ),
      ).toBe(true);
      expect(converted.rendered.annotation).toBeNull();
    },
  );

  it.each([
    "folder: Books",
    "citationStyle: null",
    "importFolder: Notes",
    "importColoredHighlights: false",
    "importAnnotationsAsTemplate: true",
  ])("rejects default Profile bindings: %s", (binding) => {
    expect(() =>
      new TemplateFacade().parseLiteratureNoteTemplate(`---
id: default
name: Default
version: 1.0.0
contract: 2
filename: note
${binding}
---
Body\n--- zotlit:annotation ---\nAnnotation`),
    ).toThrowError(expect.objectContaining({ code: "invalid-manifest" }));
  });

  it("accepts optional envelope fields and rejects retired profileDefaults", () => {
    const source = `---
id: Bk3Qn7XvT2Lp
name: Books
version: 1.0.0
contract: 2
filename: note
---
Body\n--- zotlit:annotation ---\nAnnotation`;
    const facade = new TemplateFacade();
    expect(facade.parseLiteratureNoteTemplate(source).manifest.name).toBe(
      "Books",
    );
    expect(() =>
      facade.parseLiteratureNoteTemplate(
        source.replace("contract: 2", "contract: 2\nprofileDefaults: {}"),
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid-manifest" }));
  });

  it("parses the manifest, body, and Managed Block", () => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(`---
id: example.paper-note
name: Paper note
version: 1.2.0
author: Ada Example
description: A compact note for papers.
contract: 2
minAppVersion: 2.3.0
sampleItemType: journalArticle
filename: "{{ zt.citationKey }}"
folder: Literature
citationStyle: apa
importFolder: Imported
importColoredHighlights: true
importAnnotationsAsTemplate: false
language: liquid
---
# {{ zt.title }}

{% managed %}Managed body{% endmanaged %}
--- zotlit:annotation ---\nAnnotation body`);

    expect(document.manifest).toEqual({
      id: "example.paper-note",
      name: "Paper note",
      version: "1.2.0",
      author: "Ada Example",
      description: "A compact note for papers.",
      contract: 2,
      minAppVersion: "2.3.0",
      sampleItemType: "journalArticle",
      filename: "{{ zt.citationKey }}",
      folder: "Literature",
      citationStyle: "apa",
      importFolder: "Imported",
      importColoredHighlights: true,
      importAnnotationsAsTemplate: false,
      language: "liquid",
    });
    expect(document.body).toBe(
      "# {{ zt.title }}\n\n{% managed %}Managed body{% endmanaged %}\n",
    );
    expect(document.managedBlock?.source).toBe("Managed body");
  });

  it.each(["liquid", "eta"] as const)(
    "parses and renders an isolated %s Annotation Section",
    (language) => {
      const facade = new TemplateFacade();
      const outside =
        language === "liquid"
          ? '{% assign outside = "leak" %}'
          : '<% const outside = "leak" %>';
      const annotation =
        language === "liquid"
          ? "{% if outside %}LEAK{% else %}{{ zt.text }}{% endif %}"
          : '<% if (typeof outside !== "undefined") { %>LEAK<% } else { %><%= zt.text %><% } %>';
      const document = facade.parseLiteratureNoteTemplate(`---
id: example.annotation-${language}
name: Annotation note
version: 1.0.0
author: Ada Example
description: Tests Annotation Section rendering.
contract: 2
filename: note
language: ${language}
---
${outside}BeforeAfter\n--- zotlit:annotation ---\n${annotation}`);

      expect(document.annotationSection.source).toBe(annotation);
      expect(
        facade.renderLiteratureNoteTemplateForCreate(document, {
          text: "ROOT",
        }),
      ).toBe("BeforeAfter\n");
      expect(
        facade.renderLiteratureNoteTemplateAnnotation(document, {
          text: "ROOT",
        }),
      ).toBe("ROOT");
    },
  );

  it("refuses a document without an Annotation Section", () => {
    const facade = new TemplateFacade();

    expect(() =>
      facade.parseLiteratureNoteTemplate(`---
id: example.no-annotation
name: No annotation
version: 1.0.0
author: Ada Example
description: Has no Annotation Section.
contract: 2
filename: note
---
Body`),
    ).toThrowError(
      expect.objectContaining<Partial<LiteratureNoteTemplateError>>({
        code: "missing-annotation-section",
        message: expect.stringContaining("--- zotlit:annotation ---"),
        recovery: expect.any(String),
      }),
    );
  });

  it("keeps the Annotation Section out of the Managed Block", () => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(`---
id: example.nested-annotation
name: Nested annotation
version: 1.0.0
author: Ada Example
description: Keeps Annotation Section bytes out of note renders.
contract: 2
filename: note
---
Before{% managed %}AB{% endmanaged %}After\n--- zotlit:annotation ---\nANNOTATION`);
    const managed = formatManagedRegion("AB");

    expect(facade.renderLiteratureNoteTemplateForCreate(document, {})).toBe(
      `Before${managed}After\n`,
    );
    expect(facade.renderLiteratureNoteTemplateForUpdate(document, {})).toBe(
      managed,
    );
  });

  it("compiles every source a document renders, and defines none of them", () => {
    const facade = new TemplateFacade();
    const source = `---
id: example.compile
name: Compile check
version: 1.0.0
author: Ada Example
description: Compiles without rendering.
contract: 2
filename: '{{ zt.key }}'
---
Before{% managed %}{{ zt.title }}{% endmanaged %}After\n--- zotlit:annotation ---\n{{ zt.text }}`;

    facade.compileLiteratureNoteTemplate(
      facade.parseLiteratureNoteTemplate(source),
    );
    // Nothing the check compiled stays behind, so a later render resolves the
    // same names it would have without it.
    expect(() => facade.render("example.compile:compile:0", {})).toThrowError(
      /not found/,
    );

    const broken = facade.parseLiteratureNoteTemplate(
      source.replace("After", "After{% for %}"),
    );
    expect(() => facade.compileLiteratureNoteTemplate(broken)).toThrowError();
  });

  it("renders an isolated Liquid Managed Block identically for create and update", () => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(`---
id: example.liquid
name: Liquid note
version: 1.0.0
author: Ada Example
description: Tests Liquid rendering.
contract: 2
filename: note
language: liquid
---
{% assign outside = "leak" %}A{% managed %}{% if outside %}LEAK{% elsif zt.title == "Paper" %}INNER{% endif %}{% endmanaged %}{% if outside == "leak" %}Z{% endif %}\n--- zotlit:annotation ---\nAnnotation`);

    const created = facade.renderLiteratureNoteTemplateForCreate(document, {
      title: "Paper",
    });
    const updated = facade.renderLiteratureNoteTemplateForUpdate(document, {
      title: "Paper",
    });

    const region = formatManagedRegion("INNER");
    expect(created).toBe(`A${region}Z\n`);
    expect(updated).toBe(region);
  });

  it("renders an isolated Eta Managed Block identically for create and update", () => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(`---
id: example.eta
name: Eta note
version: 1.0.0
author: Ada Example
description: Tests Eta rendering.
contract: 2
filename: note
language: eta
---
<% const outside = "leak" %>A{% managed %}<% if (typeof outside !== "undefined") { %>LEAK<% } else if (zt.title === "Paper") { %>INNER<% } %>{% endmanaged %}<% if (outside === "leak") { %>Z<% } %>\n--- zotlit:annotation ---\nAnnotation`);

    const created = facade.renderLiteratureNoteTemplateForCreate(document, {
      title: "Paper",
    });
    const updated = facade.renderLiteratureNoteTemplateForUpdate(document, {
      title: "Paper",
    });

    const region = formatManagedRegion("INNER");
    expect(created).toBe(`A${region}Z\n`);
    expect(updated).toBe(region);
  });

  it("preserves rendered text that matches the internal block placeholder", () => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(`---
id: example.placeholder
name: Placeholder note
version: 1.0.0
author: Ada Example
description: Tests placeholder collisions.
contract: 2
filename: note
---
{{ zt.prefix }}{% managed %}Managed{% endmanaged %}\n--- zotlit:annotation ---\nAnnotation`);

    expect(
      facade.renderLiteratureNoteTemplateForCreate(document, {
        prefix: "__ZOTLIT_MANAGED_BLOCK_0__",
      }),
    ).toBe(`__ZOTLIT_MANAGED_BLOCK_0__${formatManagedRegion("Managed")}\n`);
  });

  it("uses the canonical Managed Region whitespace on create and update", () => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(`---
id: example.region
name: Region note
version: 1.0.0
author: Ada Example
description: Tests Managed Region formatting.
contract: 2
filename: note
---
Before{% managed %}
  Managed body
{% endmanaged %}After\n--- zotlit:annotation ---\nAnnotation`);

    const region = formatManagedRegion("Managed body");
    expect(facade.renderLiteratureNoteTemplateForCreate(document, {})).toBe(
      `Before${region}After\n`,
    );
    expect(facade.renderLiteratureNoteTemplateForUpdate(document, {})).toBe(
      region,
    );
  });

  it.each([
    [
      "conditional",
      "{% if false %}{% managed %}Hidden{% endmanaged %}{% endif %}",
    ],
    [
      "loop",
      "{% for value in (1..2) %}{% managed %}Repeated{% endmanaged %}{% endfor %}",
    ],
  ])("refuses a Managed Block placed inside a Liquid %s", (_name, body) => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(`---
id: example.placement
name: Placement note
version: 1.0.0
author: Ada Example
description: Tests block placement.
contract: 2
filename: note
---
${body}\n--- zotlit:annotation ---\nAnnotation`);

    expect(() =>
      facade.renderLiteratureNoteTemplateForCreate(document, {}),
    ).toThrowError(
      expect.objectContaining<Partial<LiteratureNoteTemplateError>>({
        code: "invalid-managed-block",
        recovery: expect.stringContaining("top level"),
      }),
    );
  });

  it("treats Managed Block tags inside Liquid raw and comment blocks as literals", () => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(`---
id: example.literal
name: Literal tags
version: 1.0.0
author: Ada Example
description: Tests literal tags.
contract: 2
filename: note
---
{% raw %}{% managed %}Raw{% endmanaged %}{% endraw %}
{% comment %}{% managed %}Comment{% endmanaged %}{% endcomment %}\n--- zotlit:annotation ---\nAnnotation`);

    expect(document.managedBlock).toBeNull();
    expect(facade.renderLiteratureNoteTemplateForCreate(document, {})).toBe(
      "{% managed %}Raw{% endmanaged %}\n",
    );
  });

  it("uses Liquid defaults and returns no update for a static body", () => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(`---
id: example.static
name: Static note
version: 1.0.0
author: Ada Example
description: User-owned body.
contract: 2
filename: Static
---
Static body\n--- zotlit:annotation ---\nAnnotation`);

    expect(document.manifest.language).toBe("liquid");
    expect(document.manifest.citationStyle).toBeUndefined();
    expect(facade.renderLiteratureNoteTemplateForCreate(document, {})).toBe(
      "Static body\n",
    );
    expect(
      facade.renderLiteratureNoteTemplateForUpdate(document, {}),
    ).toBeNull();
  });

  it("rejects a duplicate Managed Block before rendering", () => {
    const facade = new TemplateFacade();

    expect(() =>
      facade.parseLiteratureNoteTemplate(`---
id: example.duplicate
name: Duplicate note
version: 1.0.0
author: Ada Example
description: Invalid duplicate blocks.
contract: 2
filename: note
---
{% managed %}First{% endmanaged %}
{% managed %}Second{% endmanaged %}
--- zotlit:annotation ---\nAnnotation`),
    ).toThrowError(
      expect.objectContaining<Partial<LiteratureNoteTemplateError>>({
        code: "duplicate-managed-block",
        message: expect.stringContaining("Duplicate {% managed %} block"),
      }),
    );
  });

  it("rejects a duplicate Annotation Section before rendering", () => {
    const facade = new TemplateFacade();

    expect(() =>
      facade.parseLiteratureNoteTemplate(`---
id: example.duplicate-annotation
name: Duplicate annotation
version: 1.0.0
author: Ada Example
description: Invalid duplicate Annotation Sections.
contract: 2
filename: note
---
--- zotlit:annotation ---\nFirst\n--- zotlit:annotation ---\nSecond`),
    ).toThrowError(
      expect.objectContaining<Partial<LiteratureNoteTemplateError>>({
        code: "duplicate-annotation-section",
        message: expect.stringContaining("Duplicate Annotation Section"),
      }),
    );
  });

  it("parses an ordered Managed Frontmatter section", () => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(
      documentWithFrontmatter(`
  - key: citekey
    expr: zt.citationKey
  - key: tags
    merge: append
    value: [reference, book]
  - key: creators
    merge: keep
    js: zt.creators.map((creator) => creator.name)`),
    );

    expect(document.manifest.frontmatter).toEqual([
      { key: "citekey", merge: "replace", expr: "zt.citationKey" },
      { key: "tags", merge: "append", value: ["reference", "book"] },
      {
        key: "creators",
        merge: "keep",
        js: "zt.creators.map((creator) => creator.name)",
      },
    ]);
  });

  it("names an invalid Managed Frontmatter section", () => {
    expectInvalidFrontmatter(" {}", "frontmatter");
  });

  it.each([
    ["no value member", ""],
    ["several value members", "    expr: zt.tags\n    js: zt.tags"],
  ])("rejects an entry with %s", (_case, members) => {
    expectInvalidFrontmatter(
      `
  - key: tags
${members}`,
      "tags",
    );
  });

  it("rejects a duplicate Managed Frontmatter key", () => {
    expectInvalidFrontmatter(
      `
  - key: tags
    expr: zt.tags
  - key: tags
    value: []`,
      "tags",
    );
  });

  it.each([
    "zotero-key",
    "zotlit-profile",
    "zotero-note-key",
    "zotero-lastmod",
    "zotlit-csl",
  ])("rejects reserved Managed Frontmatter key %s", (key) => {
    expectInvalidFrontmatter(
      `
  - key: ${key}
    expr: zt.title`,
      key,
    );
  });

  it.each([
    ["empty key", 'key: ""'],
    ["non-string key", "key: 42"],
  ])("rejects an entry with an %s", (_case, keySource) => {
    expectInvalidFrontmatter(
      `
  - ${keySource}
    expr: zt.title`,
      "#1",
    );
  });

  it("rejects an invalid merge strategy against its key", () => {
    expectInvalidFrontmatter(
      `
  - key: tags
    merge: union
    expr: zt.tags`,
      "tags",
    );
  });

  it("rejects a document language outside Liquid and Eta", () => {
    const facade = new TemplateFacade();

    expect(() =>
      facade.parseLiteratureNoteTemplate(`---
id: example.language
name: Invalid language
version: 1.0.0
author: Ada Example
description: Invalid rendering language.
contract: 2
filename: note
language: javascript
---
Body`),
    ).toThrowError(
      expect.objectContaining<Partial<LiteratureNoteTemplateError>>({
        code: "invalid-manifest",
      }),
    );
  });

  it("rejects unknown manifest fields instead of dropping a typo", () => {
    const facade = new TemplateFacade();

    expect(() =>
      facade.parseLiteratureNoteTemplate(`---
id: example.typo
name: Typo note
version: 1.0.0
author: Ada Example
description: Invalid compatibility field.
contract: 2
minAppVerison: 2.3.0
filename: note
---
Body`),
    ).toThrowError(
      expect.objectContaining<Partial<LiteratureNoteTemplateError>>({
        code: "invalid-manifest",
      }),
    );
  });

  it("accepts an explicit null citation-style Profile default", () => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(`---
id: example.null-style
name: Null citation style
version: 1.0.0
author: Ada Example
description: Disables the inherited citation style.
contract: 2
filename: note
citationStyle: null
---
Body\n--- zotlit:annotation ---\nAnnotation`);

    expect(document.manifest.citationStyle).toBeNull();
  });

  it("renders the filename rule in the document language", () => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(`---
id: example.filename
name: Filename note
version: 1.0.0
author: Ada Example
description: Tests the filename rule.
contract: 2
filename: '{% if zt.citationKey == "smith2024" %}smith2024{% endif %}'
---
Body\n--- zotlit:annotation ---\nAnnotation`);

    expect(
      facade.renderLiteratureNoteTemplateFilename(document, {
        citationKey: "smith2024",
      }),
    ).toBe("smith2024");
  });
});

function blockDocument(body: string, id: string): string {
  return `---
id: ${id}
name: Line owning note
version: 1.0.0
author: Ada Example
description: Tests line-owning structural tags.
contract: 2
filename: note
---
${body}`;
}

describe("Annotation Section boundary", () => {
  const facade = new TemplateFacade();

  it.each(["liquid", "eta"] as const)(
    "accepts an empty %s section at EOF or after a line break",
    (language) => {
      for (const ending of ["", "\n", "\r\n"]) {
        const document = facade.parseLiteratureNoteTemplate(
          blockDocument(
            `Static\n--- zotlit:annotation ---${ending}`,
            "empty",
          ).replace("filename: note", `filename: note\nlanguage: ${language}`),
        );
        expect(document.body).toBe("Static\n");
        expect(document.annotationSection.source).toBe("");
        expect(facade.renderLiteratureNoteTemplateForCreate(document, {})).toBe(
          "Static\n",
        );
        expect(
          facade.renderLiteratureNoteTemplateForUpdate(document, {}),
        ).toBeNull();
        expect(
          facade.renderLiteratureNoteTemplateAnnotation(document, {}),
        ).toBe("");
      }
    },
  );

  it.each(["\n", "\r\n"])(
    "preserves blank lines and %j line endings",
    (eol) => {
      const source = blockDocument(
        `Note${eol}${eol}--- zotlit:annotation ---${eol}${eol}  Annotation${eol}${eol}`,
        "bytes",
      );
      const document = facade.parseLiteratureNoteTemplate(source);
      expect(document.body).toBe(`Note${eol}${eol}`);
      expect(document.annotationSection.source).toBe(
        `${eol}  Annotation${eol}${eol}`,
      );
      expect(
        source.slice(
          document.annotationSection.headerStart,
          document.annotationSection.start,
        ),
      ).toBe(`--- zotlit:annotation ---${eol}`);
    },
  );

  it.each([
    " --- zotlit:annotation ---",
    "\t--- zotlit:annotation ---",
    "Text --- zotlit:annotation ---",
  ])("keeps a non-standalone header as source: %s", (line) => {
    const document = facade.parseLiteratureNoteTemplate(
      blockDocument(`${line}\n--- zotlit:annotation ---\nA`, "exact"),
    );
    expect(document.body).toBe(`${line}\n`);
    expect(() =>
      facade.parseLiteratureNoteTemplate(blockDocument(line, "missing")),
    ).toThrowError(
      expect.objectContaining({
        code: "missing-annotation-section",
        manifestId: "missing",
      }),
    );
  });

  it.each([
    "--- zotlit:note ---",
    "--- zotlit:unknown ---",
    "--- zotlit:annotation --- ",
    "--- zotlit:annotation --- suffix",
    "--- zotlit:annotation ---\r",
  ])("reports an unknown namespace header: %s", (header) => {
    expect(() =>
      facade.parseLiteratureNoteTemplate(
        blockDocument(`--- zotlit:annotation ---\n${header}`, "unknown"),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "unknown-section-header",
        manifestId: "unknown",
        recovery: expect.stringContaining("exact standalone"),
      }),
    );
  });

  it.each([
    { language: "liquid", before: "```markdown\n", after: "\n```" },
    { language: "liquid", before: "{% raw %}\n", after: "\n{% endraw %}" },
    {
      language: "liquid",
      before: "{% comment %}\n",
      after: "\n{% endcomment %}",
    },
    { language: "eta", before: "<% const example = `\n", after: "\n`; %>" },
  ])(
    "splits before parsing $language code in $before",
    ({ language, before, after }) => {
      const source = blockDocument(
        `${before}--- zotlit:annotation ---\nA${after}`,
        "syntax",
      ).replace("filename: note", `filename: note\nlanguage: ${language}`);
      const document = facade.parseLiteratureNoteTemplate(source);
      expect(document.body).toBe(before);
      expect(document.annotationSection.source).toBe(`A${after}`);
      expect(() =>
        facade.parseLiteratureNoteTemplate(
          `${source}\n--- zotlit:annotation ---`,
        ),
      ).toThrowError(
        expect.objectContaining({ code: "duplicate-annotation-section" }),
      );
      if (language === "liquid" && before.startsWith("{%")) {
        expect(() =>
          facade.renderLiteratureNoteTemplateForCreate(document, {}),
        ).toThrow();
      }
    },
  );

  it("reports the reserved annotation partial with a rename hint", () => {
    const source = blockDocument(
      "Note\n--- zotlit:annotation ---",
      "reserved",
    ).replace(
      "filename: note",
      "filename: note\npartials:\n  - name: annotation\n    language: liquid\n    source: Global",
    );
    expect(() => facade.parseLiteratureNoteTemplate(source)).toThrowError(
      expect.objectContaining({
        code: "reserved-annotation-partial",
        manifestId: "reserved",
        recovery: expect.stringContaining("Rename"),
      }),
    );
  });
});

describe("Line-Owning Tags", () => {
  it("ends the created body with exactly one line break", () => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(
      blockDocument(
        "Body\n--- zotlit:annotation ---\nA\n\n",
        "example.trailing",
      ),
    );

    expect(facade.renderLiteratureNoteTemplateForCreate(document, {})).toBe(
      "Body\n",
    );
  });

  it("renders a line-owning Managed Block onto its own lines", () => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(
      blockDocument(
        [
          "Head",
          "{% managed %}",
          "{% if true %}",
          "In",
          "{% endif %}",
          "{% endmanaged %}",
          "",
          "--- zotlit:annotation ---",
          "A",
          "",
        ].join("\n"),
        "example.owning-managed",
      ),
    );

    expect(document.managedBlock?.source).toBe(
      "{% if true %}\nIn\n{% endif %}\n",
    );
    expect(facade.renderLiteratureNoteTemplateForCreate(document, {})).toBe(
      `Head\n${formatManagedRegion("In")}\n`,
    );
    expect(facade.renderLiteratureNoteTemplateForUpdate(document, {})).toBe(
      formatManagedRegion("In"),
    );
  });

  it("renders the glued and line-owning layouts to the same bytes", () => {
    const facade = new TemplateFacade();
    const inner = "{% if true %}\nIn\n{% endif %}\n";
    const glued = facade.parseLiteratureNoteTemplate(
      blockDocument(
        `Head\n{% managed %}${inner}{% endmanaged %}\n--- zotlit:annotation ---\n{% bq %}\nA\n{% endbq %}\n`,
        "example.glued",
      ),
    );
    const owning = facade.parseLiteratureNoteTemplate(
      blockDocument(
        `Head\n{% managed %}\n${inner}{% endmanaged %}\n\n--- zotlit:annotation ---\n{% bq %}\nA\n{% endbq %}\n`,
        "example.owning-pair",
      ),
    );

    for (const document of [glued, owning]) {
      expect(facade.renderLiteratureNoteTemplateForCreate(document, {})).toBe(
        `Head\n${formatManagedRegion("In")}\n`,
      );
      expect(facade.renderLiteratureNoteTemplateAnnotation(document, {})).toBe(
        "> A\n",
      );
    }
  });

  it("terminates the Managed Region line when body text follows the block", () => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(
      blockDocument(
        "Head\n{% managed %}\nX\n{% endmanaged %}\nTail\n--- zotlit:annotation ---\nA\n",
        "example.mid-document",
      ),
    );

    expect(facade.renderLiteratureNoteTemplateForCreate(document, {})).toBe(
      `Head\n${formatManagedRegion("X")}\nTail\n`,
    );
  });

  it.each([
    ["a marker at line start", "", "Head\n"],
    ["an indented marker", "  ", "Head\n  "],
  ])(
    "converts a mid-document content insertion with %s",
    (_name, indent, expectedPrefix) => {
      const note = `Head\n${indent}{% render "content" with zt as zt %}\nTail\n`;
      const content = "Managed {{ zt.title }}\n";
      const facade = new TemplateFacade({
        transformRender: (name, output) =>
          name === "content" ? formatManagedRegion(output) : output,
      });
      facade.define("note", note, "liquid");
      facade.define("content", content, "liquid");
      facade.define("filename", "name", "liquid");

      const converted = facade.convertLegacyLiteratureNoteTemplates(
        {
          note: { source: note, language: "liquid" },
          content: { source: content, language: "liquid" },
          filename: { source: "name", language: "liquid" },
        },
        { note: { title: "Paper" }, filename: {} },
      );

      expect(converted.rendered.create).toBe(
        `${expectedPrefix}${formatManagedRegion("Managed Paper")}\nTail\n`,
      );
    },
  );

  it("owns a CRLF line break like a bare line feed", () => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(
      blockDocument(
        "Head\r\n{% managed %}\r\nX\r\n{% endmanaged %}\r\nTail\r\n--- zotlit:annotation ---\r\nA\r\n",
        "example.crlf",
      ),
    );

    expect(document.managedBlock?.source).toBe("X\r\n");
    expect(document.managedBlock?.trailingLineBreak).toBe("\r\n");
    expect(facade.renderLiteratureNoteTemplateForCreate(document, {})).toBe(
      `Head\r\n${formatManagedRegion("X")}\r\nTail\r\n`,
    );
  });
});

describe("where a Profile document is repaired", () => {
  const facade = new TemplateFacade();

  /** The error `source` raises, so each case reads the location it carries. */
  function parseFailure(source: string): LiteratureNoteTemplateError {
    try {
      facade.parseLiteratureNoteTemplate(source);
    } catch (error) {
      return error as LiteratureNoteTemplateError;
    }
    throw new Error("The document parsed.");
  }

  it("points at the manifest line the YAML parser refused", () => {
    const source = blockDocument(
      "Body\n--- zotlit:annotation ---\nA\n",
      "dup",
    ).replace("filename: note", "filename: note\nfilename: other");
    const failure = parseFailure(source);

    expect(failure.code).toBe("invalid-manifest");
    expect(source.slice(failure.offset)).toMatch(/^filename: other/);
  });

  it("names the manifest field a schema issue is about", () => {
    const source = blockDocument(
      "Body\n--- zotlit:annotation ---\nA\n",
      "schema",
    ).replace("filename: note", "filename: 5");
    const failure = parseFailure(source);

    expect(failure.code).toBe("invalid-manifest");
    expect(failure.manifestPath).toEqual(["filename"]);
    // Every schema issue names its node instead, so the offset stays on the
    // first manifest line: the byte after the opening fence.
    expect(failure.offset).toBe(source.indexOf("\n") + 1);
  });

  it("names the reserved partial by its place in the list", () => {
    const source = blockDocument(
      "Body\n--- zotlit:annotation ---\nA\n",
      "reserved",
    ).replace(
      "filename: note",
      [
        "filename: note",
        "partials:",
        "  - name: cite",
        "    language: liquid",
        "    source: c",
        "  - name: annotation",
        "    language: liquid",
        "    source: a",
      ].join("\n"),
    );
    const failure = parseFailure(source);

    expect(failure.code).toBe("reserved-annotation-partial");
    expect(failure.manifestPath).toEqual(["partials", 1, "name"]);
  });

  it.each(["\n", "\r\n"])(
    "points at the unclosed Managed Block across %j line breaks",
    (eol) => {
      const source = blockDocument(
        "Head\n{% managed %}\nBody\n--- zotlit:annotation ---\nA\n",
        "unclosed",
      ).replaceAll("\n", eol);
      const failure = parseFailure(source);

      expect(failure.code).toBe("invalid-managed-block");
      expect(failure.offset).toBe(source.indexOf("{% managed %}"));
    },
  );

  it("points at the second Managed Block, not the first", () => {
    const source = blockDocument(
      [
        "{% managed %}",
        "One",
        "{% endmanaged %}",
        "{% managed %}",
        "Two",
        "{% endmanaged %}",
        "--- zotlit:annotation ---",
        "A",
        "",
      ].join("\n"),
      "duplicate",
    );
    const failure = parseFailure(source);

    expect(failure.code).toBe("duplicate-managed-block");
    expect(failure.offset).toBe(source.lastIndexOf("{% managed %}"));
  });

  it.each(["\n", "\r\n"])(
    "measures the manifest between the fences across %j line breaks",
    (eol) => {
      const source = blockDocument(
        `Body${eol}--- zotlit:annotation ---${eol}A${eol}`,
        "range",
      ).replaceAll("\n", eol);
      const { from, to } = literatureNoteTemplateManifestRange(source);

      expect(source.slice(from, to)).toBe(
        `id: range${eol}name: Line owning note${eol}version: 1.0.0${eol}author: Ada Example${eol}description: Tests line-owning structural tags.${eol}contract: 2${eol}filename: note${eol}`,
      );
      expect(source.slice(0, from)).toBe(`---${eol}`);
      expect(source.slice(to)).toMatch(/^---/);
    },
  );
});
