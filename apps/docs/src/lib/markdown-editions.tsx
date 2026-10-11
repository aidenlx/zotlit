// The authored Markdown editions of every page, and the two llms indexes.
//
// Server-only: the editions come from the native macro collections through
// `src/lib/source.ts`. Each page compiles to a `_markdown` component — the
// `output: "function"` step in `content.config.ts` — whose prose is already
// stringified and whose JSX elements arrive with their evaluated props. This
// module renders that component and owns `mdxComponents`, the map those
// elements resolve against: a component there that calls `asMarkdown()` gives
// its own Markdown form, and every other one is serialized as JSX.
// `src/lib/markdown-routes.ts` owns the URLs these editions answer at.

import { renderToMarkdown } from "fumadocs-core/server";
import { llms } from "fumadocs-core/source";
import type { ComponentType, ElementType } from "react";

import { ActionLink } from "@/components/action-link";
import { Callout } from "@/components/callout";
import { Command } from "@/components/command";
import { ContractTable } from "@/components/contract-table";
import { SettingsPath } from "@/components/settings-path";
import { UiLabel } from "@/components/ui-label";
import * as m from "@/paraglide/messages.js";

import type { SiteLocale } from "./i18n";
import { localizeMarkdownLinks } from "./markdown-locale-links";
import type { MarkdownPage } from "./markdown-routes";
import {
  blog,
  changelog,
  getBlogPages,
  getChangelogPages,
  source,
} from "./source";

/** Every edition is authored Markdown, never HTML converted after the fact. */
export const markdownHeaders = {
  "content-type": "text/markdown; charset=utf-8",
};

/** The `llms*.txt` indexes answer as plain text, the way a `.txt` asset does. */
export const plainTextHeaders = {
  "content-type": "text/plain; charset=utf-8",
};

/** The components an edition's JSX elements resolve against. */
const mdxComponents: Record<string, ElementType> = {
  ActionLink,
  Callout,
  Command,
  ContractTable,
  SettingsPath,
  UiLabel,
};

/** The `_markdown` export every page carries under `output: "function"`. */
type MarkdownBody = ComponentType<{
  components: Record<string, ElementType>;
}>;

/** A page of any of the three collections, seen through what an edition needs. */
interface EditionPage {
  url: string;
  data: { load: () => Promise<{ _exports: Record<string, unknown> }> };
}

/** The page's body as Markdown, rendered through its `_markdown` component. */
async function renderBody(page: EditionPage, locale: SiteLocale) {
  const { _exports } = await page.data.load();
  const Body = _exports._markdown as MarkdownBody | undefined;
  if (!Body) {
    throw new Error(`${page.url} carries no Markdown edition`);
  }

  return localizeMarkdownLinks(
    await renderToMarkdown(<Body components={mdxComponents} />),
    locale,
  );
}

/** Title line, page URL, then the rendered Markdown body. */
async function renderPage(
  heading: string,
  page: EditionPage,
  locale: SiteLocale,
) {
  return `# ${heading} (${page.url})

${await renderBody(page, locale)}`;
}

/** A docs page's edition. */
function renderDocsPage(
  page: (typeof source)["$inferPage"],
  locale: SiteLocale,
) {
  return renderPage(page.data.title, page, locale);
}

/** Markdown listing under `heading`, each page linked to its `.md` edition. */
function renderIndex<
  Page extends { url: string; data: { description?: string } },
>(heading: string, pages: Page[], label: (page: Page) => string) {
  const items = pages
    .map((page) => {
      const description = page.data.description
        ? `: ${page.data.description}`
        : "";
      return `- [${label(page)}](${page.url}.md)${description}`;
    })
    .join("\n");

  return `# ${heading}

${items}
`;
}

/**
 * The Markdown edition of one page, or undefined when no page owns that path.
 * Empty `slugs` addresses the section's landing edition: the docs index page
 * for `docs`, a generated listing of entries for `changelog` and `blog`.
 */
export async function getMarkdownEdition(
  { section, slugs }: MarkdownPage,
  locale: SiteLocale = "en",
): Promise<string | undefined> {
  switch (section) {
    case "docs": {
      // The docs index is a page of its own, so it needs no generated listing.
      const page = source.getPage(slugs, locale);
      return page && renderDocsPage(page, locale);
    }
    case "changelog": {
      if (slugs.length === 0) {
        return renderIndex(
          m.docs_nav_changelog({}, { locale }),
          getChangelogPages(locale),
          (page) => `v${page.data.version}`,
        );
      }
      const page = changelog.getPage(slugs, locale);
      // Changelog entries rarely set a `title`, so the version is the fallback.
      return (
        page &&
        renderPage(
          page.data.title ?? `ZotLit v${page.data.version}`,
          page,
          locale,
        )
      );
    }
    case "blog": {
      if (slugs.length === 0) {
        return renderIndex(
          m.docs_nav_blog({}, { locale }),
          getBlogPages(locale),
          (page) => page.data.title,
        );
      }
      const page = blog.getPage(slugs, locale);
      return page && renderPage(page.data.title, page, locale);
    }
  }
}

/** `llms.txt`: the docs page tree as a Markdown index. */
export function getLlmsIndex() {
  return llms(source).index("en");
}

/** `llms-full.txt`: every docs page's edition, concatenated. */
export async function getLlmsFullText() {
  const editions = await Promise.all(
    source.getPages("en").map((page) => renderDocsPage(page, "en")),
  );

  return editions.join("\n\n");
}
