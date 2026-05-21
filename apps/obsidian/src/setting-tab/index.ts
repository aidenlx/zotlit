import { PluginSettingTab } from "obsidian";

import { type DatabaseService } from "@/services/database/service";
import { type SettingsService } from "@/services/settings/service";
import type ZotLitPlugin from "@/zt-main";

import { databaseSection } from "./groups/database";
import { loggingSection } from "./groups/logging";

export interface ZotLitSettingTabOptions {
  plugin: ZotLitPlugin;
  settings: SettingsService;
  db: DatabaseService;
}

export class ZotLitSettingTab extends PluginSettingTab {
  readonly #plugin: ZotLitPlugin;
  readonly #settings: SettingsService;
  readonly #db: DatabaseService;
  #stack: DisposableStack | undefined;

  constructor({ plugin, settings, db }: ZotLitSettingTabOptions) {
    super(plugin.app, plugin);
    this.#plugin = plugin;
    this.#settings = settings;
    this.#db = db;
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

    stack.use(databaseSection({ ...base, db: this.#db }));
    stack.use(loggingSection({ ...base, plugin: this.#plugin }));

    this.#stack = stack.move();
  }

  override hide(): void {
    this.#stack?.dispose();
    this.#stack = undefined;
  }
}
