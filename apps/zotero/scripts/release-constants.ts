import { prerelease } from "semver";

/**
 * Constants shared between the build-time scripts (`manifest.ts`,
 * `build-update-json.ts`) and the release CI workflow.
 *
 * Zotero auto-update is served from a single permanent GitHub release tagged
 * {@link RELEASE_TAG}; it hosts {@link UPDATE_JSON} (stable channel) and
 * {@link UPDATE_BETA_JSON} (stable + prerelease channel) as assets. Per-version
 * XPIs live on `zt-{version}` releases.
 */
export const RELEASE_TAG = "zotero-release";
export const UPDATE_JSON = "update.json";
export const UPDATE_BETA_JSON = "update-beta.json";

/** Markdown notes body for the {@link RELEASE_TAG} host release, emitted to `dist/` by `build-update-json.ts`. */
export const HOST_NOTES = "release-host-notes.md";

export interface RepoRef {
  owner: string;
  repo: string;
}

/**
 * Accepts both the string shorthand and the `{ url }` object form.
 *
 * @throws if the URL does not contain an `owner/repo` path.
 */
export function parseRepository(repository: unknown): RepoRef {
  const raw =
    typeof repository === "string"
      ? repository
      : (repository as { url?: string } | undefined)?.url;
  if (!raw) {
    throw new Error("package.json#repository is missing or has no url");
  }

  const normalized = raw.replace(/^git\+/, "").replace(/\.git$/, "");
  const { pathname } = new URL(normalized);
  const [owner, repo] = pathname.split("/").filter(Boolean);
  if (!owner || !repo) {
    throw new Error(`Cannot parse owner/repo from repository url: ${raw}`);
  }

  return { owner, repo };
}

/** Per-version release tag for the Zotero companion (e.g. `zt-2.0.0-alpha.1`). */
export function zoteroTag(version: string): string {
  return `zt-${version}`;
}

export function xpiName(version: string): string {
  return `zotlit-zotero-${version}.xpi`;
}

/**
 * Update-channel manifest filename for a version: prereleases resolve to the
 * beta channel, stable releases to the stable channel.
 */
export function updateJsonName(version: string): string {
  return prerelease(version) ? UPDATE_BETA_JSON : UPDATE_JSON;
}

function releaseDownloadUrl(
  { owner, repo }: RepoRef,
  tag: string,
  file: string,
): string {
  return `https://github.com/${owner}/${repo}/releases/download/${tag}/${file}`;
}

/**
 * `update_url` written into the Zotero manifest. Points at the channel manifest
 * on the rolling {@link RELEASE_TAG} release, selected by prerelease status.
 */
export function updateUrl(repo: RepoRef, version: string): string {
  return releaseDownloadUrl(repo, RELEASE_TAG, updateJsonName(version));
}

/** `update_link` written into the update manifest: the XPI on its `zt-{version}` release. */
export function xpiDownloadUrl(repo: RepoRef, version: string): string {
  return releaseDownloadUrl(repo, zoteroTag(version), xpiName(version));
}
