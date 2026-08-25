// The prerender page list handed to TanStack Start in `vite.config.ts`.
//
// The routes are listed here deliberately rather than discovered, so the build
// stays explicit about what the asset layer answers without a Worker
// invocation. `src/lib/content-scan.ts` supplies the content side of the list;
// `src/http.test.ts` asserts the built site carries a prerendered file for
// every page the loaders publish.
//
// What is missing from the list is the other half of the shape: the landing
// page, the community page, the two install docs pages, and the per-version
// changelog page all carry request-time behavior, so they render on the Worker.
// @see docs/adr/0025-the-docs-site-prerenders-asset-first-and-falls-through-to-an-ssr-worker.md

import { scanContent } from "./content-scan.ts";
import { installPageSlugs } from "./github-releases.ts";
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
 * The HTML pages whose body is settled at build time: the whole docs tree bar
 * the install pages, the blog and its posts, and the changelog index.
 */
function htmlPages(
  content: Record<MarkdownSection, { slugs: string[] }[]>,
): PrerenderPage[] {
  const docs = content.docs
    .filter((entry) => !installPageSlugs.includes(entry.slugs.join("/")))
    .map((entry) => ({ path: `/${["docs", ...entry.slugs].join("/")}` }));
  const blog = content.blog.map((entry) => ({
    path: `/${["blog", ...entry.slugs].join("/")}`,
  }));

  return [...docs, ...blog, { path: "/blog" }, { path: "/changelog" }];
}

/**
 * Every route the build prerenders into the client output.
 * @param packageRoot the app's own root, which `vite.config.ts` owns.
 */
export function prerenderPages(packageRoot: string): PrerenderPage[] {
  const content = scanContent(packageRoot);

  return [...machineRoutePages(content), ...htmlPages(content)];
}
