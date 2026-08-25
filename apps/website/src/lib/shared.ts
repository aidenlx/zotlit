// Site-wide constants and small formatters shared by routes, components, and
// the redirect generator.

export const appName = "ZotLit";
export const appDescription =
  "ZotLit brings your Zotero library into Obsidian. Create literature notes, insert citations, and annotate PDFs without leaving your vault.";
export const docsRoute = "/docs";
export const changelogRoute = "/changelog";
export const blogRoute = "/blog";

export const gitConfig = {
  user: "aidenlx",
  repo: "zotlit",
  branch: "main",
};

export const repoUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

/** The frozen v1 site; every v1-only permalink still resolves there. */
export const zotlitLegacyUrl = "https://zotlit-v1.aidenlx.site";
/** Pre-release Docs, the beta deployment of this site. */
export const zotlitBetaUrl = "https://zotlit-beta.aidenlx.site";

/**
 * Publication day in the reader's long form. Collections normalize the day to
 * its ISO form (see `source.config.ts`), so the value parses as a UTC instant
 * and formats in UTC. `Date` stands in for `Temporal`
 * (policies/temporal-dates.md) because workerd carries no Temporal API.
 */
export function formatReleaseDate(isoDay: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${isoDay}T00:00:00Z`));
}
