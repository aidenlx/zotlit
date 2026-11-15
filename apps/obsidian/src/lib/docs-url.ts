// Docs-site links in the reader's language. Kept apart from `constants.ts`,
// which the worker bundles import: this module reads Obsidian's language.

import { getLanguage } from "obsidian";

import { DOCS_SITE_URL } from "@/lib/constants";
import { resolvePluginLocale } from "@/lib/i18n/locale";

/**
 * A page of the documentation site in the reader's language: the Chinese
 * edition under `/zh-CN` while Obsidian runs in Simplified Chinese, the
 * English page otherwise. It follows Obsidian's language, not the installed
 * Language Pack, so a reader who has not installed the pack still lands on
 * the Chinese docs. `path` starts with `/`, or is empty for the home page.
 */
export function docsUrl(path: string): string {
  const chinese = resolvePluginLocale(getLanguage()) === "zh-CN";
  return `${DOCS_SITE_URL}${chinese ? "/zh-CN" : ""}${path}`;
}

/** The ZotLit Companion install guide, in the reader's language. */
export const companionDocsUrl = (): string =>
  docsUrl("/docs/install-companion");
