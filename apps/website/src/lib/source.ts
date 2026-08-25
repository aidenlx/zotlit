// fumadocs loaders over the three collections, one per content directory.
//
// The app's module graph deliberately stops short of this file: the MDX bodies
// import `fumadocs-ui` and `@/components/*` modules this package does not carry
// yet, and the collections' lazy body glob makes `vite build` compile every
// `.mdx` file as soon as a production module reaches a loader. The routing
// shell adds those components and the first route that imports this module;
// until then `source.test.ts` is what exercises the loaders.

import { blogs, changelogs, docs } from "collections/server";
import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { toFumadocsSource } from "fumadocs-mdx/runtime/server";
import { rcompare } from "semver";

/** @see https://github.com/fuma-nama/fumadocs/blob/fumadocs-mdx%4015.2.1/apps/docs/content/docs/headless/source-api/index.mdx */
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
});

export const changelog = loader({
  baseUrl: "/changelog",
  source: toFumadocsSource(changelogs, []),
});

/**
 * Newest publication day first. `source.config.ts` normalizes the day to its
 * ISO form, which orders lexicographically, so the compare needs no date type.
 */
function byNewestDay(a: { date: string }, b: { date: string }) {
  return b.date.localeCompare(a.date);
}

/** Changelog entries newest-first: day desc, semver desc as the tiebreak. */
export function getChangelogPages() {
  return changelog.getPages().toSorted((a, b) => {
    const dayCompare = byNewestDay(a.data, b.data);
    if (dayCompare !== 0) return dayCompare;
    return rcompare(a.data.version, b.data.version);
  });
}

export const blog = loader({
  baseUrl: "/blog",
  source: toFumadocsSource(blogs, []),
});

/** Blog posts newest-first: day desc, title asc as the tiebreak. */
export function getBlogPages() {
  return blog.getPages().toSorted((a, b) => {
    const dayCompare = byNewestDay(a.data, b.data);
    if (dayCompare !== 0) return dayCompare;
    return a.data.title.localeCompare(b.data.title);
  });
}
