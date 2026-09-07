import { PluginSettingTab } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";

import type { LanguagePackLifecycle } from "@/lib/i18n";
import * as m from "@/lib/i18n/generated/messages";
import type { DatabaseService } from "@/services/database/service";
import type { LibraryScopeService } from "@/services/library-scope/service";
import type { ProfileService } from "@/services/profile/service";
import type {
  SettingsPatch,
  SettingsService,
} from "@/services/settings/service";
import type { TemplateService } from "@/services/template/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type ZotLitPlugin from "@/zt-main";

import {
  advancedPageItems,
  decodeLogLevel,
  encodeLogLevel,
  LOG_LEVEL_KEY,
} from "./advanced";
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
import {
  getProfileControlValue,
  isProfileControlKey,
  literatureNoteItems,
  profilesPage,
  setProfileControlValue,
} from "./profiles";
import { resourcesGroup } from "./resources";
import { AUTO_TRIM_KEYS, decodeAutoTrim, encodeAutoTrim } from "./templates";
import { zoteroPageItems } from "./zotero";

export interface ZotLitSettingTabOptions {
  importProfile: SettingTabContext["importProfile"];
  plugin: ZotLitPlugin;
  settings: SettingsService;
  profile: ProfileService;
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
  readonly #importProfile: SettingTabContext["importProfile"];
  readonly #plugin: ZotLitPlugin;
  readonly #settings: SettingsService;
  readonly #db: DatabaseService;
  readonly #libraryScope: LibraryScopeService;
  readonly #zoteroPref: ZoteroPrefService;
  readonly #attachmentImport: AttachmentImportActions;
  readonly #citationIndex: CitationIndexActions;
  readonly #profile: ProfileService;
  readonly #template: TemplateService;
  readonly #release: ReleaseTabActions;
  readonly #pandocEngine: PandocEngineActions;
  readonly #languagePack: LanguagePackLifecycle;

  constructor({
    importProfile,
    plugin,
    settings,
    db,
    libraryScope,
    zoteroPref,
    attachmentImport,
    citationIndex,
    template,
    profile,
    release,
    pandocEngine,
    languagePack,
  }: ZotLitSettingTabOptions) {
    super(plugin.app, plugin);
    this.#plugin = plugin;
    this.#importProfile = importProfile;
    this.#settings = settings;
    this.#db = db;
    this.#libraryScope = libraryScope;
    this.#zoteroPref = zoteroPref;
    this.#attachmentImport = attachmentImport;
    this.#citationIndex = citationIndex;
    this.#template = template;
    this.#profile = profile;
    plugin.register(profile.on("changed", () => this.#requestUpdate()));
    this.#release = release;
    this.#pandocEngine = pandocEngine;
    this.#languagePack = languagePack;

    plugin.register(
      template.on("compile-status-changed", () => this.#requestUpdate()),
    );
    // Obsidian calls `update()` from `addSettingTab()`, so the first pass runs
    // while `onload` is still wiring and TemplateService is still loading. The
    // rows that need it structurally are left out of that pass, so re-render
    // once the service reports ready. `compile-status-changed` can't stand in:
    // its load-time emit lands before the service flips to loaded.
    let unloaded = false;
    plugin.register(() => {
      unloaded = true;
    });
    void profile.ready.then(
      () => {
        if (!unloaded) this.#requestUpdate();
      },
      () => {},
    );
    plugin.register(languagePack.subscribe(() => this.#requestUpdate()));
    plugin.register(pandocEngine.subscribe(() => this.#requestUpdate()));
    // Library scope rows are built from the resolved scope, so a database
    // refresh, a group rename, and a repair each rebuild them.
    plugin.register(libraryScope.on("changed", () => this.#requestUpdate()));

    // Settings: the two pending flags are structural — the reminder rows are
    // included or left out, not toggled via `visible` — so the tab re-renders
    // when either flips. Scalar `control` edits (read on the framework's own
    // render cycle) never trigger a rebuild and never steal focus from inline
    // inputs.
    let lastPending = settings.current?.["release.migration-pending"];
    let lastTemplateConversionPending =
      settings.current?.["note.template-conversion-pending"];
    plugin.register(
      settings.subscribe((value) => {
        const pending = value?.["release.migration-pending"];
        const templateConversionPending =
          value?.["note.template-conversion-pending"];
        if (
          pending === lastPending &&
          templateConversionPending === lastTemplateConversionPending
        ) {
          return;
        }
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
      importProfile: this.#importProfile,
      manifest: this.#plugin.manifest,
      settings: this.#settings,
      profile: this.#profile,
      db: this.#db,
      libraryScope: this.#libraryScope,
      zoteroPref: this.#zoteroPref,
      attachmentImport: this.#attachmentImport,
      citationIndex: this.#citationIndex,
      template: this.#template,
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

      // The main page is the default Profile: its Literature Note rows inline,
      // no top-level heading (per Obsidian style), then the Imported notes
      // group — see ADR 0036.
      ...literatureNoteItems(ctx),
      // Everything else lives on navigable sub-pages, grouped apart from the
      // rows above so the page rows read as their own section. Profiles leads
      // because it extends the default Profile's rows right above it.
      {
        type: "group",
        items: [
          profilesPage(ctx),
          {
            type: "page",
            name: m.settings_page_citations(),
            desc: m.settings_page_citations_desc(),
            items: citationsPageItems(ctx),
          },
          {
            type: "page",
            name: m.settings_page_zotero(),
            desc: m.settings_page_zotero_desc(),
            items: zoteroPageItems(ctx),
          },
          {
            type: "page",
            name: m.settings_page_attachments(),
            desc: m.settings_page_attachments_desc(),
            items: attachmentPageItems(ctx),
          },
          {
            type: "page",
            name: m.settings_page_advanced(),
            desc: m.settings_page_advanced_desc(),
            items: advancedPageItems(ctx),
          },
        ],
      },
    ];

    return items;
  }
}
