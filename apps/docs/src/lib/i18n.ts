// The site's locales and the `/zh-CN` prefix that marks Chinese URLs.

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

/**
 * Pages drawn wholly from the locale catalogs, whose Chinese strings are in
 * place: the landing, community and policy pages, the course listing, the changelog
 * listing over its Chinese entries, the blog listing over its Chinese posts,
 * and the Workbench. Each has a native `/zh-CN` edition.
 */
export const chineseCatalogPages = [
  "/",
  "/community",
  "/privacy",
  "/terms",
  "/learn",
  "/changelog",
  "/blog",
  "/workbench",
] as const;

/** The URL prefix of every Chinese page; English URLs carry none. */
export const chinesePrefix = "/zh-CN";

export function validateSiteLocale(locale: unknown): SiteLocale {
  if (typeof locale !== "string" || !isSiteLocale(locale)) {
    throw new Error("Unsupported locale");
  }
  return locale;
}

/** A server-function validator for input that carries the requested locale. */
export function localeInput<T extends object>() {
  return (input: T & { locale: SiteLocale }) => {
    validateSiteLocale(input.locale);
    return input;
  };
}

export function localizedPath(path: string, locale: SiteLocale): string {
  if (locale === "en") return path;
  return `${chinesePrefix}${path === "/" ? "" : path}`;
}

export function unlocalizedPath(path: string): string {
  return path.replace(/^\/zh-CN(?=\/|$)/, "") || "/";
}
