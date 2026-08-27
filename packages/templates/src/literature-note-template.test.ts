import { describe, expect, it } from "vitest";

import { TemplateFacade } from "./facade";
import type { LiteratureNoteTemplateError } from "./facade";
import { formatManagedRegion } from "./obsidian";

describe("Literature Note Template document", () => {
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

  it("rejects the reserved frontmatter manifest field", () => {
    const facade = new TemplateFacade();

    expect(() =>
      facade.parseLiteratureNoteTemplate(`---
id: example.frontmatter
name: Frontmatter note
version: 1.0.0
author: Ada Example
description: Unsupported frontmatter.
contract: 2
filename: note
frontmatter: []
---
Body`),
    ).toThrowError(
      expect.objectContaining<Partial<LiteratureNoteTemplateError>>({
        code: "frontmatter-not-supported",
        recovery: expect.any(String),
      }),
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
