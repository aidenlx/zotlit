// Every OG card the build renders, keyed by the `/og/…/image.webp` URL it
// answers at.
//
// Node-only: the inventory comes from the content scan rather than the
// collections, for the reason `src/lib/content-scan.ts` explains. The card
// bodies below mirror what each page's own head advertises, so a page and its
// card always describe the same thing.

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as v from "valibot";

type Messages = typeof import("@/paraglide/messages.js");
import { scanContent } from "./content-scan.js";
import type { ContentEntry } from "./content-scan.js";
import type { CardProps } from "./og-card.js";
import {
  baseURL,
  formatReleaseDate,
  ogImageUrl,
  publishedOn,
} from "./shared.js";
import type { OgType } from "./shared.js";

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
function landingCards(m: Messages): [OgType, CardProps][] {
  return [
    [
      "home",
      {
        hero: true,
        kind: m.docs_og_home_kind(),
        title: "ZotLit",
        description: m.docs_og_home_description(),
        meta: baseURL,
      },
    ],
    [
      "community",
      {
        kind: m.docs_nav_community(),
        title: m.docs_og_community_title(),
        description: m.docs_og_community_description(),
        meta: `${baseURL}/community`,
      },
    ],
    [
      "workbench",
      {
        kind: "Workbench",
        title: "Template workbench",
        description:
          "Edit a literature note profile in the browser and see the note it produces.",
        meta: `${baseURL}/workbench`,
      },
    ],
    [
      "blog",
      {
        kind: m.docs_nav_blog(),
        title: m.docs_og_blog_title(),
        description: m.docs_og_blog_description(),
        meta: `${baseURL}/blog`,
      },
    ],
    [
      "changelog",
      {
        kind: m.docs_nav_changelog(),
        title: m.docs_nav_changelog(),
        description: m.docs_og_changelog_description(),
        meta: `${baseURL}/changelog`,
      },
    ],
  ];
}

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
export async function ogCards(
  packageRoot: string,
): Promise<Map<string, CardProps>> {
  // Asset hooks run after Paraglide generates the facade; config loading runs before it.
  const messagesUrl = pathToFileURL(
    join(packageRoot, "src/paraglide/messages.js"),
  );
  const m: Messages = await import(messagesUrl.href);
  const content = scanContent(packageRoot);

  return new Map<string, CardProps>([
    ...landingCards(m).map(([type, card]): [string, CardProps] => [
      ogImageUrl(type),
      card,
    ]),
    ...cardsOf("docs", content.docs, {
      schema: docsCard,
      toCard: (page) => ({
        kind: m.docs_og_documentation_kind(),
        title: page.title,
        description: page.description,
        meta: baseURL,
      }),
    }),
    ...cardsOf("blog", content.blog, {
      schema: blogCard,
      toCard: (post) => ({
        kind: m.docs_nav_blog(),
        title: post.title,
        description: post.description,
        meta: `${post.author} · ${formatReleaseDate(post.date)}`,
      }),
    }),
    ...cardsOf("changelog", content.changelog, {
      schema: changelogCard,
      toCard: (release) => ({
        kind: m.docs_nav_changelog(),
        title: release.title ?? `v${release.version}`,
        description: release.description,
        meta: `v${release.version} · ${formatReleaseDate(release.date)}`,
      }),
    }),
  ]);
}
