import { PluginSettingTab } from "obsidian";

import { type DatabaseService } from "@/services/database/service";
import { type SettingsService } from "@/services/settings/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";
import type ZotLitPlugin from "@/zt-main";

import { databaseSection } from "./groups/database";
import { loggingSection } from "./groups/logging";

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
  #stack: DisposableStack | undefined;

  constructor({ plugin, settings, db, zoteroPref }: ZotLitSettingTabOptions) {
    super(plugin.app, plugin);
    this.#plugin = plugin;
    this.#settings = settings;
    this.#db = db;
    this.#zoteroPref = zoteroPref;
  }

  override display(): void {
    this.#stack?.dispose();
    this.#stack = undefined;
    this.containerEl.empty();

    const stack = new DisposableStack();
    const base = {
      containerEl: this.containerEl,
      settings: this.#settings,
    };

    stack.use(
      databaseSection({ ...base, db: this.#db, zoteroPref: this.#zoteroPref }),
    );
    stack.use(loggingSection({ ...base, plugin: this.#plugin }));

    this.#stack = stack.move();
  }

  override hide(): void {
    this.#stack?.dispose();
    this.#stack = undefined;
  }
}
