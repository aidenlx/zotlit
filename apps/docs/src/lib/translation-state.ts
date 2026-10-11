/** Author approval for an actual Chinese source file, never language detection. */
export type TranslationStatus = "placeholder" | "translated";

/** The build-time scan's small, browser-safe result, keyed by HTML paths. */
export interface TranslationManifest {
  pages: Record<string, TranslationStatus>;
  ui: TranslationStatus;
}

// The scanner also imports this type from Node's config graph, which does not
// load the app's ambient declarations. Both graphs use the same Vite constant.
declare const __DOCS_TRANSLATION_MANIFEST__: TranslationManifest;

export interface PageLocaleState {
  contentLocale: "en" | "zh-CN";
  isPlaceholder: boolean;
  canonicalPath: string;
  alternates: {
    locale: "en" | "zh-CN" | "x-default";
    path: string;
  }[];
}

const emptyManifest: TranslationManifest = { pages: {}, ui: "placeholder" };

function buildManifest(): TranslationManifest {
  return typeof __DOCS_TRANSLATION_MANIFEST__ === "undefined"
    ? emptyManifest
    : __DOCS_TRANSLATION_MANIFEST__;
}

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
 * Truthful content language, canonical and reciprocal alternate links for a
 * requested locale. Missing Chinese files and marked copies both remain English.
 */
export function getPageLocaleState(
  path: string,
  locale: string,
  manifest: TranslationManifest = buildManifest(),
): PageLocaleState {
  const englishPath = htmlPath(path);
  const status = ["/", "/community", "/workbench"].includes(englishPath)
    ? manifest.ui
    : manifest.pages[englishPath];
  const ready = status === "translated";
  const chinese = isChinese(locale);
  const chinesePath = `/zh-CN${englishPath === "/" ? "" : englishPath}`;
  const alternates: PageLocaleState["alternates"] = [
    { locale: "en", path: englishPath },
  ];
  if (ready) alternates.push({ locale: "zh-CN", path: chinesePath });
  alternates.push({ locale: "x-default", path: englishPath });

  return {
    contentLocale: chinese && ready ? "zh-CN" : "en",
    isPlaceholder: chinese && !ready,
    canonicalPath: chinese && ready ? chinesePath : englishPath,
    alternates,
  };
}
