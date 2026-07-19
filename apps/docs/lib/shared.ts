export const appName = "ZotLit";
export const baseURL = "https://zotlit.aidenlx.site";
export const docsRoute = "/docs";
export const docsImageRoute = "/og/docs";
export const docsContentRoute = "/llms.mdx/docs";

export const gitConfig = {
  user: "aidenlx",
  repo: "zotlit",
  branch: "main",
};

export const zotlitLegacyUrl = "https://zotlit-v1.aidenlx.site";

export function formatReleaseDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}
