// Declarative Language Pack status and installation setting for Obsidian 1.13+.

import { type SettingDefinition } from "obsidian";

import { type LanguagePackSettingCopy } from "@/lib/i18n/settings-copy";

import { type SettingsKey } from "./context";

export function languagePackDefinition(
  copy: LanguagePackSettingCopy,
): SettingDefinition<SettingsKey> {
  const { name, desc, install } = copy;
  if (install === undefined) return { name, desc };

  return {
    name,
    desc,
    render: (setting) => {
      setting.addButton((button) =>
        button
          .setButtonText(install.label)
          .setCta()
          .setDisabled(install.disabled)
          .onClick(() => install.run()),
      );
    },
  };
}
