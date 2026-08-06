// GitHub release + auto-update manifest lookups shared by the install pages.
import { gt, rcompare, valid } from "semver";

const REPO = "aidenlx/zotlit";
const ZOTERO_ADDON_ID = "zotlit@aidenlx.site";
/** ISR window: release facts may lag GitHub by up to an hour. */
export const REVALIDATE_SECONDS = 3600;

export type ReleaseChannel = "pre-release" | "stable";

export interface GhRelease {
  tag_name: string;
  prerelease: boolean;
  published_at: string;
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

/** Newest companion release resolved from a channel's auto-update manifest. */
export interface ZoteroCompanion {
  version: string;
  tag: string;
  xpiUrl: string;
  minVersion: string;
  maxVersion?: string;
}

/**
 * @returns parsed JSON, or null when the resource does not exist (404).
 * @throws on transient failures (network, rate limit) so callers can
 * distinguish "known missing" from "couldn't check".
 */
export async function fetchGitHubJson<T>(
  url: string,
  { cache }: { cache?: RequestCache } = {},
): Promise<T | null> {
  const res = await fetch(url, {
    // `cache` opts out of the fetch data cache — used inside unstable_cache so
    // an oversized response isn't stored whole; otherwise use the ISR window.
    ...(cache ? { cache } : { next: { revalidate: REVALIDATE_SECONDS } }),
    // Raises the GitHub rate limit from 60/hr (anonymous) to 5000/hr in CI.
    headers: process.env.GITHUB_TOKEN
      ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : undefined,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return (await res.json()) as T;
}

export const releasesUrl = `https://github.com/${REPO}/releases`;

export function assetUrl(tag: string, asset: string) {
  return `https://github.com/${REPO}/releases/download/${tag}/${asset}`;
}

export function tagUrl(tag: string) {
  return `https://github.com/${REPO}/releases/tag/${tag}`;
}

export function mainManifestUrl() {
  return `https://raw.githubusercontent.com/${REPO}/main/manifest.json`;
}

export function getReleases() {
  return fetchGitHubJson<GhRelease[]>(
    `https://api.github.com/repos/${REPO}/releases?per_page=30`,
  );
}

/**
 * Highest-precedence plugin pre-release. Plugin releases are tagged with a bare
 * semver version, so companion (`zt-…`) and infrastructure (`zotero-release`)
 * tags fail the validity check and drop out. GitHub lists releases by creation
 * date, which a re-cut tag inverts, so this picks by precedence instead.
 */
export function newestPreRelease(releases: GhRelease[]): GhRelease | null {
  return (
    releases
      .filter((r) => r.prerelease && valid(r.tag_name))
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
export function isDormant(preRelease: string, stable: string | null) {
  return stable !== null && !gt(preRelease, stable);
}

/**
 * Resolve the newest companion release advertised on a channel's auto-update
 * manifest, with its `.xpi` download URL and Zotero version bounds.
 * @returns null when the channel has no release yet (manifest missing or empty).
 */
export async function getZoteroCompanion(
  channel: ReleaseChannel,
): Promise<ZoteroCompanion | null> {
  const manifest = await fetchGitHubJson<ZoteroUpdateManifest>(
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
