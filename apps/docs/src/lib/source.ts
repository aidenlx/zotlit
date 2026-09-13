// fumadocs loaders over the three collections, one per content directory.
//
// Routes reach these loaders through `createServerFn` handlers. The shared
// macro collections also provide lazy MDX bodies in the browser.

import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { rcompare } from "semver";

import { blogs, changelogs, docs } from "./collections";

/** @see https://github.com/fuma-nama/fumadocs/blob/fumadocs-mdx%4015.2.1/apps/docs/content/docs/headless/source-api/index.mdx */
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
});

export const changelog = loader({
  baseUrl: "/changelog",
  source: changelogs.toFumadocsSource(),
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
  source: blogs.toFumadocsSource(),
});

/** Blog posts newest-first: day desc, title asc as the tiebreak. */
export function getBlogPages() {
  return blog.getPages().toSorted((a, b) => {
    const dayCompare = byNewestDay(a.data, b.data);
    if (dayCompare !== 0) return dayCompare;
    return a.data.title.localeCompare(b.data.title);
  });
}
