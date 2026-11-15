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

type Messages = typeof import("#paraglide/messages.js");
import { scanContent } from "./content-scan.js";
import type { ContentEntry } from "./content-scan.js";
import { chineseCatalogPages } from "./i18n.js";
import type { SiteLocale } from "./i18n.js";
import type { CardProps } from "./og-card.js";
import {
  baseURL,
  docsPageTitle,
  formatReleaseDate,
  ogImageUrl,
  publishedOn,
} from "./shared.js";
import type { OgType } from "./shared.js";

const docsCard = v.object({
  title: v.string(),
  searchTitle: v.optional(v.string()),
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

const lessonCard = v.object({
  title: v.string(),
  description: v.string(),
  lesson: v.number(),
  minutes: v.number(),
  steps: v.array(v.unknown()),
});

/** The site address a card of this edition prints in its footer. */
function editionSite(locale: SiteLocale): string {
  return locale === "zh-CN" ? `${baseURL}/zh-CN` : baseURL;
}

/** The landing cards, which carry hand-written copy instead of frontmatter. */
function landingCards(m: Messages, locale: SiteLocale): [OgType, CardProps][] {
  const o = { locale };
  const site = editionSite(locale);
  return [
    [
      "home",
      {
        hero: true,
        kind: m.docs_og_home_kind({}, o),
        title: "ZotLit",
        description: m.docs_og_home_description({}, o),
        meta: site,
      },
    ],
    [
      "community",
      {
        kind: m.docs_nav_community({}, o),
        title: m.docs_og_community_title({}, o),
        description: m.docs_og_community_description({}, o),
        meta: `${site}/community`,
      },
    ],
    [
      "workbench",
      {
        kind: m.docs_og_workbench_kind({}, o),
        title: m.workbench_title({}, o),
        description: m.workbench_description({}, o),
        meta: `${site}/workbench`,
      },
    ],
    [
      "learn",
      {
        kind: m.docs_nav_learn({}, o),
        title: m.docs_learn_title({}, o),
        description: m.docs_learn_description({}, o),
        meta: `${site}/learn`,
      },
    ],
    [
      "blog",
      {
        kind: m.docs_nav_blog({}, o),
        title: m.docs_og_blog_title({}, o),
        description: m.docs_og_blog_description({}, o),
        meta: `${site}/blog`,
      },
    ],
    [
      "changelog",
      {
        kind: m.docs_nav_changelog({}, o),
        title: m.docs_nav_changelog({}, o),
        description: m.docs_og_changelog_description({}, o),
        meta: `${site}/changelog`,
      },
    ],
  ];
}

/** The landing card types whose page has a native Chinese edition. */
const chineseLandingTypes = new Set<OgType>(
  chineseCatalogPages.map(
    (path) => (path === "/" ? "home" : path.slice(1)) as OgType,
  ),
);

/** One card per content file of a section, read through that section's schema. */
function cardsOf<Schema extends v.GenericSchema>(
  type: OgType,
  entries: ContentEntry[],
  read: {
    locale: SiteLocale;
    schema: Schema;
    toCard: (data: v.InferOutput<Schema>) => CardProps;
  },
): [string, CardProps][] {
  return entries.map((entry) => [
    ogImageUrl(type, { slugs: entry.slugs, locale: read.locale }),
    read.toCard(v.parse(read.schema, entry.frontmatter)),
  ]);
}

/**
 * One edition's cards: the English edition covers every page; the Chinese
 * edition covers the native Chinese files and catalog pages, since a fallback
 * page advertises the English card.
 */
function editionCards(
  m: Messages,
  packageRoot: string,
  locale: SiteLocale,
): [string, CardProps][] {
  const o = { locale };
  const content = scanContent(packageRoot, { locale });
  const landings = landingCards(m, locale).filter(
    ([type]) => locale === "en" || chineseLandingTypes.has(type),
  );
  return [
    ...landings.map(([type, card]): [string, CardProps] => [
      ogImageUrl(type, { locale }),
      card,
    ]),
    ...cardsOf("docs", content.docs, {
      locale,
      schema: docsCard,
      toCard: (page) => ({
        kind: m.docs_og_documentation_kind({}, o),
        title: docsPageTitle(page),
        description: page.description,
        meta: editionSite(locale),
      }),
    }),
    ...cardsOf("blog", content.blog, {
      locale,
      schema: blogCard,
      toCard: (post) => ({
        kind: m.docs_nav_blog({}, o),
        title: post.title,
        description: post.description,
        meta: `${post.author} · ${formatReleaseDate(post.date, o)}`,
      }),
    }),
    ...cardsOf("changelog", content.changelog, {
      locale,
      schema: changelogCard,
      toCard: (release) => ({
        kind: m.docs_nav_changelog({}, o),
        title: release.title ?? `v${release.version}`,
        description: release.description,
        meta: `v${release.version} · ${formatReleaseDate(release.date, o)}`,
      }),
    }),
    ...cardsOf("learn", content.learn, {
      locale,
      schema: lessonCard,
      toCard: (lesson) => ({
        kind: m.docs_learn_lesson_number({ number: lesson.lesson }, o),
        title: lesson.title,
        description: lesson.description,
        meta: m.docs_learn_course_meta(
          { minutes: lesson.minutes, steps: lesson.steps.length },
          o,
        ),
      }),
    }),
  ];
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
  return new Map<string, CardProps>([
    ...editionCards(m, packageRoot, "en"),
    ...editionCards(m, packageRoot, "zh-CN"),
  ]);
}
