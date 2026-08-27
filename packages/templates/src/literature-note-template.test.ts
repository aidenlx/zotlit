import { describe, expect, it } from "vitest";

import type { FrontmatterField } from "./constants";
import { convertLegacyFrontmatterFields, TemplateFacade } from "./facade";
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
Body`;
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
        `{% managed %}${content}{% endmanaged %}`,
      );
      expect(converted.rendered).toEqual({
        create: facade.render("note", { title: "Paper" }),
        update: facade.render("content", { title: "Paper" }),
        filename: facade.render("filename", { citationKey: "doePaper" }),
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
profileDefaults:
  folder: Literature
  citationStyle: apa
language: liquid
---
# {{ zt.title }}

{% managed %}Managed body{% endmanaged %}
`);

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
      profileDefaults: {
        folder: "Literature",
        citationStyle: "apa",
      },
      language: "liquid",
    });
    expect(document.body).toBe(
      "# {{ zt.title }}\n\n{% managed %}Managed body{% endmanaged %}\n",
    );
    expect(document.managedBlock?.source).toBe("Managed body");
  });

  it.each(["liquid", "eta"] as const)(
    "parses and renders an isolated %s Annotation Block",
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
description: Tests Annotation Block rendering.
contract: 2
filename: note
language: ${language}
---
${outside}Before{% annotation %}${annotation}{% endannotation %}After`);

      expect(document.annotationBlock?.source).toBe(annotation);
      expect(
        facade.renderLiteratureNoteTemplateForCreate(document, {
          text: "ROOT",
        }),
      ).toBe("BeforeAfter");
      expect(
        facade.renderLiteratureNoteTemplateAnnotation(document, {
          text: "ROOT",
        }),
      ).toBe("ROOT");
    },
  );

  it("reports an absent Annotation Block", () => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(`---
id: example.no-annotation
name: No annotation
version: 1.0.0
author: Ada Example
description: Has no Annotation Block.
contract: 2
filename: note
---
Body`);

    expect(document.annotationBlock).toBeNull();
    expect(
      facade.renderLiteratureNoteTemplateAnnotation(document, {}),
    ).toBeNull();
  });

  it("strips an Annotation Block nested in the Managed Block", () => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(`---
id: example.nested-annotation
name: Nested annotation
version: 1.0.0
author: Ada Example
description: Keeps Annotation Block bytes out of note renders.
contract: 2
filename: note
---
Before{% managed %}A{% annotation %}ANNOTATION{% endannotation %}B{% endmanaged %}After`);
    const managed = formatManagedRegion("AB");

    expect(facade.renderLiteratureNoteTemplateForCreate(document, {})).toBe(
      `Before${managed}After`,
    );
    expect(facade.renderLiteratureNoteTemplateForUpdate(document, {})).toBe(
      managed,
    );
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
{% assign outside = "leak" %}A{% managed %}{% if outside %}LEAK{% elsif zt.title == "Paper" %}INNER{% endif %}{% endmanaged %}{% if outside == "leak" %}Z{% endif %}`);

    const created = facade.renderLiteratureNoteTemplateForCreate(document, {
      title: "Paper",
    });
    const updated = facade.renderLiteratureNoteTemplateForUpdate(document, {
      title: "Paper",
    });

    const region = formatManagedRegion("INNER");
    expect(created).toBe(`A${region}Z`);
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
<% const outside = "leak" %>A{% managed %}<% if (typeof outside !== "undefined") { %>LEAK<% } else if (zt.title === "Paper") { %>INNER<% } %>{% endmanaged %}<% if (outside === "leak") { %>Z<% } %>`);

    const created = facade.renderLiteratureNoteTemplateForCreate(document, {
      title: "Paper",
    });
    const updated = facade.renderLiteratureNoteTemplateForUpdate(document, {
      title: "Paper",
    });

    const region = formatManagedRegion("INNER");
    expect(created).toBe(`A${region}Z`);
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
{{ zt.prefix }}{% managed %}Managed{% endmanaged %}`);

    expect(
      facade.renderLiteratureNoteTemplateForCreate(document, {
        prefix: "__ZOTLIT_MANAGED_BLOCK_0__",
      }),
    ).toBe(`__ZOTLIT_MANAGED_BLOCK_0__${formatManagedRegion("Managed")}`);
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
{% endmanaged %}After`);

    const region = formatManagedRegion("Managed body");
    expect(facade.renderLiteratureNoteTemplateForCreate(document, {})).toBe(
      `Before${region}After`,
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
${body}`);

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
{% comment %}{% managed %}Comment{% endmanaged %}{% endcomment %}`);

    expect(document.managedBlock).toBeNull();
    expect(facade.renderLiteratureNoteTemplateForCreate(document, {})).toBe(
      "{% managed %}Raw{% endmanaged %}\n",
    );
  });

  it("treats Annotation Block tags inside Liquid raw and comment blocks as literals", () => {
    const facade = new TemplateFacade();
    const document = facade.parseLiteratureNoteTemplate(`---
id: example.annotation-literal
name: Literal annotation tags
version: 1.0.0
author: Ada Example
description: Tests literal Annotation Block tags.
contract: 2
filename: note
---
{% raw %}{% annotation %}Raw{% endannotation %}{% endraw %}
{% comment %}{% annotation %}Comment{% endannotation %}{% endcomment %}`);

    expect(document.annotationBlock).toBeNull();
    expect(facade.renderLiteratureNoteTemplateForCreate(document, {})).toBe(
      "{% annotation %}Raw{% endannotation %}\n",
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
Static body`);

    expect(document.manifest.language).toBe("liquid");
    expect(document.manifest.profileDefaults).toEqual({});
    expect(facade.renderLiteratureNoteTemplateForCreate(document, {})).toBe(
      "Static body",
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
{% managed %}Second{% endmanaged %}`),
    ).toThrowError(
      expect.objectContaining<Partial<LiteratureNoteTemplateError>>({
        code: "duplicate-managed-block",
        message: expect.stringContaining("Duplicate {% managed %} block"),
      }),
    );
  });

  it("rejects a duplicate Annotation Block before rendering", () => {
    const facade = new TemplateFacade();

    expect(() =>
      facade.parseLiteratureNoteTemplate(`---
id: example.duplicate-annotation
name: Duplicate annotation
version: 1.0.0
author: Ada Example
description: Invalid duplicate Annotation Blocks.
contract: 2
filename: note
---
{% annotation %}First{% endannotation %}
{% annotation %}Second{% endannotation %}`),
    ).toThrowError(
      expect.objectContaining<Partial<LiteratureNoteTemplateError>>({
        code: "duplicate-annotation-block",
        message: expect.stringContaining("Duplicate {% annotation %} block"),
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
profileDefaults:
  citationStyle: null
---
Body`);

    expect(document.manifest.profileDefaults.citationStyle).toBeNull();
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
Body`);

    expect(
      facade.renderLiteratureNoteTemplateFilename(document, {
        citationKey: "smith2024",
      }),
    ).toBe("smith2024");
  });
});
