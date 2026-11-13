// Which edition a requested page serves, and the canonical and alternate URLs that follow.

import type { SiteLocale } from "./i18n";
import { localizedPath } from "./i18n";
import { htmlPagePath } from "./markdown-routes";

export interface PageLocaleState {
  contentLocale: SiteLocale;
  isFallback: boolean;
  canonicalPath: string;
  alternates: {
    locale: SiteLocale | "x-default";
    path: string;
  }[];
}

// The Workbench draws its whole UI from the locale catalogs. The landing,
// community and listing pages show English copy until their catalog strings
// are translated, so their `/zh-CN` URLs are English fallbacks.
const catalogPages = new Set(["/workbench"]);
const chinesePages = new Set(__DOCS_CHINESE_PAGES__);

/** Normalize the two published locales while keeping unsupported input English. */
function isChinese(locale: string): boolean {
  return locale.replaceAll("_", "-").toLowerCase() === "zh-cn";
}

/** Headers can address a Markdown edition; metadata always addresses its HTML page. */
function htmlPath(path: string): string {
  const [pathname = "/"] = path.split(/[?#]/);
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "en" || isChinese(segments[0] ?? "")) segments.shift();

  return htmlPagePath(`/${segments.filter(Boolean).join("/")}`);
}

/**
 * Native-file-based locale metadata and reciprocal alternate links for a
 * requested locale. Missing Chinese files use the English edition at the requested URL.
 */
export function getPageLocaleState(
  path: string,
  locale: string,
  {
    nativeChinesePages = chinesePages,
  }: { nativeChinesePages?: ReadonlySet<string> } = {},
): PageLocaleState {
  const englishPath = htmlPath(path);
  const hasChinese =
    catalogPages.has(englishPath) || nativeChinesePages.has(englishPath);
  const chinese = isChinese(locale);
  const chinesePath = localizedPath(englishPath, "zh-CN");
  const alternates: PageLocaleState["alternates"] = [
    { locale: "en", path: englishPath },
  ];
  if (hasChinese) alternates.push({ locale: "zh-CN", path: chinesePath });
  alternates.push({ locale: "x-default", path: englishPath });

  return {
    contentLocale: chinese && hasChinese ? "zh-CN" : "en",
    isFallback: chinese && !hasChinese,
    canonicalPath: chinese && hasChinese ? chinesePath : englishPath,
    alternates,
  };
}
