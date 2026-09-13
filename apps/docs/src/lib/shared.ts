// Site-wide constants and small formatters shared by routes, components, and
// the redirect generator.

import * as v from "valibot";

export const appName = "ZotLit";
export const appDescription =
  "ZotLit brings your Zotero library into Obsidian. Create literature notes, insert citations, and annotate PDFs without leaving your vault.";
/** Origin every canonical URL, OG card, sitemap entry, and feed link resolves against. */
export const baseURL = "https://zotlit.aidenlx.site";
export const docsRoute = "/docs";
export const changelogRoute = "/changelog";
export const changelogFeedRoute = `${changelogRoute}/rss.xml`;
export const blogRoute = "/blog";

export const gitConfig = {
  user: "aidenlx",
  repo: "zotlit",
  branch: "main",
};

/** The repository branch that publishes each documentation line. */
export function docsSourceBranch(docsLine: Cloudflare.Env["DOCS_LINE"]) {
  return docsLine === "beta" ? "next" : gitConfig.branch;
}

/** `owner/name`, the form GitHub's API and giscus both name the repository by. */
export const repoSlug = `${gitConfig.user}/${gitConfig.repo}` as const;

export const repoUrl = `https://github.com/${repoSlug}`;

/** The frozen v1 site; every v1-only permalink still resolves there. */
export const zotlitLegacyUrl = "https://zotlit-v1.aidenlx.site";
/** Pre-release Docs, the beta deployment of this site. */
export const zotlitBetaUrl = "https://zotlit-beta.aidenlx.site";

/**
 * The OG card each `/og/<type>/…` URL selects. One list feeds both the card
 * inventory the build renders and the `og:image` URL every page head carries,
 * so the two cannot drift.
 */
export const ogTypes = [
  "home",
  "community",
  "blog",
  "changelog",
  "docs",
] as const;
export type OgType = (typeof ogTypes)[number];

/** OG card URL for a page type. Empty `slugs` → the index/landing card. */
export function ogImageUrl(type: OgType, slugs: string[] = []) {
  return `/og/${[type, ...slugs, "image.webp"].join("/")}`;
}

/**
 * Publication day. A quoted frontmatter date arrives as an ISO day string, an
 * unquoted one as the UTC-midnight `Date` the YAML parser built; both normalize
 * to the ISO day here. The value crosses into the collection index as that
 * string because the index is JSON — see the date note in AGENTS.md. `Date`
 * stands in for `Temporal` (policies/temporal-dates.md) because workerd carries
 * no Temporal API.
 *
 * `source.config.ts` reads frontmatter through this schema, and the build-time
 * OG card scan reads the same frontmatter through it again.
 */
export const publishedOn = v.pipe(
  v.union([v.pipe(v.string(), v.isoDate()), v.date()]),
  v.transform((val) =>
    typeof val === "string" ? val : val.toISOString().slice(0, 10),
  ),
);

/**
 * The closing year of the footer's copyright range, read at render time.
 * `Date` stands in for `Temporal` (policies/temporal-dates.md) because workerd
 * carries no Temporal API.
 */
export function currentYear() {
  return new Date().getFullYear();
}

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

/**
 * Publication day in the reader's short form, from the ISO instant GitHub
 * stamps a release with; the day is read in UTC, as the long form is. `Date`
 * stands in for `Temporal` (policies/temporal-dates.md) because workerd carries
 * no Temporal API.
 */
export function formatReleaseInstant(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}
