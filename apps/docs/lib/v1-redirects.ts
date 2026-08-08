// Redirect table for the frozen v1 site, expanded into Next.js `redirects()`
// entries from the route inventory in lib/v1-routes.ts.
//
// Query contract carried to every landing page (read by components/redirect-notice):
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

import type { NextConfig } from "next";

import { zotlitLegacyUrl } from "./shared";
import { PAGE_MAP, V1_ONLY } from "./v1-routes";

type Redirect = Awaited<
  ReturnType<NonNullable<NextConfig["redirects"]>>
>[number];

const q = (src: string, lang?: string) =>
  `?from=v1&src=${encodeURIComponent(src)}${lang ? `&lang=${lang}` : ""}`;

const external = (path: string): Redirect => ({
  source: path,
  destination: `${zotlitLegacyUrl}${path}`,
  permanent: true,
});

export function buildV1Redirects(): Redirect[] {
  const redirects: Redirect[] = [];

  // English pages → closest v2 page (308).
  for (const [from, to] of Object.entries(PAGE_MAP)) {
    redirects.push({
      source: from,
      destination: `${to}${q(from)}`,
      permanent: true,
    });
  }

  // Changelog → exact v1 page (308 external). zh entries stay specific and must
  // precede the locale-stripping catch-all below so it doesn't swallow them.
  redirects.push(...V1_ONLY.en.map(external), ...V1_ONLY.zh.map(external));

  // Known Chinese v1 permalinks → closest English v2 page (307, temporary until
  // zh-CN v2 pages exist), tagged so the notice can offer the exact v1 page.
  for (const [from, to] of Object.entries(PAGE_MAP)) {
    redirects.push({
      source: `/zh-CN${from}`,
      destination: `${to}${q(from, "zh-CN")}`,
      permanent: false,
    });
  }

  // `/zh-CN` itself → the English home (307). Spelled out because the catch-all
  // below also matches the bare prefix but rebuilds it as `/zh-CN`, looping.
  // Carries no `from=v1`/`src`: v1's root is not a page worth linking back to.
  redirects.push({
    source: "/zh-CN",
    destination: "/?lang=zh-CN",
    permanent: false,
  });

  // Every other Chinese route → the same path in English (307). Next carries the
  // visitor's own query params across, and a path with no English page falls
  // through to the normal 404.
  redirects.push({
    source: "/zh-CN/:path*",
    destination: "/:path*?lang=zh-CN",
    permanent: false,
  });

  return redirects;
}
