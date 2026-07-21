// Docs-site URLs surfaced by the release check.

import { DOCS_SITE_URL } from "@/lib/constants";

/**
 * The Release Note: the per-version changelog page for `version`. The slug is
 * the raw semver, matching the docs `/changelog/[version]` route.
 */
export function releaseNoteUrl(version: string): string {
  return `${DOCS_SITE_URL}/changelog/${version}`;
}

/** v1's hardcoded default eject folder. A templates-only upgrader leaves `zt-*.eta.md` files here with no settings file; the upgrade both probes and reconstructs `template.folder` to it. */
export const V1_TEMPLATE_FOLDER = "ZtTemplates";
