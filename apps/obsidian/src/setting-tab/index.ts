import { PluginSettingTab } from "obsidian";

import type { SettingsService } from "@/services/settings/service";
import type ZotLitPlugin from "@/zt-main";
import { loggingSection } from "./groups/logging";

export interface ZotLitSettingTabOptions {
  plugin: ZotLitPlugin;
  settings: SettingsService;
}

export class ZotLitSettingTab extends PluginSettingTab {
  readonly #plugin: ZotLitPlugin;
  readonly #settings: SettingsService;
  #stack: DisposableStack | undefined;

  constructor({ plugin, settings }: ZotLitSettingTabOptions) {
    super(plugin.app, plugin);
    this.#plugin = plugin;
    this.#settings = settings;
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

    stack.use(loggingSection({ ...base, plugin: this.#plugin }));

    this.#stack = stack.move();
  }

  override hide(): void {
    this.#stack?.dispose();
    this.#stack = undefined;
  }
}
