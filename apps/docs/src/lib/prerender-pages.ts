// The prerender page list handed to TanStack Start in `vite.config.ts`.
//
// The routes are listed here deliberately rather than discovered, so the build
// stays explicit about what the asset layer answers without a Worker
// invocation. `src/lib/content-scan.ts` supplies the content side of the list;
// `src/http.test.ts` asserts the built site carries a prerendered file for
// every page the loaders publish.
//
// Every HTML page is on the list — the pages with GitHub data bake the facts
// their build saw and refresh them client-side — so the Worker renders only
// the search and release-fact endpoints and the Pre-release Docs fallback.
// @see docs/adr/0025-the-docs-site-prerenders-asset-first-and-falls-through-to-an-ssr-worker.md

import { scanContent } from "./content-scan.ts";
import type { MarkdownSection } from "./markdown-routes.ts";
import {
  contentRouteUrl,
  markdownSections,
  suffixEditionUrl,
} from "./markdown-routes.ts";

/** A page for `tanstackStart({ pages })` to prerender. */
interface PrerenderPage {
  path: string;
}

/**
 * Sections whose bare path is a Markdown edition of its own. The docs index
 * page already carries the `/docs.md` edition; `changelog` and `blog` answer
 * their bare section path with a generated listing.
 */
const landingSections: MarkdownSection[] = ["changelog", "blog"];

/** The SEO endpoints, which render from the collections and never change per request. */
const seoPages: PrerenderPage[] = [
  { path: "/sitemap.xml" },
  { path: "/robots.txt" },
  { path: "/changelog/rss.xml" },
];

/** Every build-time-safe machine route. */
function machineRoutePages(
  content: Record<MarkdownSection, { slugs: string[] }[]>,
): PrerenderPage[] {
  const pages: PrerenderPage[] = [
    ...seoPages,
    { path: "/llms.txt" },
    { path: "/llms-full.txt" },
  ];

  for (const section of markdownSections) {
    const slugSets = content[section].map((entry) => entry.slugs);
    if (landingSections.includes(section)) slugSets.push([]);

    for (const slugs of slugSets) {
      const page = { section, slugs };
      pages.push({ path: suffixEditionUrl(page) });
      pages.push({ path: contentRouteUrl(page) });
    }
  }

  return pages;
}

/**
 * The HTML pages: the landing and community pages, the whole docs tree, the
 * blog and its posts, and the changelog index with its versions.
 */
function htmlPages(
  content: Record<MarkdownSection, { slugs: string[] }[]>,
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

  return [
    { path: "/" },
    { path: "/community" },
    ...docs,
    ...blog,
    ...changelog,
    { path: "/blog" },
    { path: "/changelog" },
  ];
}

/**
 * Every route the build prerenders into the client output.
 * @param packageRoot the app's own root, which `vite.config.ts` owns.
 */
export function prerenderPages(packageRoot: string): PrerenderPage[] {
  const content = scanContent(packageRoot);

  return [...machineRoutePages(content), ...htmlPages(content)];
}
