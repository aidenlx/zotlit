// The Settings Path — the navigation route from Obsidian Settings through the
// ZotLit tab, optionally to a settings page and one setting on it, rendered
// as one bold unit. The `Settings` and `ZotLit` segments are fixed literal
// prose owned by Obsidian and the plugin tab.
import { asMarkdown, md } from "fumadocs-core/server";

import type { LocalizedString } from "@/paraglide/runtime.js";

export type SettingsPathProps =
  | { page?: never; setting?: never }
  | {
      /** ZotLit settings page name rendered from the product Message catalog. */
      page: LocalizedString;
      /** A setting on that page, rendered from the product Message catalog. */
      setting?: LocalizedString;
    };

export function SettingsPath({ page, setting }: SettingsPathProps) {
  const segments = ["Settings", "ZotLit", page, setting].filter(
    (segment) => segment !== undefined,
  );
  const path = segments.join(" > ");

  if (asMarkdown()) {
    return md`**${path}**`;
  }

  return <strong>{path}</strong>;
}
