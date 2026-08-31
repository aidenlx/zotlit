// Frozen v1 route inventory. The v1 site no longer changes, so this file is the
// explicit list of its routes; lib/v1-redirects.ts turns them into redirects.

/**
 * Old v1 content path → closest v2 path. Keys are locale-neutral (v1 English
 * paths have no prefix); the `zh-CN` locale reuses the same targets. v1's root
 * (its Introduction page) is absent on purpose: `/` and `/zh-CN` are live v2
 * routes, so they carry no v1 back-link.
 */
export const PAGE_MAP: Record<string, string> = {
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
 * collides with v2's live `/changelog/[version]` route, so these keep pointing
 * at the exact v1 page (no v2 landing, no notice). `/changelog/v1.0.0` has no
 * `zh-CN` counterpart on v1, so it is English-only.
 */
export const V1_ONLY = {
  en: ["/changelog/v1.0.0", "/changelog/v1.1.0"],
  zh: ["/zh-CN/changelog/v1.1.0"],
};
