// The prerender page list handed to TanStack Start in `vite.config.ts`.
//
// The routes are listed here deliberately rather than discovered, so the build
// stays explicit about what the asset layer answers without a Worker
// invocation. `src/lib/content-scan.ts` supplies the content side of the list;
// `i18n.test.ts` compares this list with the public loaders; the HTTP verifier
// also checks the emitted native locale assets.
//
// Native HTML and Markdown editions in both locales are on the list.
// A missing Chinese file retains its request-time English fallback notice.
// The pages with GitHub data bake the facts
// their build saw and refresh them client-side. The Worker renders search and
// release-fact endpoints, missing-file locale fallbacks, and the Pre-release
// Docs fallback.
// @see docs/adr/0051-the-docs-site-prerenders-asset-first-and-falls-through-to-an-ssr-worker.md

import { scanContent } from "./content-scan.js";
import { localizedPath } from "./i18n.js";
import type { MarkdownSection } from "./markdown-routes.js";
import {
  contentRouteUrl,
  markdownSections,
  suffixEditionUrl,
} from "./markdown-routes.js";

/** A page for `tanstackStart({ pages })` to prerender. */
interface PrerenderPage {
  path: string;
}

/**
 * Sections whose bare path is a Markdown edition of its own. The docs index
 * page already carries the `/docs.md` edition; `changelog` and `blog` answer
 * their bare section path with a generated listing. The `/learn` course
 * listing has no Chinese edition, so `prerenderPages` adds it for English
 * alone.
 */
const landingSections: MarkdownSection[] = ["changelog", "blog"];

/** The SEO endpoints, which render from the collections and never change per request. */
const seoPages: PrerenderPage[] = [
  { path: "/sitemap.xml" },
  { path: "/robots.txt" },
  { path: "/changelog/rss.xml" },
];

/**
 * Every build-time-safe machine route.
 * @param landings whether the section listings' editions join the list; their
 *   copy comes from the English catalog, so the Chinese list leaves them out.
 */
function machineRoutePages(
  content: Record<MarkdownSection, { slugs: string[] }[]>,
  { landings }: { landings: boolean },
): PrerenderPage[] {
  const pages: PrerenderPage[] = [];

  for (const section of markdownSections) {
    const slugSets = content[section].map((entry) => entry.slugs);
    if (landings && landingSections.includes(section)) slugSets.push([]);

    for (const slugs of slugSets) {
      const page = { section, slugs };
      pages.push({ path: suffixEditionUrl(page) });
      pages.push({ path: contentRouteUrl(page) });
    }
  }

  return pages;
}

/**
 * The HTML pages: the Workbench, the whole docs tree, the blog posts, the
 * changelog versions and the lessons, plus, with `landings`, the landing,
 * community, blog and changelog listing pages, whose copy comes from the
 * English catalog.
 */
function htmlPages(
  content: Record<MarkdownSection, { slugs: string[] }[]>,
  { landings }: { landings: boolean },
): PrerenderPage[] {
  const docs = content.docs.map((entry) => ({
    path: `/${["docs", ...entry.slugs].join("/")}`,
  }));
  const blog = content.blog.map((entry) => ({
    path: `/${["blog", ...entry.slugs].join("/")}`,
  }));
  const changelog = content.changelog.map((entry) => ({
    path: `/${["changelog", ...entry.slugs].join("/")}`,
  }));
  const learn = content.learn.map((entry) => ({
    path: `/${["learn", ...entry.slugs].join("/")}`,
  }));

  return [
    ...(landings ? [{ path: "/" }, { path: "/community" }] : []),
    { path: "/workbench" },
    ...docs,
    ...blog,
    ...changelog,
    ...learn,
    ...(landings ? [{ path: "/blog" }, { path: "/changelog" }] : []),
  ];
}

/**
 * Every route the build prerenders into the client output.
 * @param packageRoot the app's own root, which `vite.config.ts` owns.
 */
export function prerenderPages(packageRoot: string): PrerenderPage[] {
  const content = scanContent(packageRoot);

  const chinese = scanContent(packageRoot, { locale: "zh-CN" });
  return [
    ...seoPages,
    { path: "/llms.txt" },
    { path: "/llms-full.txt" },
    ...machineRoutePages(content, { landings: true }),
    ...htmlPages(content, { landings: true }),
    { path: "/learn" },
    { path: suffixEditionUrl({ section: "learn", slugs: [] }) },
    { path: contentRouteUrl({ section: "learn", slugs: [] }) },
    ...[
      ...machineRoutePages(chinese, { landings: false }),
      ...htmlPages(chinese, { landings: false }),
    ].map(({ path }) => ({ path: localizedPath(path, "zh-CN") })),
  ];
}
