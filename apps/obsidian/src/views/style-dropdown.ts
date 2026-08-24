// The installed-style picker the dialogs are built with: one dropdown over the
// styles the Zotero data directory holds.

import type { Setting } from "obsidian";

import { listInstalledStyles } from "@/services/pandoc/styles";
import type { InstalledCslStyle } from "@/services/pandoc/styles";
import type { ReferencesStyleOption } from "@/setting-tab/citations";

export interface StyleDropdownOptions {
  /** Zotero data directory the installed styles are listed from. */
  dataDir: string;
  /** The picker value the dialog opens on. */
  value: string;
  /** The entries the picker offers over the styles listed so far. */
  options: (
    styles: readonly InstalledCslStyle[],
    selected: string,
  ) => ReferencesStyleOption[];
  onChange: (value: string) => void;
}

/**
 * The listing lands after the dialog is built, so the picker is filled twice:
 * once with the entries the dialog opens on, and again with the styles Zotero
 * has installed, around whatever the user has selected by then.
 *
 * The listing outlives the dropdown only until the dialog closes, and a
 * detached dropdown simply repopulates a detached element.
 */
export function addStyleDropdown(
  setting: Setting,
  { dataDir, value, options, onChange }: StyleDropdownOptions,
): void {
  setting.addDropdown((dropdown) => {
    let styles: readonly InstalledCslStyle[] = [];
    let selected = value;
    const repopulate = (): void => {
      dropdown.selectEl.replaceChildren();
      // An entry the picker shows without offering — a style Zotero does not
      // have — stays on screen as the selection it stands for, while the
      // picker takes installed styles alone.
      for (const [index, entry] of options(styles, selected).entries()) {
        dropdown.addOption(entry.value, entry.label);
        if (entry.disabled) dropdown.selectEl.options[index]!.disabled = true;
      }
      dropdown.setValue(selected);
    };
    repopulate();
    dropdown.onChange((next) => {
      selected = next;
      onChange(next);
    });
    void listInstalledStyles(dataDir).then((installed) => {
      styles = installed;
      repopulate();
    });
  });
}
