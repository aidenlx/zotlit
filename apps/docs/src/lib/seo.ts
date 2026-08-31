// Per-page title, canonical, OpenGraph, and Twitter tags, as a route `head`
// fragment.
//
// TanStack Router merges `head()` results down the matched route chain by tag
// identity, so a page's `og:*` entries replace the root's one by one instead of
// wholesale — the site-wide fields still come from `__root.tsx`, and a page
// overrides only what it names.

import type { Thing, WithContext } from "schema-dts";

import { appName, baseURL, ogImageUrl } from "./shared";
import type { OgType } from "./shared";
import { absoluteUrl, serializeJsonLd } from "./structured-data";

const OG_IMAGE_DIMENSIONS = { width: "1200", height: "630" } as const;

export const HOME_OG_ALT = "ZotLit — Zotero × Obsidian";

export interface PageSeo {
  /** Document `<title>`, rendered as "<title> | ZotLit". Omit for the bare site name. */
  title?: string;
  /** og:title / twitter:title. @default title */
  ogTitle?: string;
  description?: string;
  /** Canonical path, e.g. "/blog/foo" or "/". */
  path: string;
  card: { type: OgType; slugs?: string[]; alt: string };
  /** Present → og:type "article" with these fields; absent → og:type "website". */
  article?: { publishedTime: string; authors?: string[] };
  /** Extra `rel="alternate"` links, e.g. { "application/rss+xml": "/changelog/rss.xml" }. */
  feeds?: Record<string, string>;
  /** schema.org objects to publish as JSON-LD script tags in the head. */
  schemas?: WithContext<Thing>[];
}

/** OG/Twitter image tags: absolute card URL plus its dimensions, MIME, and alt. */
export function ogImageMeta(type: OgType, alt: string, slugs?: string[]) {
  const url = absoluteUrl(ogImageUrl(type, slugs));
  return [
    { property: "og:image", content: url },
    { property: "og:image:width", content: OG_IMAGE_DIMENSIONS.width },
    { property: "og:image:height", content: OG_IMAGE_DIMENSIONS.height },
    { property: "og:image:type", content: "image/webp" },
    { property: "og:image:alt", content: alt },
    { name: "twitter:image", content: url },
  ];
}

/** The `head` fragment for one page: title, description, canonical, OG, Twitter. */
export function pageHead(seo: PageSeo) {
  const ogTitle = seo.ogTitle ?? seo.title ?? appName;
  const canonical = absoluteUrl(seo.path);

  return {
    meta: [
      { title: seo.title ? `${seo.title} | ${appName}` : appName },
      ...(seo.description === undefined
        ? []
        : [
            { name: "description", content: seo.description },
            { property: "og:description", content: seo.description },
            { name: "twitter:description", content: seo.description },
          ]),
      { property: "og:url", content: canonical },
      { property: "og:title", content: ogTitle },
      { name: "twitter:title", content: ogTitle },
      ...(seo.article
        ? [
            { property: "og:type", content: "article" },
            {
              property: "article:published_time",
              content: seo.article.publishedTime,
            },
            ...(seo.article.authors ?? []).map((author) => ({
              property: "article:author",
              content: author,
            })),
          ]
        : [{ property: "og:type", content: "website" }]),
      ...ogImageMeta(seo.card.type, seo.card.alt, seo.card.slugs),
    ],
    links: [
      { rel: "canonical", href: canonical },
      ...Object.entries(seo.feeds ?? {}).map(([type, path]) => ({
        rel: "alternate",
        type,
        href: `${baseURL}${path}`,
      })),
    ],
    scripts: (seo.schemas ?? []).map((schema) => ({
      type: "application/ld+json",
      children: serializeJsonLd(schema),
    })),
  };
}
