// The Settings Path — the navigation route from Obsidian Settings through the
// ZotLit tab to a settings page, optionally one setting on it, rendered as
// one bold unit. The `Settings` and `ZotLit` segments are fixed literal prose
// owned by Obsidian and the plugin tab.
import { asMarkdown, md } from "fumadocs-core/server";

import type { LocalizedString } from "@/paraglide/runtime.js";

export interface SettingsPathProps {
  /** ZotLit settings page name rendered from the product Message catalog. */
  page: LocalizedString;
  /** A setting on that page, rendered from the product Message catalog. */
  setting?: LocalizedString;
}

export function SettingsPath({ page, setting }: SettingsPathProps) {
  const path =
    setting === undefined
      ? `Settings > ZotLit > ${page}`
      : `Settings > ZotLit > ${page} > ${setting}`;

  if (asMarkdown()) {
    return md`**${path}**`;
  }

  return <strong>{path}</strong>;
}
