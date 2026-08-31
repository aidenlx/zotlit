// The release facts the install pages publish, named by URL and by page.
//
// Client-safe: the lookups that fetch these facts live in
// `src/lib/release-data.ts`, which reaches the Worker environment. This module
// carries only what a browser bundle and the build's page lists may both read.
import { repoUrl } from "./shared";

export type ReleaseChannel = "pre-release" | "stable";

export const releasesUrl = `${repoUrl}/releases`;

/** The release's GitHub page, where its notes live. */
export function tagUrl(tag: string) {
  return `${releasesUrl}/tag/${tag}`;
}

/** A file published on a release. */
export function assetUrl(tag: string, asset: string) {
  return `${releasesUrl}/download/${tag}/${asset}`;
}

/**
 * The docs pages whose body carries release facts — the Version Ledger and
 * the direct `.xpi` link. Their loader bakes the build's snapshot into the
 * prerendered page, and the browser replaces it with the latest from
 * `/api/release-snapshot`.
 */
export const installPageSlugs = ["install-zotlit", "install-companion"];
