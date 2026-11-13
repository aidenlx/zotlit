// The `_headers` table for the Cloudflare asset layer. `vite.config.ts` emits
// the rendered file into the client build so the asset layer applies these
// headers without a Worker invocation.

import { regex } from "arkregex";

import { chinesePrefix, unlocalizedPath } from "./i18n.js";
import { htmlPagePath } from "./markdown-routes.js";
import { markdownEditionHeaders } from "./shared.js";
import type { DocsLine } from "./shared.js";

/** One `_headers` block: a path pattern and the headers it adds. */
export interface HeaderRule {
  source: string;
  headers: Record<string, string>;
}

const contentRoute = regex("^/llms\\.mdx/(?<page>.+)/content\\.md$");

/**
 * Keeps the prerendered Markdown editions the asset layer answers on its own —
 * the `/llms.mdx` content routes and each section's own `.md` edition — out of
 * the search index, each naming its HTML page canonical. `src/server.ts` gives
 * the Markdown answers that pass through the Worker the same headers.
 *
 * A placeholder matches one path segment, so the content routes take one rule
 * per depth, and the page is the route's segments before `content.md`. Only
 * native editions prerender, so a `/zh-CN` route names its Chinese page.
 */
function markdownEditionRules(pages: readonly string[]): HeaderRule[] {
  const canonicalBySource = new Map<string, string>();
  for (const path of pages) {
    const bare = unlocalizedPath(path);
    const prefix = bare === path ? "" : chinesePrefix;
    const route = contentRoute.exec(bare)?.groups.page;
    if (route !== undefined) {
      const segments = route
        .split("/")
        .map((_, index) => `:p${index + 1}`)
        .join("/");
      canonicalBySource.set(
        `${prefix}/llms.mdx/${segments}/content.md`,
        `${prefix}/${segments}`,
      );
    } else if (/^\/[^/]+\.md$/.test(bare)) {
      canonicalBySource.set(path, `${prefix}${htmlPagePath(bare)}`);
    }
  }
  return [...canonicalBySource].map(([source, page]) => ({
    source,
    headers: markdownEditionHeaders(page),
  }));
}

/**
 * Pre-release Docs repeats the production pages, so the beta line keeps every
 * file out of the search index. Cloudflare joins the values of a header that
 * two rules set, so the narrower `X-Robots-Tag` rules give way to this one.
 * @see src/server.ts for the same header on the pages the Worker answers.
 */
function betaLineRules(rules: HeaderRule[]): HeaderRule[] {
  return [
    { source: "/*", headers: { "X-Robots-Tag": "noindex" } },
    ...rules
      .map(({ source, headers }) => ({
        source,
        headers: Object.fromEntries(
          Object.entries(headers).filter(([name]) => name !== "X-Robots-Tag"),
        ),
      }))
      .filter(({ headers }) => Object.keys(headers).length > 0),
  ];
}

/**
 * @param pages every prerendered path, from `prerenderPages`.
 * @param options.docsLine the line this build deploys to.
 */
export function buildHeaderRules(
  pages: readonly string[] = [],
  { docsLine = "production" }: { docsLine?: DocsLine } = {},
): HeaderRule[] {
  const rules = siteRules(pages);
  return docsLine === "beta" ? betaLineRules(rules) : rules;
}

function siteRules(pages: readonly string[]): HeaderRule[] {
  return [
    // Native Chinese assets keep their language when served without the Worker.
    // Missing-file fallbacks, `/zh-CN` itself among them, have no asset and
    // receive English headers from SSR.
    { source: "/zh-CN/*", headers: { "Content-Language": "zh-CN" } },
    /**
     * giscus loads the custom comment themes (public/giscus/*.css) into its
     * cross-origin iframe via `<link crossorigin="anonymous">`, so they must
     * send an Access-Control-Allow-Origin header or the browser blocks the
     * stylesheet.
     */
    {
      source: "/giscus/*",
      headers: { "Access-Control-Allow-Origin": "https://giscus.app" },
    },
    // The asset layer types a prerendered `.xml` file as generic XML; feed
    // readers expect the RSS media type the Next.js site served.
    {
      source: "/changelog/rss.xml",
      headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
    },
    // Every archive URL is pinned to the commit it was built from, so its
    // bytes never change.
    {
      source: "/.well-known/agent-skills/*/archive.zip",
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    },
    /**
     * Every file under `/assets/` carries a content hash in its name, so a
     * changed build ships a new URL and these bytes never change. The asset
     * layer otherwise defaults to `public, max-age=0, must-revalidate`, which
     * costs a revalidation round trip per chunk, font, and stylesheet on every
     * repeat visit.
     *
     * Googlebot fetches the hashed chunks to render a page, so they stay
     * crawlable; the header alone keeps them out of the index. A `robots.txt`
     * rule here would block rendering instead.
     */
    {
      source: "/assets/*",
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Robots-Tag": "noindex",
      },
    },
    ...markdownEditionRules(pages),
  ];
}

/** @see https://developers.cloudflare.com/workers/static-assets/headers/ */
export function renderHeadersFile(rules = buildHeaderRules()): string {
  const blocks = rules.map(({ source, headers }) =>
    [
      source,
      ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`),
    ].join("\n"),
  );
  return `${blocks.join("\n\n")}\n`;
}
