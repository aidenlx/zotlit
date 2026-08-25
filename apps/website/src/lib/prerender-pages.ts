// The prerender page list handed to TanStack Start in `vite.config.ts`.
//
// The routes are listed here deliberately rather than discovered, so the build
// stays explicit about what the asset layer answers without a Worker
// invocation. `src/lib/content-scan.ts` supplies the content side of the list;
// `src/http.test.ts` asserts the built site carries a prerendered file for
// every page the loaders publish.

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

/**
 * Every build-time-safe machine route, for the build to prerender.
 * @param packageRoot the app's own root, which `vite.config.ts` owns.
 */
export function machineRoutePages(packageRoot: string): PrerenderPage[] {
  const pages: PrerenderPage[] = [
    ...seoPages,
    { path: "/llms.txt" },
    { path: "/llms-full.txt" },
  ];

  const content = scanContent(packageRoot);
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
