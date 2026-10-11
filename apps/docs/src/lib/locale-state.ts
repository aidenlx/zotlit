export interface PageLocaleState {
  contentLocale: "en" | "zh-CN";
  isFallback: boolean;
  canonicalPath: string;
  alternates: {
    locale: "en" | "zh-CN" | "x-default";
    path: string;
  }[];
}

// Static and listing pages use the locale catalogs rather than an MDX body.
const catalogPages = new Set([
  "/",
  "/community",
  "/workbench",
  "/blog",
  "/changelog",
]);
const chinesePages = new Set(
  typeof __DOCS_CHINESE_PAGES__ === "undefined" ? [] : __DOCS_CHINESE_PAGES__,
);

/** Normalize the two published locales while keeping unsupported input English. */
function isChinese(locale: string): boolean {
  return locale.replaceAll("_", "-").toLowerCase() === "zh-cn";
}

/** Headers can address a Markdown edition; metadata always addresses its HTML page. */
function htmlPath(path: string): string {
  const [pathname = "/"] = path.split(/[?#]/);
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "en" || isChinese(segments[0] ?? "")) segments.shift();

  if (segments[0] === "llms.mdx" && segments.at(-1) === "content.md") {
    segments.shift();
    segments.pop();
  } else if (
    ["docs", "blog", "changelog"].includes(
      segments.length === 1
        ? segments[0]!.replace(/\.md$/, "")
        : (segments[0] ?? ""),
    ) &&
    segments.at(-1)?.endsWith(".md")
  ) {
    segments[segments.length - 1] = segments.at(-1)!.slice(0, -3);
  }

  return `/${segments.filter(Boolean).join("/")}`;
}

/**
 * Native-file-based locale metadata and reciprocal alternate links for a
 * requested locale. Missing Chinese files use the English edition at the requested URL.
 */
export function getPageLocaleState(
  path: string,
  locale: string,
  nativeChinesePages: ReadonlySet<string> = chinesePages,
): PageLocaleState {
  const englishPath = htmlPath(path);
  const hasChinese =
    catalogPages.has(englishPath) || nativeChinesePages.has(englishPath);
  const chinese = isChinese(locale);
  const chinesePath = `/zh-CN${englishPath === "/" ? "" : englishPath}`;
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
