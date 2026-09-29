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
// @see docs/adr/0051-the-docs-site-prerenders-asset-first-and-falls-through-to-an-ssr-worker.md

import { scanContent } from "./content-scan.js";
import type { ContentSection, MarkdownPage } from "./markdown-routes.js";
import {
  contentRouteUrl,
  contentSections,
  suffixEditionUrl,
} from "./markdown-routes.js";
import { DIRECTORY_PATH, entryPath } from "./template-directory/site.js";
import type { DirectorySite } from "./template-directory/site.js";

/** A page for `tanstackStart({ pages })` to prerender. */
interface PrerenderPage {
  path: string;
}

/**
 * Sections whose bare path is a Markdown edition of its own. The docs index
 * page already carries the `/docs.md` edition; `changelog` and `blog` answer
 * their bare section path with a generated listing.
 */
const landingSections: ContentSection[] = ["changelog", "blog"];

/** The SEO endpoints, which render from the collections and never change per request. */
const seoPages: PrerenderPage[] = [
  { path: "/sitemap.xml" },
  { path: "/robots.txt" },
  { path: "/changelog/rss.xml" },
];

/** Every build-time-safe machine route. */
function machineRoutePages(
  content: Record<ContentSection, { slugs: string[] }[]>,
  directory: Pick<DirectorySite, "entries">,
): PrerenderPage[] {
  const editions: MarkdownPage[] = contentSections.flatMap((section) => {
    const slugSets = content[section].map((entry) => entry.slugs);
    if (landingSections.includes(section)) slugSets.push([]);
    return slugSets.map((slugs) => ({ section, slugs }));
  });
  // The Directory's index, then each entry at its `<kind folder>/<slug>` id.
  for (const slugs of [[], ...directory.entries.map(({ id }) => id.split("/"))])
    editions.push({ section: "templates", slugs });

  return [
    ...seoPages,
    { path: "/llms.txt" },
    { path: "/llms-full.txt" },
    ...editions.flatMap((page) => [
      { path: suffixEditionUrl(page) },
      { path: contentRouteUrl(page) },
    ]),
  ];
}

/**
 * The HTML pages: the landing, community, and Workbench pages, the whole docs
 * tree, the blog and its posts, the changelog index with its versions, and the
 * Template Directory with a page per entry.
 */
function htmlPages(
  content: Record<ContentSection, { slugs: string[] }[]>,
  directory: Pick<DirectorySite, "entries">,
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
    { path: "/workbench" },
    ...docs,
    ...blog,
    ...changelog,
    { path: "/blog" },
    { path: "/changelog" },
    { path: DIRECTORY_PATH },
    ...directory.entries.map(({ id }) => ({ path: entryPath(id) })),
  ];
}

/**
 * Every route the build prerenders into the client output.
 * @param packageRoot the app's own root, which `vite.config.ts` owns.
 * @param directory the Template Directory as the build read it.
 */
export function prerenderPages(
  packageRoot: string,
  directory: Pick<DirectorySite, "entries">,
): PrerenderPage[] {
  const content = scanContent(packageRoot);

  return [
    ...machineRoutePages(content, directory),
    ...htmlPages(content, directory),
  ];
}
