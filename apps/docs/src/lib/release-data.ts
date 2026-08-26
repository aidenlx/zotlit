// The GitHub lookups: the install pages' release facts and the repository
// counters the landing and community pages show.
//
// Server-only — the `GITHUB_TOKEN` secret lives in the Worker environment. Each
// lookup is cached at the edge for about an hour, so a release shows up within
// the hour without a rebuild, and each degrades on its own: an unreachable
// GitHub costs the page its ledger or its counters, never the page itself.

import { env } from "cloudflare:workers";
import { gt, rcompare, valid } from "semver";

import { assetUrl, tagUrl } from "./github-releases";
import type { ReleaseChannel } from "./github-releases";
import { gitConfig, repoSlug } from "./shared";

const ZOTERO_ADDON_ID = "zotlit@aidenlx.site";
/** Release facts may lag GitHub by up to an hour. */
const CACHE_SECONDS = 3600;

/** The one host the rate-limit token belongs to. */
const API_HOST = "api.github.com";

interface GhRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
}

interface PluginManifest {
  version: string;
  minAppVersion: string;
  isDesktopOnly?: boolean;
}

/** Mozilla-format auto-update manifest hosted on the `zotero-release` tag. */
interface ZoteroUpdateManifest {
  addons: Record<
    string,
    {
      updates: {
        version: string;
        applications: {
          zotero: { strict_min_version: string; strict_max_version?: string };
        };
      }[];
    }
  >;
}

/**
 * The token raises the rate limit on GitHub's API alone. Every other host here
 * serves the file unauthenticated — a raw file, or a release asset whose URL
 * redirects to storage that rejects a request carrying two credentials — so the
 * header goes to the API host and nowhere else.
 */
function isApiRequest(url: string) {
  return new URL(url).host === API_HOST;
}

/**
 * @returns parsed JSON, or null when the resource is missing or the lookup
 * failed — a page degrades the same way either way.
 */
async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: {
        // GitHub's API rejects a request that names no client.
        "user-agent": `${gitConfig.user}-${gitConfig.repo}-docs`,
        ...(env.GITHUB_TOKEN &&
          isApiRequest(url) && {
            authorization: `Bearer ${env.GITHUB_TOKEN}`,
          }),
      },
      // `cf` is a Cloudflare addition to `RequestInit`; the hand-written
      // environment types in src/cloudflare-workers.d.ts leave the rest of the
      // workerd surface out, so the option is asserted in here.
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    } as RequestInit);
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

function getReleases() {
  return fetchJson<GhRelease[]>(
    `https://api.github.com/repos/${repoSlug}/releases?per_page=30`,
  );
}

/**
 * Highest-precedence plugin release on a channel. Plugin releases are tagged
 * with a bare semver version, so companion (`zt-…`) and infrastructure
 * (`zotero-release`) tags fail the validity check and drop out. GitHub lists
 * releases by creation date, which a re-cut tag inverts, so this picks by
 * precedence instead.
 */
function newestRelease(releases: GhRelease[], channel: ReleaseChannel) {
  return (
    releases
      .filter(
        (release) =>
          !release.draft &&
          release.prerelease === (channel === "pre-release") &&
          valid(release.tag_name),
      )
      .sort((a, b) => rcompare(a.tag_name, b.tag_name))
      .at(0) ?? null
  );
}

/**
 * Whether the pre-release channel is dormant — its newest version does not lead
 * stable, so the install pages advertise no pre-release. Equal versions count as
 * dormant: the channel is serving the stable build. An app with no stable
 * release yet is never dormant, since any pre-release leads it.
 */
function isDormant(preRelease: string, stable: string | null) {
  return stable !== null && !gt(preRelease, stable);
}

/** Newest companion release on a channel, with its `.xpi` and version bounds. */
async function getCompanion(channel: ReleaseChannel) {
  const manifest = await fetchJson<ZoteroUpdateManifest>(
    assetUrl(
      "zotero-release",
      channel === "pre-release" ? "update-beta.json" : "update.json",
    ),
  );
  const update = manifest?.addons[ZOTERO_ADDON_ID]?.updates.at(-1);
  if (!update) return null;

  const { version } = update;
  const { strict_min_version, strict_max_version } = update.applications.zotero;
  return {
    version,
    tag: `zt-${version}`,
    xpiUrl: assetUrl(`zt-${version}`, `zotlit-zotero-${version}.xpi`),
    minVersion: strict_min_version,
    maxVersion: strict_max_version,
  };
}

/**
 * Reader-facing compatibility range from the Mozilla-style version bounds.
 * `strict_max_version` may be absent or carry a trailing `*` wildcard, where
 * the wildcard spans every release in that line (`9.*` covers 9.0–9.x, `7.0.*`
 * covers 7.0.x). Those collapse to an open range or a whole-line label instead
 * of leaking the raw `*`.
 * @see https://extensionworkshop.com/documentation/develop/browser-compatibility/
 */
function formatZoteroRange(min: string, max?: string): string {
  if (!max || max === "*") return `Zotero ${min} or newer`;
  if (max.endsWith(".*")) {
    const line = max.slice(0, -2); // "9.*" -> "9", "7.0.*" -> "7.0"
    return min === `${line}.0`
      ? `Zotero ${line}.x`
      : `Zotero ${min} – ${line}.x`;
  }
  return min === max ? `Zotero ${min}` : `Zotero ${min} – ${max}`;
}

/** One filled row pair of the Version Ledger. */
export interface LedgerEntry {
  version: string;
  notesUrl: string;
  /** ISO instant of the release, when GitHub listed it. */
  publishedAt?: string;
  requires: string;
  note?: string;
}

/** A channel with nothing to advertise: never released, or dormant. */
export interface LedgerEmpty {
  empty: "not yet released" | "no pre-release available";
}

/** What one `<VersionLedger app channel>` renders; null when GitHub is unreachable. */
export type Ledger = LedgerEntry | LedgerEmpty | null;

/** The direct `.xpi` link one `<XpiDownload channel>` renders. */
export interface CompanionDownload {
  version: string;
  xpiUrl: string;
}

/** Every release fact an install page's body reads, as one JSON payload. */
export interface ReleaseSnapshot {
  obsidian: Record<ReleaseChannel, Ledger>;
  zotero: Record<ReleaseChannel, Ledger>;
  companion: Record<ReleaseChannel, CompanionDownload | null>;
}

const dormant: LedgerEmpty = { empty: "no pre-release available" };

/**
 * Every release fact the install pages publish, in one pass so the two pages
 * share the same lookups.
 */
export async function getReleaseSnapshot(): Promise<ReleaseSnapshot> {
  const [releases, stableManifest, companionStable, companionPreRelease] =
    await Promise.all([
      getReleases(),
      fetchJson<PluginManifest>(
        `https://raw.githubusercontent.com/${repoSlug}/${gitConfig.branch}/manifest.json`,
      ),
      getCompanion("stable"),
      getCompanion("pre-release"),
    ]);

  const publishedAt = (tag: string) =>
    releases?.find((release) => release.tag_name === tag)?.published_at;

  const obsidianStable: Ledger = stableManifest && {
    version: stableManifest.version,
    notesUrl: tagUrl(stableManifest.version),
    publishedAt: publishedAt(stableManifest.version),
    requires: `Obsidian ≥ ${stableManifest.minAppVersion}`,
    note: stableManifest.isDesktopOnly ? "desktop only" : undefined,
  };

  const companionLedger = (channel: ReleaseChannel): Ledger => {
    const companion =
      channel === "pre-release" ? companionPreRelease : companionStable;
    if (channel === "pre-release") {
      if (
        !companion ||
        isDormant(companion.version, companionStable?.version ?? null)
      ) {
        return dormant;
      }
    }
    if (!companion) return { empty: "not yet released" };
    return {
      version: companion.version,
      notesUrl: tagUrl(companion.tag),
      publishedAt: publishedAt(companion.tag),
      requires: formatZoteroRange(companion.minVersion, companion.maxVersion),
    };
  };

  return {
    obsidian: {
      stable: obsidianStable,
      "pre-release": await getObsidianPreRelease(
        releases,
        stableManifest?.version ?? null,
      ),
    },
    zotero: {
      stable: companionLedger("stable"),
      "pre-release": companionLedger("pre-release"),
    },
    companion: {
      stable: companionStable,
      "pre-release": companionPreRelease,
    },
  };
}

/** The pre-release plugin ledger, whose manifest lives on the release itself. */
async function getObsidianPreRelease(
  releases: GhRelease[] | null,
  stableVersion: string | null,
): Promise<Ledger> {
  if (!releases) return null;
  const release = newestRelease(releases, "pre-release");
  if (!release || isDormant(release.tag_name, stableVersion)) return dormant;

  const manifest = await fetchJson<PluginManifest>(
    assetUrl(release.tag_name, "manifest.json"),
  );
  if (!manifest) return null;
  return {
    version: manifest.version,
    notesUrl: tagUrl(release.tag_name),
    publishedAt: release.published_at,
    requires: `Obsidian ≥ ${manifest.minAppVersion}`,
    note: manifest.isDesktopOnly ? "desktop only" : undefined,
  };
}

/** The counters the landing and community pages show beside the repo link. */
export interface RepoStats {
  stars: number | null;
  downloads: number | null;
}

/**
 * Stars from the GitHub API, downloads from Obsidian's community-plugin stats.
 * Each counter drops out on its own when its lookup fails.
 */
export async function getRepoStats(): Promise<RepoStats> {
  const [repo, plugins] = await Promise.all([
    fetchJson<{ stargazers_count: number }>(
      `https://api.github.com/repos/${repoSlug}`,
    ),
    fetchJson<Record<string, { downloads: number }>>(
      "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json",
    ),
  ]);

  return {
    stars: repo?.stargazers_count ?? null,
    downloads: plugins?.[gitConfig.repo]?.downloads ?? null,
  };
}

/**
 * GET handlers for a release-fact endpoint: the lookup's JSON, browser-cacheable
 * for the same horizon as the edge cache on the lookups themselves.
 */
export function releaseFactHandlers(lookup: () => Promise<unknown>) {
  return {
    GET: async () =>
      Response.json(await lookup(), {
        headers: { "cache-control": `public, max-age=${CACHE_SECONDS}` },
      }),
  };
}
