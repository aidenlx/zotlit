// Redirect and header tables for the Cloudflare asset layer, expanded from the
// route inventory in lib/v1-routes.ts. `vite.config.ts` emits the rendered
// files into the client build so the asset layer answers them without a Worker
// invocation.
//
// Query contract carried to every landing page (read by the redirect notice):
//   lang=zh-CN — the request came from a /zh-CN path; v2 has no Chinese pages yet
//   from=v1    — the request came from a frozen v1 permalink (notice trigger)
//   src        — that v1 path, locale-neutral (e.g. /faq/slurp)
// `from=v1` + `src` together let the notice rebuild the exact v1 URL as:
//   zotlitLegacyUrl + (lang === "zh-CN" ? "/zh-CN" : "") + src
//
// ── zh-CN i18n follow-up ────────────────────────────────────────────────
// v2 has no /zh-CN/... routes yet, so every Chinese path lands on its English
// equivalent with a `lang=zh-CN` hint. Once zh-CN v2 pages render, replace the
// two Chinese branches below with per-page 308s to /zh-CN/<equiv>, derived from
// PAGE_MAP (no separate zh map to maintain).

import { zotlitLegacyUrl } from "./shared";
import { PAGE_MAP, V1_ONLY } from "./v1-routes";

/** One line of a Cloudflare `_redirects` file. */
export interface RedirectRule {
  source: string;
  destination: string;
  /** 308 for a permanent move, 307 while the target is still provisional. */
  status: 307 | 308;
}

/** One `_headers` block: a path pattern and the headers it adds. */
export interface HeaderRule {
  source: string;
  headers: Record<string, string>;
}

const q = (src: string, lang?: string) =>
  `?from=v1&src=${encodeURIComponent(src)}${lang ? `&lang=${lang}` : ""}`;

const external = (path: string): RedirectRule => ({
  source: path,
  destination: `${zotlitLegacyUrl}${path}`,
  status: 308,
});

/**
 * Every v1 permalink, in match order — the asset layer takes the first rule
 * whose source matches, so the specific Chinese routes precede the catch-all.
 */
export function buildV1Redirects(): RedirectRule[] {
  const redirects: RedirectRule[] = [];

  // English pages → closest v2 page.
  for (const [from, to] of Object.entries(PAGE_MAP)) {
    redirects.push({
      source: from,
      destination: `${to}${q(from)}`,
      status: 308,
    });
  }

  // Changelog → exact v1 page (external). zh entries stay specific and must
  // precede the locale-stripping catch-all below so it doesn't swallow them.
  redirects.push(...V1_ONLY.en.map(external), ...V1_ONLY.zh.map(external));

  // Known Chinese v1 permalinks → closest English v2 page (temporary until
  // zh-CN v2 pages exist), tagged so the notice can offer the exact v1 page.
  for (const [from, to] of Object.entries(PAGE_MAP)) {
    redirects.push({
      source: `/zh-CN${from}`,
      destination: `${to}${q(from, "zh-CN")}`,
      status: 307,
    });
  }

  // `/zh-CN` itself → the English home. Spelled out because the catch-all
  // below also matches the bare prefix but rebuilds it as `/zh-CN`, looping.
  // Carries no `from=v1`/`src`: v1's root is not a page worth linking back to.
  redirects.push({
    source: "/zh-CN",
    destination: "/?lang=zh-CN",
    status: 307,
  });

  // Every other Chinese route → the same path in English. A path with no
  // English page falls through to the normal 404.
  redirects.push({
    source: "/zh-CN/*",
    destination: "/:splat?lang=zh-CN",
    status: 307,
  });

  return redirects;
}

export function buildHeaderRules(): HeaderRule[] {
  return [
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
  ];
}

/** @see https://developers.cloudflare.com/workers/static-assets/redirects/ */
export function renderRedirectsFile(rules = buildV1Redirects()): string {
  const lines = rules.map(
    ({ source, destination, status }) => `${source} ${destination} ${status}`,
  );
  return `${lines.join("\n")}\n`;
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
