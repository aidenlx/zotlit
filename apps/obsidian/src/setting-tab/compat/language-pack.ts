// Imperative Language Pack status and installation setting for Obsidian before 1.13.

import { Setting } from "obsidian";

import { languagePackSettingCopy } from "@/lib/i18n/settings-copy";

import { type CompatContext } from "./context";

export function languagePackSetting(
  containerEl: HTMLElement,
  ctx: CompatContext,
): void {
  const copy = languagePackSettingCopy(ctx.languagePack);
  if (copy === undefined) return;

  const setting = new Setting(containerEl)
    .setName(copy.name)
    .setDesc(copy.desc);
  const { install } = copy;
  if (install === undefined) return;

  setting.addButton((button) =>
    button
      .setButtonText(install.label)
      .setCta()
      .setDisabled(install.disabled)
      .onClick(() => install.run()),
  );
}
