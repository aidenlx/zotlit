import { getLanguage } from "obsidian";
import { defineCustomClientStrategy, toLocale } from "@/paraglide/runtime";

/**
 * Wires Paraglide's `custom-obsidian` strategy to Obsidian's `getLanguage()`.
 * Must run before any `m.*` call so messages resolve under the user's locale.
 *
 * Obsidian owns its own locale; we never push changes back to it, so
 * `setLocale` is a no-op. Falls back to `baseLocale` (in
 * `project.inlang/settings.json`) when Obsidian's language is unset or not in
 * the configured `locales` list — `toLocale()` performs that normalization.
 */
export function initI18n(): void {
  defineCustomClientStrategy("custom-obsidian", {
    getLocale: () => toLocale(getLanguage()),
    setLocale: () => {},
  });
}
