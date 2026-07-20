// v1 → v2 permalink redirect table, expanded into Next.js `redirects()` entries.
//
// Query contract carried to every landing page (read by the v1 notices):
//   from=v1  — marks a v1→v2 redirect landing (notice trigger)
//   src      — v1 path with any locale prefix stripped (e.g. /faq/slurp)
//   lang     — absent = English (en-US); zh-CN = Chinese
// A notice rebuilds the exact v1 URL as:
//   zotlitLegacyUrl + (lang === "zh-CN" ? "/zh-CN" : "") + src
//
// ── zh-CN i18n follow-up ────────────────────────────────────────────────
// v2 has no /zh-CN/docs/... routes yet, so Chinese v1 permalinks currently
// bounce to the English home (`/`) with a hint (components/v1-home-notice).
// When zh-CN i18n ships (next-intl / Fumadocs i18n):
//   1. Ensure /zh-CN/docs/... pages render.
//   2. Flip `zhLocaleReady` to true — replaces the /zh-CN/* home-bounce with
//      per-page 308s to /zh-CN/docs/<equiv>, derived from PAGE_MAP (no separate
//      zh map to maintain).
//   3. components/v1-home-notice + its PAGE_MAP client import become dead (no
//      zh path lands on `/` anymore) and can be removed.

// Legacy v1 docs origin. Keep in sync with `zotlitLegacyUrl` in lib/shared.ts.
const LEGACY_ORIGIN = "https://zotlit-v1.aidenlx.site";

// Flip to `true` once zh-CN v2 docs exist. See the follow-up note above.
const zhLocaleReady = false;

/**
 * Old v1 URL path → closest v2 docs path. Keys are locale-neutral (v1 English
 * paths have no prefix); the `zh-CN` locale reuses the same targets. Also
 * imported client-side by components/v1-home-notice to deep-link the English
 * equivalent of a Chinese page during the interim home bounce.
 *
 * @type {Record<string, string>}
 */
export const PAGE_MAP = {
  "/getting-started/install": "/docs/install-zotlit",
  "/getting-started/install/obsidian": "/docs/install-zotlit",
  "/getting-started/install/zotero": "/docs/install-companion",
  "/getting-started/basic-usage": "/docs/tutorial",
  "/getting-started/basic-usage/annotation-import":
    "/docs/how-to/create-and-open-notes",
  "/getting-started/basic-usage/annotation-view":
    "/docs/how-to/use-annotation-view",
  "/getting-started/basic-usage/citation-insertion":
    "/docs/how-to/insert-citations",
  "/getting-started/basic-usage/template-basics":
    "/docs/tutorial/customize-template",
  "/getting-started/basic-usage/template-config":
    "/docs/how-to/customize-a-template",
  "/getting-started/basic-usage/update-notes":
    "/docs/how-to/keep-notes-updated",
  "/how-to/template-cheatsheet": "/docs/reference/templates/syntax",
  "/faq/slurp": "/docs/reference/templates/eta-syntax",
};

/**
 * v1-release-specific pages with no v2 equivalent, per locale. `/changelog/*`
 * collides with v2's live `/changelog/[version]` route, so these redirect
 * straight to the exact v1 page (no v2 landing, no notice). `/changelog/v1.0.0`
 * has no `zh-CN` counterpart on v1, so it is English-only.
 */
const V1_ONLY = {
  en: ["/changelog/v1.0.0", "/changelog/v1.1.0"],
  zh: ["/zh-CN/changelog/v1.1.0"],
};

const q = (src, lang) =>
  `?from=v1&src=${encodeURIComponent(src)}${lang ? `&lang=${lang}` : ""}`;

const external = (path) => ({
  source: path,
  destination: `${LEGACY_ORIGIN}${path}`,
  permanent: true,
});

/** @returns {import('next').Redirect[]} */
export function buildV1Redirects() {
  const redirects = [];

  // English pages → closest v2 page (308).
  for (const [from, to] of Object.entries(PAGE_MAP)) {
    redirects.push({
      source: from,
      destination: `${to}${q(from)}`,
      permanent: true,
    });
  }

  // Changelog → exact v1 page (308 external). zh entries stay specific and must
  // precede the interim catch-all below so it doesn't swallow them.
  redirects.push(...V1_ONLY.en.map(external), ...V1_ONLY.zh.map(external));

  if (zhLocaleReady) {
    // Per-page zh 308 → /zh-CN/docs/<equiv>, target derived from PAGE_MAP.
    for (const [from, to] of Object.entries(PAGE_MAP)) {
      redirects.push({
        source: `/zh-CN${from}`,
        destination: `/zh-CN${to}${q(from, "zh-CN")}`,
        permanent: true,
      });
    }
  } else {
    // Interim: every other Chinese v1 permalink bounces to the English home
    // (307, temporary) with a hint back to the exact v1 page.
    redirects.push(
      {
        source: "/zh-CN",
        destination: `/${q("/", "zh-CN")}`,
        permanent: false,
      },
      {
        source: "/zh-CN/:path*",
        destination: "/?from=v1&src=/:path*&lang=zh-CN",
        permanent: false,
      },
    );
  }

  return redirects;
}
