// Live database and TemplateService boundaries for native preview tests.
import type { DatabaseSync } from "node:sqlite";
import type { App } from "obsidian";
import { vi } from "vitest";
import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { exportItemSnapshot } from "@zotlit/workbench/snapshot";
import type { RenderedCitation } from "@/services/pandoc/engine";
import { SettingsService } from "@/services/settings/service";
import { TemplateService } from "@/services/template/service";
import { MockVault, PluginStub } from "@/services/template/test-vault";
import type { NativeRenderDeps } from "@/views/note-preview/render";

export const PROFILE_SOURCE = `---
id: paper
name: Paper
version: 1.0.0
contract: 5
filename: '{{ zt.title }}'
citationStyle: numeric
frontmatter:
  - key: title
    merge: replace
    expr: zt.title
  - key: tags
    merge: append
    value: [review]
---
# {{ zt.title }}

{% managed %}Managed {{ zt.title }}.
{% for annotation in zt.annotations %}{% render 'annotation' with annotation as zt %}{% endfor %}{% endmanaged %}

Personal space.
--- zotlit:annotation ---
> [!quote]
> {{ zt.text }}
`;
export const SAVED_NOTE = `---
title: Old title
private: Keep this
number: 7
tags: [mine]
---
Personal introduction.

%%zt-managed%%
Old generated body.
%%/zt-managed%%

Personal conclusion.
`;

export async function createRenderFixture(options: { existing?: string; javascript?: boolean; wikilinks?: boolean; defaultStyle?: string } = {}) {
  const client = createClient(":memory:");
  const sqlite = client.$client as DatabaseSync;
  createFixtureSchema(sqlite);
  sqlite.exec(`
    insert into libraries (libraryID, type, editable, filesEditable) values (1, 'user', 1, 1);
    insert into itemTypes (itemTypeID, typeName) values (1, 'journalArticle'), (2, 'attachment'), (3, 'annotation');
    insert into fieldsCombined (fieldID, fieldName, custom) values (1, 'title', 0), (2, 'citationKey', 0);
    insert into itemDataValues (valueID, value) values (1, 'Better figures'), (2, 'figures2014');
    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key) values
      (1, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'MAIN2345'),
      (2, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ATCH2345'),
      (3, 3, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ANNA2345');
    insert into itemData (itemID, fieldID, valueID) values (1, 1, 1), (1, 2, 2);
    insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path) values (2, 1, 0, 'application/pdf', 'storage:paper.pdf');
    insert into itemAnnotations (itemID, parentItemID, type, authorName, text, comment, color, pageLabel, sortIndex, position, isExternal)
      values (3, 2, 1, null, 'Use readable figures.', null, '#ffd400', '2', '00000|000001|00000', '{"pageIndex":1,"rects":[]}', 0);
  `);
  const vault = new MockVault();
  const file = options.existing === undefined ? null : vault.addFile("notes/paper.md", options.existing);
  const memory = new Map<string, unknown>(options.javascript ? [["zotlit-javascript-templates", "1"]] : []);
  const app = {
    vault: Object.assign(vault, { read: vault.cachedRead }),
    fileManager: { getAvailablePathForAttachment: async () => "notes/preview.png", generateMarkdownLink: (target: { path: string }) => `[[${target.path}]]` },
    workspace: { updateOptions: vi.fn() },
    metadataCache: {
      getFirstLinkpathDest: (path: string) => path === "notes/paper.md" ? file : null,
      getFileCache: () => ({ frontmatter: { "zotero-key": "MAIN2345" } }),
    },
    loadLocalStorage: (key: string) => memory.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => memory.set(key, value),
  } as unknown as App;
  const plugin = new PluginStub(app, { __VERSION__: 1, "note.template-conversion-pending": true, "citation.wikilink-citations": options.wikilinks ?? false });
  const identity = (raw: unknown) => raw;
  const settings = new SettingsService({ plugin, migrateLegacy: identity, migrateV1: identity, migrateV2: identity, migrateV3: identity, migrateV4: identity, migrateV5: identity, migrateV6: identity, migrateV7: identity, migrateV8: identity, migrateV9: identity });
  await settings.ready;
  if (options.defaultStyle) settings.updateDefaultLiteratureNoteProfileBindings({ "citation.references-style": options.defaultStyle });
  const templates = new TemplateService({ app, settings });
  await templates.ready;
  const renderCitations = vi.fn<NativeRenderDeps["bibliographyRender"]["renderCitations"]>(async (sources, _items, presentation) => {
    const content = presentation?.styleId === "numeric" ? "[1]" : "(Rougier 2014)";
    const value: RenderedCitation[] = sources.map(() => ({ content: [{ t: "Str", c: content }], citations: [{ id: "MAIN2345", mode: "normal" }] }));
    return { kind: "held", key: "fixture", record: { value, status: "fresh", settled: Promise.resolve(value) } };
  });
  const deps: NativeRenderDeps = {
    app, settings, templates,
    profile: { resolveProfile: () => undefined },
    db: { on: () => () => {}, acquireRead: async () => ({ client, [Symbol.dispose]() {} }) as never },
    noteIndex: { getNotesByItemKey: (key) => file && key === "MAIN2345" ? [file] : [], getImportedNoteByNoteKey: () => [], whenIndexed: async () => {} },
    zoteroPref: { ready: Promise.resolve(), dataDir: "/Zotero", baseAttachmentPath: null },
    citationIndex: {
      whenResolved: async () => {}, citekeyOf: () => "figures2014",
      resolveCitekey: (key) => key === "figures2014" ? { kind: "unique", item: { itemID: 1, libraryID: 1, key: "MAIN2345", indexedKey: "MAIN2345" } } : { kind: "missing" },
    },
    bibliographyRender: { on: () => () => {}, renderCitations, render: async () => ({ kind: "unavailable", reason: "failed" }), vaultPresentation: { styleId: null, locale: null } },
  };
  const writes = { create: vi.spyOn(vault, "create"), process: vi.spyOn(vault, "process"), modify: vi.spyOn(vault, "modifyFile") };
  const snapshot = exportItemSnapshot(client, { key: "MAIN2345", library: { type: "personal" } }, { provenance: { kind: "connected", installationId: "fixture", vault: "preview" } });
  return { deps, snapshot, vault, renderCitations, writes, async [Symbol.asyncDispose]() { await templates[Symbol.asyncDispose](); await settings[Symbol.asyncDispose](); sqlite.close(); } };
}
