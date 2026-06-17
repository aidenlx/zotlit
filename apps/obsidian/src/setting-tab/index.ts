import {
  PluginSettingTab,
  type SettingDefinitionItem,
  type TAbstractFile,
} from "obsidian";

import * as m from "@/paraglide/messages";
import { type DatabaseService } from "@/services/database/service";
import {
  type SettingsPatch,
  type SettingsService,
} from "@/services/settings/service";
import { isEtaTemplatePath } from "@/services/template/path";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";
import type ZotLitPlugin from "@/zt-main";

import { type SettingsKey, type SettingTabContext } from "./context";
import { databasePageItems, libraryDefinition } from "./database";
import { liveUpdatesPageItems } from "./live-updates";
import {
  decodeLogLevel,
  encodeLogLevel,
  LOG_LEVEL_KEY,
  loggingPageItems,
} from "./logging";
import {
  AUTO_TRIM_KEYS,
  decodeAutoTrim,
  encodeAutoTrim,
  templatesPageItems,
} from "./templates";

export interface ZotLitSettingTabOptions {
  plugin: ZotLitPlugin;
  settings: SettingsService;
  db: DatabaseService;
  zoteroPref: ZoteroPrefService;
}

export class ZotLitSettingTab extends PluginSettingTab {
  readonly #plugin: ZotLitPlugin;
  readonly #settings: SettingsService;
  readonly #db: DatabaseService;
  readonly #zoteroPref: ZoteroPrefService;

  constructor({ plugin, settings, db, zoteroPref }: ZotLitSettingTabOptions) {
    super(plugin.app, plugin);
    this.#plugin = plugin;
    this.#settings = settings;
    this.#db = db;
    this.#zoteroPref = zoteroPref;

    // Vault: ejectable-template rows and the template-folder file list track
    // template files created/removed/renamed.
    const onVaultChange = (file: TAbstractFile): void => {
      if (isEtaTemplatePath(file.path)) this.update();
    };
    plugin.registerEvent(plugin.app.vault.on("create", onVaultChange));
    plugin.registerEvent(plugin.app.vault.on("delete", onVaultChange));
    plugin.registerEvent(plugin.app.vault.on("rename", onVaultChange));

    // Settings: the frontmatter list is structural — its edits add/remove rows,
    // so the tab must re-render. Reference identity changes only when that key
    // is mutated, so scalar `control` edits (read on the framework's own render
    // cycle) never trigger a rebuild and never steal focus from inline inputs.
    let lastFields = settings.current?.["note.frontmatter-fields"];
    plugin.register(
      settings.subscribe((value) => {
        const fields = value?.["note.frontmatter-fields"];
        if (fields === lastFields) return;
        lastFields = fields;
        this.update();
      }),
    );
  }

  /** Bridge declarative `control` reads to {@link SettingsService}. */
  override getControlValue(key: string): unknown {
    const value = this.#settings.current?.[key as SettingsKey];
    // Auto-trim stores `false | "nl" | "slurp"`; its dropdown reads a string.
    if (AUTO_TRIM_KEYS.has(key as SettingsKey)) return encodeAutoTrim(value);
    // Log level stores `LogLevel | null`; its dropdown reads a string.
    if (key === LOG_LEVEL_KEY) return encodeLogLevel(value);
    return value;
  }

  /** Bridge declarative `control` writes to {@link SettingsService}. */
  override setControlValue(key: string, value: unknown): void {
    const next = AUTO_TRIM_KEYS.has(key as SettingsKey)
      ? decodeAutoTrim(value)
      : key === LOG_LEVEL_KEY
        ? decodeLogLevel(value)
        : value;
    // `key` is constrained to schema keys by every `control` definition below,
    // and `value` matches that key's control type, so the patch always validates.
    this.#settings.update({ [key]: next } as SettingsPatch);
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    const ctx: SettingTabContext = {
      app: this.#plugin.app,
      plugin: this.#plugin,
      settings: this.#settings,
      db: this.#db,
      zoteroPref: this.#zoteroPref,
      requestUpdate: () => this.update(),
    };

    const items: SettingDefinitionItem<SettingsKey>[] = [
      // Hub — the most-used settings, no top-level heading (per Obsidian style).
      libraryDefinition(ctx),
      {
        name: m.settings_note_folder_name(),
        desc: m.settings_note_folder_desc(),
        control: {
          type: "folder",
          key: "note.literature-folder",
          placeholder: "LiteratureNotes",
        },
      },
      {
        name: m.settings_citation_suggester_name(),
        desc: m.settings_citation_suggester_desc(),
        control: { type: "toggle", key: "citation.editor-suggester" },
      },
      {
        name: m.settings_citation_show_citekey_name(),
        desc: m.settings_citation_show_citekey_desc(),
        control: { type: "toggle", key: "citation.show-citekey-in-suggester" },
      },

      // Self-contained domains live on navigable sub-pages.
      {
        type: "page",
        name: m.settings_page_database(),
        desc: m.settings_page_database_desc(),
        items: databasePageItems(ctx),
      },
      {
        type: "page",
        name: m.settings_page_templates(),
        desc: m.settings_page_templates_desc(),
        items: templatesPageItems(ctx),
      },
      {
        type: "page",
        name: m.settings_page_attachments(),
        desc: m.settings_page_attachments_desc(),
        items: attachmentPageItems(ctx),
      },
      {
        type: "page",
        name: m.settings_page_live_updates(),
        desc: m.settings_page_live_updates_desc(),
        items: liveUpdatesPageItems(ctx),
      },
      {
        type: "page",
        name: m.settings_page_logging(),
        desc: m.settings_page_logging_desc(),
        items: loggingPageItems(ctx),
      },
    ];

    return items;
  }
}

function attachmentPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  return [
    {
      name: m.settings_attachment_import_name(),
      desc: m.settings_attachment_import_desc(),
      control: { type: "toggle", key: "attachment.import" },
    },
    {
      name: m.settings_attachment_folder_name(),
      desc: m.settings_attachment_folder_desc(),
      visible: () => ctx.settings.current?.["attachment.import"] ?? true,
      // Empty value falls back to Obsidian's default attachment folder.
      control: {
        type: "folder",
        key: "attachment.folder-path",
        defaultValue: "",
      },
    },
  ];
}
