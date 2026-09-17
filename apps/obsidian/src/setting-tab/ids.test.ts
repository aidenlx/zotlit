// @vitest-environment happy-dom
import type {
  SettingDefinitionItem,
  SettingDefinitionGroup,
  SettingDefinitionList,
  SettingDefinitionPage,
} from "obsidian";
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import { advancedPageItems } from "./advanced";
import { attachmentPageItems } from "./attachments";
import { citationsPageItems } from "./citations";
import type { SettingTabContext } from "./context";
import { noteImportPageItems } from "./note-import";
import { literatureNoteItems, profilesPage } from "./profiles";
import { readerPageItems } from "./reader";
import { resourcesGroup } from "./resources";
import { zoteroPageItems } from "./zotero";

vi.mock("@/views/template-workbench/register", () => ({
  openNativeProfile: vi.fn(async () => {}),
  openTemplateWorkbench: vi.fn(async () => {}),
}));

function ctx(): SettingTabContext {
  return {
    webWorkbenchEnabled: true,
    app: {
      vault: { getFileByPath: () => null, adapter: {} },
      internalPlugins: { getEnabledPluginById: () => null },
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
    },
    manifest: { version: "0.0.0", dir: "plugins/zotlit" },
    settings: { current: {}, update: () => {}, subscribe: () => () => {} },
    profile: {
      loaded: true,
      profiles: [],
      diagnostics: [],
      defaultDocumentPath: "templates/zotlit-profile.default.md",
    },
    db: {},
    libraryScope: {
      effective: { mode: "all" },
      current: null,
      invalid: false,
    },
    zoteroPref: { databasePath: "", dataDir: null },
    localServer: { effectivePort: null },
    localBridge: { connection: null, disconnect: () => {}, on: () => () => {} },
    customize: async () => {},
    attachmentImport: {
      approvedFolders: [],
      approveFolder: async () => {},
      revokeFolder: async () => {},
    },
    citationIndex: { reset: async () => {} },
    template: {
      loaded: true,
      javascriptTemplatesEnabled: false,
      getPartialDocuments: () => [],
      getReservedPartialFiles: () => [],
      getUnrecognizedFiles: () => [],
      compileStatus: undefined,
    },
    release: {},
    pandocEngine: {
      getStatus: () => ({ kind: "absent" }),
      subscribe: () => () => {},
    },
    languagePack: {
      getSituation: () => ({ kind: "unavailable" }),
      endonym: "English",
    },
    requestUpdate: () => {},
  } as unknown as SettingTabContext;
}

/** Walk the definition tree, asserting ids unique among each sibling array. */
function check(label: string, items: readonly SettingDefinitionItem[]): void {
  const seen = new Map<string, number>();
  items.forEach((item, index) => {
    const id = (item as { id?: string }).id;
    expect(id, `${label}: item ${index} missing id`).toBeTruthy();
    const prior = seen.get(id!);
    expect(
      prior,
      `${label}: duplicate id "${id}" at ${prior} and ${index}`,
    ).toBeUndefined();
    seen.set(id!, index);
    visited += 1;
  });

  for (const item of items) {
    if (!("type" in item)) continue;
    const group = item as
      | SettingDefinitionGroup
      | SettingDefinitionList
      | SettingDefinitionPage;
    if (group.items) {
      check(`${label} > ${group.type}:${item.id}`, group.items);
    }
  }
}

let visited = 0;

it("every setting definition carries an id unique among its siblings", () => {
  const c = ctx();
  check("root", [
    resourcesGroup(c),
    ...literatureNoteItems(c),
    {
      type: "group",
      id: "settings_pages",
      items: [
        profilesPage(c),
        {
          type: "page",
          id: "settings_page_note_import",
          name: m.settings_page_note_import(),
          items: noteImportPageItems(c),
        },
        {
          type: "page",
          id: "settings_page_citations",
          name: m.settings_page_citations(),
          items: citationsPageItems(c),
        },
        {
          type: "page",
          id: "settings_page_zotero",
          name: m.settings_page_zotero(),
          items: zoteroPageItems(c),
        },
        {
          type: "page",
          id: "settings_page_attachments",
          name: m.settings_page_attachments(),
          items: attachmentPageItems(c),
        },
        {
          type: "page",
          id: "settings_page_reader",
          name: m.settings_page_reader(),
          items: readerPageItems(),
        },
        {
          type: "page",
          id: "settings_page_advanced",
          name: m.settings_page_advanced(),
          items: advancedPageItems(c),
        },
      ],
    },
  ]);
  // Guard against a vacuous pass: the walk must reach the real tree.
  expect(visited).toBeGreaterThan(100);
});
