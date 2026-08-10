export const appName = "ZotLit";
export const appDescription =
  "ZotLit brings your Zotero library into Obsidian. Create literature notes, insert citations, and annotate PDFs without leaving your vault.";
export const baseURL =
  process.env.NEXT_PUBLIC_BASE_URL || "https://zotlit.aidenlx.site";
export const docsRoute = "/docs";
export const changelogRoute = "/changelog";
export const blogRoute = "/blog";
export const docsContentRoute = "/llms.mdx/docs";
export const changelogContentRoute = "/llms.mdx/changelog";
export const blogContentRoute = "/llms.mdx/blog";

export const gitConfig = {
  user: "aidenlx",
  repo: "zotlit",
  branch: "main",
};

export const zotlitLegacyUrl = "https://zotlit-v1.aidenlx.site";
export const zotlitBetaUrl = "https://zotlit-beta.aidenlx.site";

// Vercel sets `VERCEL_ENV` to "production" only for the deployment bound to
// the production domain (zotlit.aidenlx.site) — preview deployments and
// local dev do not get it.
export const isProductionDeployment = process.env.VERCEL_ENV === "production";

// The OG card each `[type, …]` slug selects; kept here so both the `/og`
// route and page-level metadata (`ogImageUrl`/`pageMetadata`) share one
// source of truth instead of drifting.
export const ogTypes = [
  "home",
  "community",
  "blog",
  "changelog",
  "docs",
] as const;
export type OgType = (typeof ogTypes)[number];

/** OG card URL for a page type. Empty `ids` → the index/landing card. */
export function ogImageUrl(type: OgType, ...ids: string[]) {
  return `/og/${[type, ...ids, "image.webp"].join("/")}`;
}

export function formatReleaseDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}
