import { describe, expect, it } from "vitest";

import { TemplateFacade } from "./facade";
import {
  createLiteratureNotePackInstallRecord,
  diffLiteratureNotePack,
  exportLiteratureNotePack,
  parseLiteratureNotePack,
  planLiteratureNotePackRevert,
} from "./literature-note-pack";
import type {
  LiteratureNotePackFile,
  LiteratureNotePackInstallRecord,
} from "./literature-note-pack";
import { parseLiteratureNoteTemplate } from "./literature-note-template";

const DOCUMENT = `---
id: example.books
name: Books
version: 1.0.0
author: Example
description: Book notes
contract: 2
filename: "{{ zt.citationKey }}"
---
# {{ zt.title }}

{% managed %}{% render "summary" with zt as zt %}{% endmanaged %}
`;

describe("Literature Note Pack export", () => {
  it("keeps a partial-free document as one unchanged file", () => {
    const source = `${DOCUMENT.replace(
      '{% render "summary" with zt as zt %}',
      "{{ zt.abstractNote }}",
    )}\n--- zotlit:annotation ---\n{{ zt.text }}`;

    expect(exportLiteratureNotePack(source, [])).toBe(source);
  });

  it("preserves an Annotation Section through export and install", () => {
    const source = `${DOCUMENT.replace(
      '{% render "summary" with zt as zt %}',
      "{{ zt.abstractNote }}",
    )}--- zotlit:annotation ---\n{{ zt.text }}`;
    const exported = exportLiteratureNotePack(source, []);
    const candidate = parseLiteratureNotePack("books.md", exported);
    const diff = diffLiteratureNotePack(candidate.files, [
      { key: "document:books.md", source: null, builtIn: false },
    ]);
    const record = createLiteratureNotePackInstallRecord(
      candidate.pack,
      candidate.files,
      diff,
    );

    expect(exported).toBe(source);
    expect(candidate.files).toEqual([{ key: "document:books.md", source }]);
    expect(record.files[0]?.installedSource).toBe(source);
  });

  it("bundles transitive partials into the document manifest", () => {
    const document = `${DOCUMENT}\n--- zotlit:annotation ---\n{{ zt.text }}`;
    const source = exportLiteratureNotePack(document, [
      {
        name: "summary",
        language: "liquid",
        source: 'Summary: {% render "authors" with zt as zt %}',
      },
      {
        name: "authors",
        language: "liquid",
        source: "Authors: {{ zt.creators }}",
      },
      {
        name: "unused",
        language: "liquid",
        source: "Unused",
      },
    ]);

    expect(parseLiteratureNoteTemplate(source).manifest.partials).toEqual([
      {
        name: "authors",
        language: "liquid",
        source: "Authors: {{ zt.creators }}",
      },
      {
        name: "summary",
        language: "liquid",
        source: 'Summary: {% render "authors" with zt as zt %}',
      },
    ]);
  });

  it.each([
    { language: "liquid", source: "{% render_annotation zt.annotations[0] %}" },
    {
      language: "liquid",
      source: "{% liquid\n render_annotation zt.annotations[0]\n%}",
    },
    { language: "eta", source: "<%~ renderAnnotation (zt.annotations[0]) %>" },
  ] as const)(
    "uses the Profile section for the $language shortcut's dependency",
    (partial) => {
      const annotation = {
        name: "annotation",
        language: "liquid",
        source: 'A {% render "label" with zt as zt %}',
      } as const;
      const label = {
        name: "label",
        language: "liquid",
        source: "{{ zt.text }}",
      } as const;
      const summary = { name: "summary", ...partial };
      const exported = exportLiteratureNotePack(
        `${DOCUMENT}\n--- zotlit:annotation ---\nProfile section`,
        [summary, annotation, label],
      );

      expect(parseLiteratureNoteTemplate(exported).manifest.partials).toEqual([
        summary,
      ]);
    },
  );

  it("exports annotation shortcuts without a global annotation partial", () => {
    const source = `${DOCUMENT.replace(
      '{% render "summary" with zt as zt %}',
      "{% render_annotation zt.annotations[0] %}",
    )}\n--- zotlit:annotation ---\nProfile section`;

    expect(exportLiteratureNotePack(source, [])).toBe(source);
  });

  it.each(["liquid", "eta"] as const)(
    "reloads exported %s sources with all reachable partials",
    (language) => {
      const call = (name: string) =>
        language === "liquid"
          ? `{% render "${name}" with zt as zt %}`
          : `<%~ include("${name}", zt) %>`;
      const shortcut =
        language === "liquid"
          ? "{% render_annotation zt.annotation %}"
          : "<%~ renderAnnotation(zt.annotation) %>";
      const source = `---
id: shared
name: Shared
version: 1.0.0
contract: 2
language: ${language}
filename: '${call("filename-label")}'
---
${call("summary")}
--- zotlit:annotation ---
\r\nProfile ${call("annotation-label")}\r\n`;
      const partials = [
        { name: "summary", source: shortcut },
        { name: "filename-label", source: "Filename" },
        { name: "annotation-label", source: `Label ${call("text")}` },
        {
          name: "text",
          source: language === "liquid" ? "{{ zt.text }}" : "<%= zt.text %>",
        },
        { name: "annotation", source: call("unrelated-global") },
      ].map((partial) => ({ ...partial, language }));
      const exported = exportLiteratureNotePack(source, partials);
      const facade = new TemplateFacade();
      const document = facade.parseLiteratureNoteTemplate(exported);
      for (const partial of document.manifest.partials ?? []) {
        facade.define(partial.name, partial.source, partial.language);
      }
      expect(document.manifest.partials?.map(({ name }) => name)).toEqual([
        "annotation-label",
        "filename-label",
        "summary",
        "text",
      ]);
      expect(document.annotationSection.source).toBe(
        `\r\nProfile ${call("annotation-label")}\r\n`,
      );
      expect(exported.slice(document.bodyStart)).toBe(
        source.slice(facade.parseLiteratureNoteTemplate(source).bodyStart),
      );
      const expected =
        language === "liquid"
          ? "\r\nProfile Label A\r\n"
          : "\nProfile Label A\n";
      expect(
        facade.renderLiteratureNoteTemplateForCreate(document, {
          annotation: { text: "A" },
        }),
      ).toBe(expected);
      expect(
        facade.renderLiteratureNoteTemplateAnnotation(document, { text: "A" }),
      ).toBe(expected);
      expect(facade.renderLiteratureNoteTemplateFilename(document, {})).toBe(
        "Filename",
      );
    },
  );

  it.each([false, true])(
    "exports a partial-free Profile with includeFolders=%s",
    (includeFolders) => {
      const body = `# {{ zt.title }}\n{% managed %}{{ zt.abstractNote }}{% endmanaged %}\n--- zotlit:annotation ---\n{{ zt.text }}`;
      const source = `---
id: example.books
name: Books
version: 1.0.0
contract: 2
filename: "{{ zt.citationKey }}"
folder: Research/Books
importFolder: Research/Imported notes
citationStyle: apa
---
${body}`;

      const exported = parseLiteratureNoteTemplate(
        exportLiteratureNotePack(source, [], { includeFolders }),
      );

      expect(exported.manifest.folder).toBe(
        includeFolders ? "Research/Books" : undefined,
      );
      expect(exported.manifest.importFolder).toBe(
        includeFolders ? "Research/Imported notes" : undefined,
      );
      expect(exported.manifest.citationStyle).toBe("apa");
      expect(exported.body).toBe(
        "# {{ zt.title }}\n{% managed %}{{ zt.abstractNote }}{% endmanaged %}\n",
      );
      expect(exported.annotationSection.source).toBe("{{ zt.text }}");
    },
  );

  it("keeps document partials ahead of global partials when sharing again", () => {
    const source =
      `${DOCUMENT}\n--- zotlit:annotation ---\n{{ zt.text }}`.replace(
        "contract: 2\n",
        `contract: 2
folder: Research
importFolder: Imports
partials:
  - name: summary
    language: liquid
    source: 'Shared summary: {% render "authors" %}'
  - name: authors
    language: liquid
    source: Shared authors
`,
      );
    const exported = parseLiteratureNoteTemplate(
      exportLiteratureNotePack(source, [
        { name: "summary", language: "liquid", source: "Local summary" },
        { name: "authors", language: "liquid", source: "Local authors" },
        { name: "unused", language: "liquid", source: "Unused" },
      ]),
    );

    expect(exported.manifest).not.toHaveProperty("folder");
    expect(exported.manifest).not.toHaveProperty("importFolder");
    expect(exported.manifest.partials).toEqual([
      { name: "authors", language: "liquid", source: "Shared authors" },
      {
        name: "summary",
        language: "liquid",
        source: 'Shared summary: {% render "authors" %}',
      },
    ]);
  });
});

describe("Literature Note Pack install lifecycle", () => {
  const candidate: LiteratureNotePackFile[] = [
    { key: "document:books.md", source: "pack document" },
    { key: "partial:summary:liquid", source: "pack summary" },
  ];

  it("refuses user files by default and accepts an explicit per-file override", () => {
    const current = [
      { key: "document:books.md", source: null, builtIn: false },
      {
        key: "partial:summary:liquid",
        source: "user summary",
        builtIn: false,
      },
    ];

    expect(diffLiteratureNotePack(candidate, current)).toMatchObject([
      { key: "document:books.md", previous: "absent", verdict: "apply" },
      {
        key: "partial:summary:liquid",
        previous: "user-file",
        verdict: "refuse",
      },
    ]);
    expect(
      diffLiteratureNotePack(candidate, current, {
        overwrite: ["partial:summary:liquid"],
      }),
    ).toMatchObject([
      { verdict: "apply" },
      { previous: "user-file", verdict: "apply" },
    ]);
  });

  it("recognizes an unchanged prior edition of the same Pack as an upgrade", () => {
    const prior: LiteratureNotePackInstallRecord = {
      pack: { id: "example.books", version: "0.9.0" },
      files: [
        {
          key: "document:books.md",
          installedSource: "old pack document",
          previous: { kind: "absent" },
        },
      ],
    };

    expect(
      diffLiteratureNotePack(
        [candidate[0]!],
        [
          {
            key: "document:books.md",
            source: "old pack document",
            builtIn: false,
          },
        ],
        { prior },
      ),
    ).toMatchObject([{ previous: "prior-pack", verdict: "apply" }]);
  });

  it("compares a candidate with the effective built-in source", () => {
    expect(
      diffLiteratureNotePack(
        [{ key: "partial:note:liquid", source: "built-in note" }],
        [
          {
            key: "partial:note:liquid",
            source: "built-in note",
            builtIn: true,
          },
        ],
      ),
    ).toMatchObject([{ previous: "built-in", verdict: "unchanged" }]);
  });

  it("records exact replacements and plans a full round-trip revert", () => {
    const current = [
      { key: "document:books.md", source: null, builtIn: false },
      {
        key: "partial:summary:liquid",
        source: "user summary",
        builtIn: false,
      },
    ];
    const diff = diffLiteratureNotePack(candidate, current, {
      overwrite: ["partial:summary:liquid"],
    });
    const record = createLiteratureNotePackInstallRecord(
      { id: "example.books", version: "1.0.0" },
      candidate,
      diff,
    );

    expect(record.files).toEqual([
      {
        key: "document:books.md",
        installedSource: "pack document",
        previous: { kind: "absent" },
      },
      {
        key: "partial:summary:liquid",
        installedSource: "pack summary",
        previous: { kind: "user-file", source: "user summary" },
      },
    ]);
    expect(planLiteratureNotePackRevert(record, candidate)).toEqual([
      { key: "document:books.md", action: "trash" },
      {
        key: "partial:summary:liquid",
        action: "restore",
        source: "user summary",
      },
    ]);
  });
});
