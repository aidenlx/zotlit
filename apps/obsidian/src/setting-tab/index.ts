import { PluginSettingTab } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";

import type { LanguagePackLifecycle } from "@/lib/i18n";
import * as m from "@/lib/i18n/generated/messages";
import type { DatabaseService } from "@/services/database/service";
import type { LibraryScopeService } from "@/services/library-scope/service";
import type {
  SettingsPatch,
  SettingsService,
} from "@/services/settings/service";
import type { TemplateService } from "@/services/template/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type ZotLitPlugin from "@/zt-main";

import { attachmentPageItems } from "./attachments";
import { citationsPageItems } from "./citations";
import type {
  AttachmentImportActions,
  CitationIndexActions,
  PandocEngineActions,
  ReleaseTabActions,
  SettingsControlKey,
  SettingsKey,
  SettingTabContext,
} from "./context";
import { databasePageItems } from "./database";
import { libraryPage } from "./library-scope";
import { liveUpdatesPageItems } from "./live-updates";
import {
  decodeLogLevel,
  encodeLogLevel,
  LOG_LEVEL_KEY,
  maintenancePageItems,
} from "./maintenance";
import { noteImportPageItems } from "./note-import";
import { defaultPlaceholder } from "./placeholder";
import {
  getProfileControlValue,
  isProfileControlKey,
  literatureNoteProfileItems,
  setProfileControlValue,
} from "./profiles";
import { resourcesGroup } from "./resources";
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
  libraryScope: LibraryScopeService;
  zoteroPref: ZoteroPrefService;
  attachmentImport: AttachmentImportActions;
  citationIndex: CitationIndexActions;
  template: TemplateService;
  release: ReleaseTabActions;
  pandocEngine: PandocEngineActions;
  languagePack: LanguagePackLifecycle;
}

export class ZotLitSettingTab extends PluginSettingTab {
  readonly #plugin: ZotLitPlugin;
  readonly #settings: SettingsService;
  readonly #db: DatabaseService;
  readonly #libraryScope: LibraryScopeService;
  readonly #zoteroPref: ZoteroPrefService;
  readonly #attachmentImport: AttachmentImportActions;
  readonly #citationIndex: CitationIndexActions;
  readonly #release: ReleaseTabActions;
  readonly #pandocEngine: PandocEngineActions;
  readonly #languagePack: LanguagePackLifecycle;

  constructor({
    plugin,
    settings,
    db,
    libraryScope,
    zoteroPref,
    attachmentImport,
    citationIndex,
    template,
    release,
    pandocEngine,
    languagePack,
  }: ZotLitSettingTabOptions) {
    super(plugin.app, plugin);
    this.#plugin = plugin;
    this.#settings = settings;
    this.#db = db;
    this.#libraryScope = libraryScope;
    this.#zoteroPref = zoteroPref;
    this.#attachmentImport = attachmentImport;
    this.#citationIndex = citationIndex;
    this.#release = release;
    this.#pandocEngine = pandocEngine;
    this.#languagePack = languagePack;

    plugin.register(
      template.on("compile-status-changed", () => this.#requestUpdate()),
    );
    plugin.register(languagePack.subscribe(() => this.#requestUpdate()));
    plugin.register(pandocEngine.subscribe(() => this.#requestUpdate()));
    // Library scope rows are built from the resolved scope, so a database
    // refresh, a group rename, and a repair each rebuild them.
    plugin.register(libraryScope.on("changed", () => this.#requestUpdate()));

    // Settings: the frontmatter list is structural — its edits add/remove rows,
    // so the tab must re-render. Reference identity changes only when that key
    // is mutated, so scalar `control` edits (read on the framework's own render
    // cycle) never trigger a rebuild and never steal focus from inline inputs.
    // The migration-pending flag is tracked the same way, so the resources
    // reminder appears/disappears reactively on both render paths.
    let lastFields = settings.current?.["note.frontmatter-fields"];
    let lastProfiles = settings.current?.["note.profiles"];
    let lastPending = settings.current?.["release.migration-pending"];
    let lastTemplateConversionPending =
      settings.current?.["note.template-conversion-pending"];
    plugin.register(
      settings.subscribe((value) => {
        const fields = value?.["note.frontmatter-fields"];
        const profiles = value?.["note.profiles"];
        const pending = value?.["release.migration-pending"];
        const templateConversionPending =
          value?.["note.template-conversion-pending"];
        if (
          fields === lastFields &&
          profiles === lastProfiles &&
          pending === lastPending &&
          templateConversionPending === lastTemplateConversionPending
        ) {
          return;
        }
        lastFields = fields;
        lastProfiles = profiles;
        lastPending = pending;
        lastTemplateConversionPending = templateConversionPending;
        this.#requestUpdate();
      }),
    );
  }

  /** Re-runs `getSettingDefinitions()` and re-renders the declarative tab. */
  #requestUpdate(): void {
    this.update();
  }

  /** Bridge declarative `control` reads to {@link SettingsService}. */
  override getControlValue(key: string): unknown {
    if (isProfileControlKey(key)) {
      return getProfileControlValue(this.#settings, key);
    }
    const value = this.#settings.current?.[key as SettingsKey];
    // Auto-trim stores `false | "nl" | "slurp"`; its dropdown reads a string.
    if (AUTO_TRIM_KEYS.has(key as SettingsKey)) return encodeAutoTrim(value);
    // Log level stores `LogLevel | null`; its dropdown reads a string.
    if (key === LOG_LEVEL_KEY) return encodeLogLevel(value);
    return value;
  }

  /** Bridge declarative `control` writes to {@link SettingsService}. */
  override setControlValue(key: string, value: unknown): void {
    if (isProfileControlKey(key)) {
      setProfileControlValue(this.#settings, key, value);
      return;
    }
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
      libraryScope: this.#libraryScope,
      zoteroPref: this.#zoteroPref,
      attachmentImport: this.#attachmentImport,
      citationIndex: this.#citationIndex,
      release: this.#release,
      pandocEngine: this.#pandocEngine,
      languagePack: this.#languagePack,
      requestUpdate: () => this.update(),
    };

    const items: SettingDefinitionItem<SettingsControlKey>[] = [
      // Migration reminder (while pending) and the resources strip, one
      // headerless group — see resourcesGroup for why the reminder is
      // included structurally rather than via `visible`.
      resourcesGroup(ctx),

      // Hub — the most-used settings, no top-level heading (per Obsidian style).
      {
        name: m.settings_note_folder_name(),
        desc: m.settings_note_folder_desc(),
        control: {
          type: "folder",
          key: "note.literature-folder",
          placeholder: defaultPlaceholder("note.literature-folder"),
        },
      },
      ...literatureNoteProfileItems(ctx),
      // Self-contained domains live on navigable sub-pages, grouped apart
      // from the hub items above so the page rows read as their own section.
      {
        type: "group",
        items: [
          {
            type: "page",
            name: m.settings_page_citations(),
            desc: m.settings_page_citations_desc(),
            items: citationsPageItems(ctx),
          },
          {
            type: "page",
            name: m.settings_page_database(),
            desc: m.settings_page_database_desc(),
            items: databasePageItems(ctx),
          },
          libraryPage(ctx),
          {
            type: "page",
            name: m.settings_page_templates(),
            desc: m.settings_page_templates_desc(),
            items: templatesPageItems(ctx),
          },
          {
            type: "page",
            name: m.settings_page_note_import(),
            desc: m.settings_page_note_import_desc(),
            items: noteImportPageItems(ctx),
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
            name: m.settings_page_maintenance(),
            desc: m.settings_page_maintenance_desc(),
            items: maintenancePageItems(ctx),
          },
        ],
      },
    ];

    return items;
  }
}
