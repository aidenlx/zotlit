// The prerender page list handed to TanStack Start in `vite.config.ts`.
//
// Vite loads its config outside the app's module graph, so the collection
// index (`collections/server`, built on `import.meta.glob`) is out of reach
// here. The list comes from the content directory instead, through fumadocs'
// own `getSlugs`, which applies the folder-group and `index` rules the loaders
// apply. `src/http.test.ts` asserts the built site carries a prerendered file
// for every page the loaders publish, so a drift between this scan and the
// collections fails the test run.

import { getSlugs } from "fumadocs-core/source";
import { globSync } from "node:fs";
import { resolve } from "node:path";

import type { MarkdownSection } from "./markdown-routes.ts";
import { contentRouteUrl, suffixEditionUrl } from "./markdown-routes.ts";

/** A page for `tanstackStart({ pages })` to prerender. */
interface PrerenderPage {
  path: string;
}

/**
 * One content directory per section, matching the file patterns the
 * collections in `source.config.ts` pick up.
 */
const sections: {
  section: MarkdownSection;
  dir: string;
  files: string;
  /** Whether the bare section path is an edition of its own. */
  landing: boolean;
}[] = [
  // The docs index page already carries the `/docs.md` edition; `changelog`
  // and `blog` answer their bare section path with a generated listing.
  {
    section: "docs",
    dir: "content/docs",
    files: "**/[!_]*.mdx",
    landing: false,
  },
  {
    section: "changelog",
    dir: "content/changelog",
    files: "**/*.{mdx,md}",
    landing: true,
  },
  {
    section: "blog",
    dir: "content/blog",
    files: "**/*.{mdx,md}",
    landing: true,
  },
];

/**
 * Every route of the Markdown surface, for the build to prerender.
 * @param packageRoot the app's own root, which `vite.config.ts` owns.
 */
export function markdownEditionPages(packageRoot: string): PrerenderPage[] {
  const pages: PrerenderPage[] = [
    { path: "/llms.txt" },
    { path: "/llms-full.txt" },
  ];

  for (const { section, dir, files, landing } of sections) {
    const slugSets = globSync(files, {
      cwd: resolve(packageRoot, dir),
    }).map(getSlugs);
    if (landing) slugSets.push([]);

    for (const slugs of slugSets) {
      const page = { section, slugs };
      pages.push({ path: suffixEditionUrl(page) });
      pages.push({ path: contentRouteUrl(page) });
    }
  }

  return pages;
}
