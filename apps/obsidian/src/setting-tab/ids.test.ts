// @vitest-environment happy-dom
import type {
  App,
  SettingDefinitionItem,
  SettingDefinitionGroup,
  SettingDefinitionList,
  SettingDefinitionPage,
  SettingTab,
} from "obsidian";
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import { revealSetting } from "@/lib/open-settings";

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

/** The tab's definitions, as `getSettingDefinitions()` hands them out. */
function realTree(c: SettingTabContext): SettingDefinitionItem[] {
  return [
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
  ];
}

let visited = 0;

it("every setting definition carries an id unique among its siblings", () => {
  check("root", realTree(ctx()));
  // Guard against a vacuous pass: the walk must reach the real tree.
  expect(visited).toBeGreaterThan(100);
});

const TAB_ID = "zotlit";

/**
 * Every row a `revealSetting` call names, with the call site that names it.
 * A renamed definition id breaks the link in silence, so the ids meet the real
 * tree here.
 */
const DEEP_LINKED_ROWS = [
  ["settings_zotero_editing", "services/build.ts"],
  ["settings_citation_references_style", "zt-main.ts, views/references"],
  ["settings_library_scope", "zt-main.ts"],
  ["settings_citation_engine", "views/references/register.ts"],
] as const;

it.each(DEEP_LINKED_ROWS)(
  "the deep link to %s reaches a row the tab renders (%s)",
  (settingId) => {
    const tab = {
      id: TAB_ID,
      settingItems: realTree(ctx()),
    } as unknown as SettingTab;
    const setting = {
      open: vi.fn(),
      openTabById: vi.fn(() => tab),
      navigateToSearchResult: vi.fn(),
      scrollToDefinition: vi.fn(),
    };

    revealSetting({ setting } as unknown as App, TAB_ID, settingId);

    expect(setting.scrollToDefinition).toHaveBeenCalledOnce();
    expect(setting.scrollToDefinition.mock.calls[0]![1]).toMatchObject({
      id: settingId,
    });
  },
);
