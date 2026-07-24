import { blogs, changelogs, docs } from "collections/server";
import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { toFumadocsSource } from "fumadocs-mdx/runtime/server";
import { rcompare } from "semver";

import { docsContentRoute, docsRoute } from "./shared";

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

/** Changelog entries rarely set a `title`, so the version is the fallback heading. */
export async function getChangelogLLMText(
  page: (typeof changelog)["$inferPage"],
) {
  const processed = await page.data.getText("processed");
  const heading = page.data.title ?? `ZotLit v${page.data.version}`;

  return `# ${heading} (${page.url})

${processed}`;
}

export async function getBlogLLMText(page: (typeof blog)["$inferPage"]) {
  const processed = await page.data.getText("processed");

  return `# ${page.data.title} (${page.url})

${processed}`;
}

/** Markdown listing under `heading`, each page linked to its `.md` version. */
function renderMarkdownIndex<
  Page extends { url: string; data: { description?: string } },
>(heading: string, pages: Page[], label: (page: Page) => string) {
  const items = pages
    .map((page) => {
      const desc = page.data.description ? `: ${page.data.description}` : "";
      return `- [${label(page)}](${page.url}.md)${desc}`;
    })
    .join("\n");

  return `# ${heading}

${items}
`;
}

/** Markdown index of every changelog entry, each linked to its `.md` version. */
export function getChangelogIndexLLMText() {
  return renderMarkdownIndex(
    "Changelog",
    getChangelogPages(),
    (page) => `v${page.data.version}`,
  );
}

/** Markdown index of every blog post, each linked to its `.md` version. */
export function getBlogIndexLLMText() {
  return renderMarkdownIndex("Blog", getBlogPages(), (page) => page.data.title);
}
