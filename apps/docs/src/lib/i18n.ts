import { defineI18n } from "fumadocs-core/i18n";

/** V1-compatible URLs; unmarked files are English and remain the fallback. */
export const i18n = defineI18n({
  languages: ["en", "zh-CN"],
  defaultLanguage: "en",
  hideLocale: "default-locale",
  fallbackLanguage: "en",
});

export type SiteLocale = (typeof i18n.languages)[number];

export function isSiteLocale(value: string): value is SiteLocale {
  return i18n.languages.some((locale) => locale === value);
}

export function validateSiteLocale(locale: SiteLocale): SiteLocale {
  if (!isSiteLocale(locale)) throw new Error("Unsupported locale");
  return locale;
}

export function unlocalizedPath(path: string): string {
  return path.replace(/^\/zh-CN(?=\/|$)/, "") || "/";
}
