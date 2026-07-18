import { blogs, changelogs, docs } from "collections/server";
import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { toFumadocsSource } from "fumadocs-mdx/runtime/server";
import { rcompare } from "semver";

import { docsContentRoute, docsImageRoute, docsRoute } from "./shared";

/** @see https://fumadocs.dev/docs/headless/source-api */
export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
});

export const changelog = loader({
  baseUrl: "/changelog",
  source: toFumadocsSource(changelogs, []),
});

/** Changelog entries newest-first: date desc, semver desc as the tiebreak. */
export function getChangelogPages() {
  return changelog.getPages().toSorted((a, b) => {
    const dateCompare = b.data.date.getTime() - a.data.date.getTime();
    if (dateCompare !== 0) return dateCompare;
    return rcompare(a.data.version, b.data.version);
  });
}

export const blog = loader({
  baseUrl: "/blog",
  source: toFumadocsSource(blogs, []),
});

/** Blog posts newest-first: date desc, title asc as the tiebreak. */
export function getBlogPages() {
  return blog.getPages().toSorted((a, b) => {
    const dateCompare = b.data.date.getTime() - a.data.date.getTime();
    if (dateCompare !== 0) return dateCompare;
    return a.data.title.localeCompare(b.data.title);
  });
}

export function getPageImage(page: (typeof source)["$inferPage"]) {
  const segments = [...page.slugs, "image.webp"];

  return {
    segments,
    url: `${docsImageRoute}/${segments.join("/")}`,
  };
}

export function getPageMarkdownUrl(page: (typeof source)["$inferPage"]) {
  const segments = [...page.slugs, "content.md"];

  return {
    segments,
    url: `${docsContentRoute}/${segments.join("/")}`,
  };
}

export async function getLLMText(page: (typeof source)["$inferPage"]) {
  const processed = await page.data.getText("processed");

  return `# ${page.data.title} (${page.url})

${processed}`;
}
