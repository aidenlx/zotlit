// Redirect table for the Cloudflare asset layer, expanded from the
// route inventory in lib/v1-routes.ts. `vite.config.ts` emits the rendered
// files into the client build so the asset layer answers them without a Worker
// invocation. The `_headers` file is lib/headers.ts.
//
// Query contract carried to every landing page (read by the redirect notice):
//   lang=zh-CN — the request came from a Chinese v1 path
//   from=v1    — the request came from a frozen v1 permalink (notice trigger)
//   src        — that v1 path, locale-neutral (e.g. /faq/slurp)
// `from=v1` + `src` together let the notice rebuild the exact v1 URL as:
//   zotlitLegacyUrl + (lang === "zh-CN" ? "/zh-CN" : "") + src
//
// Modern /zh-CN routes render through the locale router. Known Chinese v1
// permalinks move permanently to the matching Chinese v2 pages, derived from
// PAGE_MAP. Their translations must be complete before production deployment.

import { zotlitLegacyUrl } from "./shared.js";
import { PAGE_MAP, V1_ONLY } from "./v1-routes.js";

/** One line of a Cloudflare `_redirects` file. */
export interface RedirectRule {
  source: string;
  destination: string;
  /** 308 for a permanent move, 307 while the target is still provisional. */
  status: 307 | 308;
}

const q = (src: string, lang?: string) =>
  `?from=v1&src=${encodeURIComponent(src)}${lang ? `&lang=${lang}` : ""}`;

const external = (path: string): RedirectRule => ({
  source: path,
  destination: `${zotlitLegacyUrl}${path}`,
  status: 308,
});

/** Exact v1 permalinks; modern locale routes remain with the router. */
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

  // Changelog → exact v1 page (external).
  redirects.push(...V1_ONLY.en.map(external), ...V1_ONLY.zh.map(external));

  // Known Chinese v1 permalinks → closest Chinese v2 page, tagged so the
  // notice can offer the exact v1 page.
  for (const [from, to] of Object.entries(PAGE_MAP)) {
    redirects.push({
      source: `/zh-CN${from}`,
      destination: `/zh-CN${to}${q(from, "zh-CN")}`,
      status: 308,
    });
  }

  // v1 accepts trailing slashes. These old paths have no HTML assets on v2,
  // so asset HTML normalization cannot redirect their slash variants for us.
  return redirects.flatMap((rule) => [
    rule,
    { ...rule, source: `${rule.source}/` },
  ]);
}

/** @see https://developers.cloudflare.com/workers/static-assets/redirects/ */
export function renderRedirectsFile(rules = buildV1Redirects()): string {
  const lines = rules.map(
    ({ source, destination, status }) => `${source} ${destination} ${status}`,
  );
  return `${lines.join("\n")}\n`;
}
