// @vitest-environment happy-dom
import { Context, Effect, Stream } from "effect";
import type {
  App,
  SettingDefinitionItem,
  SettingDefinitionGroup,
  SettingDefinitionList,
  SettingDefinitionPage,
  SettingTab,
  SettingsModal,
} from "obsidian";
import { expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { revealSetting } from "@/lib/open-settings";
import { AttachmentImport } from "@/services/attachment-import/service";
import { ChineseSegmenter } from "@/services/chinese-segmenter/service";
import { LanguagePack } from "@/services/language-pack/service";
import { LibraryScope } from "@/services/library-scope/service";
import { LocalBridge } from "@/services/local-bridge/service";
import { LocalServer } from "@/services/local-server/service";
import { PandocEngine } from "@/services/pandoc/service";
import { defaults } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";

import { profileRowServices, testSettingTab } from "./__fixtures__";
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
  return stubService<SettingTabContext>("SettingTabContext", {
    tab: testSettingTab(
      profileRowServices().pipe(
        Context.add(
          LibraryScope,
          LibraryScope.of({
            state: Effect.die("unread"),
            changes: Stream.empty,
            current: Effect.succeed(null),
            effective: Effect.succeed({ mode: "all" }),
            invalid: Effect.succeed(false),
            libraries: Effect.succeed([]),
            libraryRows: Effect.succeed(null),
            resolveLibraries: () => Effect.die("unread"),
          }),
        ),
        Context.add(
          PandocEngine,
          stubService<PandocEngine["Service"]>("PandocEngine", {
            getStatus: Effect.succeed({ kind: "absent" }),
            changes: Stream.empty,
          }),
        ),
        Context.add(
          LanguagePack,
          stubService<LanguagePack["Service"]>("LanguagePack", {
            situation: Effect.succeed({ kind: "unavailable" }),
            endonym: "English",
          }),
        ),
        Context.add(
          PluginSettings,
          stubService<PluginSettings["Service"]>("PluginSettings", {
            current: Effect.succeed(defaults),
            changes: Stream.empty,
          }),
        ),
        Context.add(
          LocalServer,
          stubService<LocalServer["Service"]>("LocalServer", {
            effectivePort: Effect.succeed(null),
            effectivePortChanges: Stream.empty,
          }),
        ),
        Context.add(
          LocalBridge,
          stubService<LocalBridge["Service"]>("LocalBridge", {
            connection: Effect.succeed(null),
          }),
        ),
        Context.add(
          AttachmentImport,
          stubService<AttachmentImport["Service"]>("AttachmentImport", {
            approvedFolders: Effect.succeed([]),
          }),
        ),
        Context.add(
          ChineseSegmenter,
          stubService<ChineseSegmenter["Service"]>("ChineseSegmenter", {
            getStatus: Effect.succeed({ kind: "absent" }),
            changes: Stream.empty,
          }),
        ),
      ),
    ).tab,
    webWorkbenchEnabled: true,
    app: stubService<SettingTabContext["app"]>("App", {
      vault: stubService<SettingTabContext["app"]["vault"]>("Vault", {
        getFileByPath: () => null,
        adapter: stubService<SettingTabContext["app"]["vault"]["adapter"]>(
          "DataAdapter",
          {},
        ),
      }),
      internalPlugins: stubService<SettingTabContext["app"]["internalPlugins"]>(
        "InternalPlugins",
        { getEnabledPluginById: () => null },
      ),
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
    }),
    manifest: stubService<SettingTabContext["manifest"]>("PluginManifest", {
      version: "0.0.0",
      dir: "plugins/zotlit",
    }),
    settings: stubService<SettingTabContext["settings"]>("Settings", {
      current: Effect.succeed(defaults),
      changes: Stream.empty,
    }),
    customize: async () => {},
  });
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
    const tab = stubService<SettingTab>("SettingTab", {
      id: TAB_ID,
      settingItems: realTree(ctx()),
    });
    const setting = {
      open: vi.fn(),
      openTabById: vi.fn(() => tab),
      navigateToSearchResult: vi.fn(),
      scrollToDefinition: vi.fn(),
    };

    const app = stubService<App>("App", {
      setting: stubService<SettingsModal>("SettingsModal", setting),
    });
    revealSetting(app, TAB_ID, settingId);

    expect(setting.scrollToDefinition).toHaveBeenCalledOnce();
    expect(setting.scrollToDefinition.mock.calls[0]![1]).toMatchObject({
      id: settingId,
    });
  },
);
