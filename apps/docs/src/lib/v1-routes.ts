// Frozen v1 route inventory. The v1 site no longer changes, so this file is the
// explicit list of its routes; lib/v1-redirects.ts turns them into redirects.

/**
 * Old v1 content path → closest v2 path. Keys are locale-neutral (v1 English
 * paths have no prefix); the `zh-CN` locale reuses the same targets. v1's root
 * (its Introduction page) is absent on purpose: `/` and `/zh-CN` are live v2
 * routes, so they carry no v1 back-link.
 */
export const PAGE_MAP: Record<string, string> = {
  // The old how-to, tutorial, and concepts pages are gone from this branch;
  // version history keeps them. Until their feature pages exist, each v1 path
  // lands on the workflow section that will own it. The migration-map ticket
  // (#1609) repoints these at the final pages.
  "/getting-started/install": "/docs",
  "/getting-started/install/obsidian": "/docs",
  "/getting-started/install/zotero": "/docs/setup-and-troubleshooting",
  "/getting-started/basic-usage": "/docs",
  "/getting-started/basic-usage/annotation-import":
    "/docs/take-and-update-notes",
  "/getting-started/basic-usage/annotation-view": "/docs/find-and-read-sources",
  "/getting-started/basic-usage/citation-insertion": "/docs/cite-and-export",
  "/getting-started/basic-usage/template-basics": "/docs/customize-your-notes",
  "/getting-started/basic-usage/template-config": "/docs/customize-your-notes",
  "/getting-started/basic-usage/update-notes": "/docs/take-and-update-notes",
  "/how-to/template-cheatsheet": "/docs/reference/templates/syntax",
  "/faq/slurp": "/docs/reference/templates/eta-syntax",
};

/**
 * v1-release-specific pages with no v2 equivalent, per locale. `/changelog/*`
 * collides with v2's live `/changelog/[version]` route, so these keep pointing
 * at the exact v1 page (no v2 landing, no notice). `/changelog/v1.0.0` has no
 * `zh-CN` counterpart on v1, so it is English-only.
 */
export const V1_ONLY = {
  en: ["/changelog/v1.0.0", "/changelog/v1.1.0"],
  zh: ["/zh-CN/changelog/v1.1.0"],
};
