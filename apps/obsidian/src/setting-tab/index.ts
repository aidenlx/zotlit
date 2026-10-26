import { PluginSettingTab } from "obsidian";
import type { Plugin, SettingDefinitionItem } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import { advancedPageItems } from "./advanced";
import { attachmentPageItems } from "./attachments";
import { citationsPageItems } from "./citations";
import type { SettingsControlKey, SettingTabContext } from "./context";
import { controlValue, writeControlValue } from "./controls";
import { noteImportPageItems } from "./note-import";
import { literatureNoteItems, profilesPage } from "./profiles";
import { readerPageItems } from "./reader";
import { resourcesGroup } from "./resources";
import { zoteroPageItems } from "./zotero";

/**
 * ZotLit's declarative tab. It holds no state of its own: every callback
 * Obsidian makes runs an Effect through `ctx.tab`, and the tab layer
 * (`layer.ts`) owns its subscriptions and lifetime.
 */
export class ZotLitSettingTab extends PluginSettingTab {
  readonly #ctx: SettingTabContext;

  constructor(
    plugin: Plugin,
    context: Omit<SettingTabContext, "app" | "manifest">,
  ) {
    super(plugin.app, plugin);
    this.#ctx = { ...context, app: plugin.app, manifest: plugin.manifest };
  }

  override getControlValue(key: string): unknown {
    return this.#ctx.tab.sync(controlValue(key));
  }

  /**
   * Obsidian awaits this, then refreshes `visible`/`disabled` from the stored
   * value; it reports no failure itself, so `run` does.
   */
  override setControlValue(key: string, value: unknown): Promise<void> {
    return this.#ctx.tab.run(
      writeControlValue(key, value),
      m.settings_failed_save(),
    );
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return settingDefinitions(this.#ctx);
  }
}

function settingDefinitions(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsControlKey>[] {
  const items: SettingDefinitionItem<SettingsControlKey>[] = [
    // Migration reminder (while pending) and the resources strip, one
    // headerless group — see resourcesGroup for why the reminder is
    // included structurally rather than via `visible`.
    resourcesGroup(ctx),

    // The main page is the default Profile: its Literature Note rows inline,
    // no top-level heading (per Obsidian style) — see ADR 0036. Both note
    // folders it binds read as one set, so the imported note folder sits
    // here; the import rendering rows have their own page below.
    ...literatureNoteItems(ctx),
    // Everything else lives on navigable sub-pages, grouped apart from the
    // rows above so the page rows read as their own section. Profiles leads
    // because it extends the default Profile's rows right above it.
    {
      type: "group",
      id: "settings_pages",
      items: [
        profilesPage(ctx),
        {
          type: "page",
          id: "settings_page_note_import",
          name: m.settings_page_note_import(),
          desc: m.settings_page_note_import_desc(),
          items: noteImportPageItems(ctx),
        },
        {
          type: "page",
          id: "settings_page_citations",
          name: m.settings_page_citations(),
          desc: m.settings_page_citations_desc(),
          items: citationsPageItems(ctx),
        },
        {
          type: "page",
          id: "settings_page_zotero",
          name: m.settings_page_zotero(),
          desc: m.settings_page_zotero_desc(),
          items: zoteroPageItems(ctx),
        },
        {
          type: "page",
          id: "settings_page_attachments",
          name: m.settings_page_attachments(),
          desc: m.settings_page_attachments_desc(),
          items: attachmentPageItems(ctx),
        },
        {
          type: "page",
          id: "settings_page_reader",
          name: m.settings_page_reader(),
          desc: m.settings_page_reader_desc(),
          items: readerPageItems(),
        },
        {
          type: "page",
          id: "settings_page_advanced",
          name: m.settings_page_advanced(),
          desc: m.settings_page_advanced_desc(),
          items: advancedPageItems(ctx),
        },
      ],
    },
  ];

  return items;
}
