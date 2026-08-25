// Every OG card the build renders, keyed by the `/og/…/image.webp` URL it
// answers at.
//
// Node-only: the inventory comes from the content scan rather than the
// collections, for the reason `src/lib/content-scan.ts` explains. The card
// bodies below mirror what each page's own head advertises, so a page and its
// card always describe the same thing.

import * as v from "valibot";

import { scanContent } from "./content-scan.ts";
import type { ContentEntry } from "./content-scan.ts";
import type { CardProps } from "./og-card.tsx";
import {
  baseURL,
  formatReleaseDate,
  ogImageUrl,
  publishedOn,
} from "./shared.ts";
import type { OgType } from "./shared.ts";

const docsCard = v.object({
  title: v.string(),
  description: v.optional(v.string()),
});

const blogCard = v.object({
  title: v.string(),
  description: v.optional(v.string()),
  author: v.optional(v.string(), "aidenlx"),
  date: publishedOn,
});

const changelogCard = v.object({
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  version: v.string(),
  date: publishedOn,
});

/** The landing cards, which carry hand-written copy instead of frontmatter. */
const landingCards: [OgType, CardProps][] = [
  [
    "home",
    {
      hero: true,
      kind: "Zotero × Obsidian",
      title: "ZotLit",
      description:
        "Literature notes, citations, and annotations: bridged between Zotero and Obsidian.",
      meta: baseURL,
    },
  ],
  [
    "community",
    {
      kind: "Community",
      title: "Join the conversation.",
      description: "Get help, share ideas, and shape where ZotLit goes next.",
      meta: `${baseURL}/community`,
    },
  ],
  [
    "blog",
    {
      kind: "Blog",
      title: "The ZotLit blog",
      description: "Release notes, deep dives, and notes from building ZotLit.",
      meta: `${baseURL}/blog`,
    },
  ],
  [
    "changelog",
    {
      kind: "Changelog",
      title: "Changelog",
      description: "Every ZotLit release, newest first.",
      meta: `${baseURL}/changelog`,
    },
  ],
];

/** One card per content file of a section, read through that section's schema. */
function cardsOf<Schema extends v.GenericSchema>(
  type: OgType,
  entries: ContentEntry[],
  read: {
    schema: Schema;
    toCard: (data: v.InferOutput<Schema>) => CardProps;
  },
): [string, CardProps][] {
  return entries.map((entry) => [
    ogImageUrl(type, entry.slugs),
    read.toCard(v.parse(read.schema, entry.frontmatter)),
  ]);
}

/**
 * @param packageRoot the app's own root, which `vite.config.ts` owns.
 * @returns every card URL and the card it renders.
 */
export function ogCards(packageRoot: string): Map<string, CardProps> {
  const content = scanContent(packageRoot);

  return new Map<string, CardProps>([
    ...landingCards.map(([type, card]): [string, CardProps] => [
      ogImageUrl(type),
      card,
    ]),
    ...cardsOf("docs", content.docs, {
      schema: docsCard,
      toCard: (page) => ({
        kind: "Documentation",
        title: page.title,
        description: page.description,
        meta: baseURL,
      }),
    }),
    ...cardsOf("blog", content.blog, {
      schema: blogCard,
      toCard: (post) => ({
        kind: "Blog",
        title: post.title,
        description: post.description,
        meta: `${post.author} · ${formatReleaseDate(post.date)}`,
      }),
    }),
    ...cardsOf("changelog", content.changelog, {
      schema: changelogCard,
      toCard: (release) => ({
        kind: "Changelog",
        title: release.title ?? `v${release.version}`,
        description: release.description,
        meta: `v${release.version} · ${formatReleaseDate(release.date)}`,
      }),
    }),
  ]);
}
