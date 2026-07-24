import { PluginSettingTab, type SettingDefinitionItem } from "obsidian";

import * as m from "@/paraglide/messages";
import { type DatabaseService } from "@/services/database/service";
import {
  type SettingsPatch,
  type SettingsService,
} from "@/services/settings/service";
import { type TemplateService } from "@/services/template/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";
import type ZotLitPlugin from "@/zt-main";

import { type CompatContext, renderCompatSettings } from "./compat";
import {
  type ReleaseTabActions,
  type SettingsKey,
  type SettingTabContext,
} from "./context";
import { databasePageItems, libraryDefinition } from "./database";
import { liveUpdatesPageItems } from "./live-updates";
import {
  decodeLogLevel,
  encodeLogLevel,
  LOG_LEVEL_KEY,
  loggingPageItems,
} from "./logging";
import { noteImportPageItems } from "./note-import";
import { defaultPlaceholder } from "./placeholder";
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
  zoteroPref: ZoteroPrefService;
  template: TemplateService;
  release: ReleaseTabActions;
}

export class ZotLitSettingTab extends PluginSettingTab {
  readonly #plugin: ZotLitPlugin;
  readonly #settings: SettingsService;
  readonly #db: DatabaseService;
  readonly #zoteroPref: ZoteroPrefService;
  readonly #release: ReleaseTabActions;

  /**
   * Backward-compat (Obsidian < 1.13.0) only: teardown for the event
   * subscriptions wired up during the current imperative `display()`. Stays
   * `undefined` on 1.13.0+, where the declarative path runs instead.
   */
  #compatStack: DisposableStack | undefined;

  constructor({
    plugin,
    settings,
    db,
    zoteroPref,
    template,
    release,
  }: ZotLitSettingTabOptions) {
    super(plugin.app, plugin);
    this.#plugin = plugin;
    this.#settings = settings;
    this.#db = db;
    this.#zoteroPref = zoteroPref;
    this.#release = release;

    plugin.register(
      template.on("compile-status-changed", () => this.#requestUpdate()),
    );

    // Settings: the frontmatter list is structural — its edits add/remove rows,
    // so the tab must re-render. Reference identity changes only when that key
    // is mutated, so scalar `control` edits (read on the framework's own render
    // cycle) never trigger a rebuild and never steal focus from inline inputs.
    // The migration-pending flag is tracked the same way, so the resources
    // reminder appears/disappears reactively on both render paths.
    let lastFields = settings.current?.["note.frontmatter-fields"];
    let lastPending = settings.current?.["release.migration-pending"];
    plugin.register(
      settings.subscribe((value) => {
        const fields = value?.["note.frontmatter-fields"];
        const pending = value?.["release.migration-pending"];
        if (fields === lastFields && pending === lastPending) return;
        lastFields = fields;
        lastPending = pending;
        this.#requestUpdate();
      }),
    );
  }

  /**
   * Reactive refresh that works on both rendering paths. On 1.13.0+ the
   * declarative `update()` re-runs `getSettingDefinitions()`; on < 1.13.0
   * (where `update()` doesn't exist) it rebuilds the imperative tab, but only
   * while it is open — `#compatStack` is set exactly when `display()` is live.
   */
  #requestUpdate(): void {
    const maybeUpdate = (this as { update?: () => void }).update;
    if (typeof maybeUpdate === "function") maybeUpdate.call(this);
    else if (this.#compatStack) this.display();
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
      release: this.#release,
      requestUpdate: () => this.update(),
    };

    const items: SettingDefinitionItem<SettingsKey>[] = [
      // Migration reminder (while pending) and the resources strip, one
      // headerless group — see resourcesGroup for why the reminder is
      // included structurally rather than via `visible`.
      resourcesGroup(ctx),

      // Hub — the most-used settings, no top-level heading (per Obsidian style).
      libraryDefinition(ctx),
      {
        name: m.settings_note_folder_name(),
        desc: m.settings_note_folder_desc(),
        control: {
          type: "folder",
          key: "note.literature-folder",
          placeholder: defaultPlaceholder("note.literature-folder"),
        },
      },
      {
        name: m.settings_citation_suggester_name(),
        desc: m.settings_citation_suggester_desc(),
        control: { type: "toggle", key: "citation.editor-suggester" },
      },
      {
        name: m.settings_citation_at_trigger_name(),
        desc: m.settings_citation_at_trigger_desc(),
        visible: () =>
          ctx.settings.current?.["citation.editor-suggester"] ?? true,
        control: { type: "toggle", key: "citation.at-trigger" },
      },
      {
        name: m.settings_citation_show_citekey_name(),
        desc: m.settings_citation_show_citekey_desc(),
        control: { type: "toggle", key: "citation.show-citekey-in-suggester" },
      },
      {
        name: m.settings_update_notices_name(),
        desc: m.settings_update_notices_desc(),
        control: { type: "toggle", key: "release.notices-enabled" },
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
        name: m.settings_page_logging(),
        desc: m.settings_page_logging_desc(),
        items: loggingPageItems(ctx),
      },
    ];

    return items;
  }

  /**
   * Backward-compat render path for Obsidian < 1.13.0, which calls `display()`
   * instead of reading {@link getSettingDefinitions}. On 1.13.0+ the non-empty
   * definitions array wins and this is never invoked. Each call rebuilds from
   * scratch and replaces the previous render's teardown stack.
   */
  override display(): void {
    this.#compatStack?.dispose();
    const stack = new DisposableStack();
    this.#compatStack = stack;

    this.containerEl.empty();

    const ctx: CompatContext = {
      app: this.#plugin.app,
      plugin: this.#plugin,
      settings: this.#settings,
      db: this.#db,
      zoteroPref: this.#zoteroPref,
      release: this.#release,
      rerender: () => this.display(),
      defer: (cleanup) => stack.defer(cleanup),
    };
    renderCompatSettings(this.containerEl, ctx);
  }

  /** Tear down the imperative render's subscriptions (no-op on 1.13.0+). */
  override hide(): void {
    this.#compatStack?.dispose();
    this.#compatStack = undefined;
    super.hide();
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
