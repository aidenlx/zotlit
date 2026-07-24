// Per-page OpenGraph/Twitter/canonical metadata builder. Fields are spread
// per-page (not inherited) because Next.js shallow-merges the openGraph object.
import { type Metadata } from "next";

import { appName, type OgType, ogImageUrl } from "./shared";

const OG_IMAGE_DIMENSIONS = { width: 1200, height: 630 } as const;

export const HOME_OG_ALT = "ZotLit — Zotero × Obsidian";

/** OG/Twitter image descriptor: card URL + explicit dimensions, MIME, and alt. */
export function ogImageObject(type: OgType, alt: string, ...ids: string[]) {
  return {
    url: ogImageUrl(type, ...ids),
    ...OG_IMAGE_DIMENSIONS,
    type: "image/webp" as const,
    alt,
  };
}

export interface PageSeo {
  /** og:title / twitter:title. Defaults to `title` when omitted. */
  ogTitle?: string;
  /** Document <title>. Omit to inherit the layout default; a string gets the "%s | ZotLit" template. */
  title?: string;
  description?: string;
  /** Canonical path, e.g. "/blog/foo" or "/". */
  path: string;
  card: { type: OgType; ids?: string[]; alt: string };
  /** Present → og:type "article" with these fields; absent → og:type "website". */
  article?: { publishedTime: string; authors?: string[] };
  /** Extra alternates.types, e.g. { "application/rss+xml": "/changelog/rss.xml" }. */
  feeds?: Record<string, string>;
}

/**
 * Builds a page's OG/Twitter/canonical metadata block.
 *
 * Next.js shallow-merges `metadata` across route segments: a page-level
 * `openGraph` (or `alternates`) fully REPLACES the root layout's, it does not
 * deep-merge. Since nearly every content page sets its own `openGraph.images`,
 * the shared site fields (siteName, locale, twitter card type, image
 * dimensions...) have to be spread into each page's own `openGraph`/`twitter`
 * here rather than left to inherit from `app/layout.tsx`.
 */
export function pageMetadata(seo: PageSeo): Metadata {
  const ogTitle = seo.ogTitle ?? seo.title;
  const image = ogImageObject(
    seo.card.type,
    seo.card.alt,
    ...(seo.card.ids ?? []),
  );

  const ogBase = {
    siteName: appName,
    locale: "en_US",
    url: seo.path,
    title: ogTitle,
    description: seo.description,
    images: [image],
  };

  // og:type is a discriminated union in Next's types — article fields only type-check under type:"article".
  const openGraph: Metadata["openGraph"] = seo.article
    ? {
        ...ogBase,
        type: "article",
        publishedTime: seo.article.publishedTime,
        ...(seo.article.authors && { authors: seo.article.authors }),
      }
    : { ...ogBase, type: "website" };

  return {
    ...(seo.title !== undefined && { title: seo.title }),
    description: seo.description,
    alternates: {
      canonical: seo.path,
      ...(seo.feeds && { types: seo.feeds }),
    },
    openGraph,
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description: seo.description,
      images: [image],
    },
  };
}
