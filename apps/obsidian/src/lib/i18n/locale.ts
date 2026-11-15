// The plugin locale for the language Obsidian runs in.

import { resolveLocale } from "@zotlit/obsidian-i18n";

import { catalog } from "@/lib/i18n/generated/catalog";

/** Obsidian language codes that name a catalog locale under another code. */
const ALIASES = { zh: "zh-CN" } as const;

/**
 * The catalog locale for an Obsidian language code (`getLanguage()`): the
 * Language Pack the plugin offers, and the edition of the docs site it links.
 */
export function resolvePluginLocale(language: string) {
  return resolveLocale(language, catalog, ALIASES);
}
