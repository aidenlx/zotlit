export const appName = "ZotLit";
export const baseURL =
  process.env.NEXT_PUBLIC_BASE_URL || "https://zotlit.aidenlx.site";
export const docsRoute = "/docs";
export const docsImageRoute = "/og/docs";
export const docsContentRoute = "/llms.mdx/docs";

export const gitConfig = {
  user: "aidenlx",
  repo: "zotlit",
  branch: "main",
};

export const zotlitLegacyUrl = "https://zotlit-v1.aidenlx.site";

/** OG card URL for a page type. Empty `ids` → the index/landing card. */
export function ogImageUrl(type: string, ...ids: string[]) {
  return `/og/${[type, ...ids, "image.webp"].join("/")}`;
}

export function formatReleaseDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}
