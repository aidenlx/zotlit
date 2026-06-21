// @ts-check

import { valid } from "semver";
import * as v from "valibot";

const semverSchema = v.pipe(
  v.string(),
  v.check((s) => valid(s) !== null, "must be a valid semver version"),
);

/**
 * Obsidian plugin manifest
 * @see https://docs.obsidian.md/Reference/Manifest
 */
export const PluginManifestSchema = v.object({
  id: v.string(),
  name: v.string(),
  version: semverSchema,
  minAppVersion: semverSchema,
  description: v.string(),
  author: v.string(),
  authorUrl: v.optional(v.string()),
  fundingUrl: v.optional(
    v.union([v.string(), v.record(v.string(), v.string())]),
  ),
  isDesktopOnly: v.boolean(),
});

/**
 * Minimum Electron version ZotLit's runtime requires. Lives under the
 * `obsidian` block in package.json; not part of the Obsidian manifest, so it is
 * validated separately and injected at build time rather than emitted to
 * manifest.json.
 *
 * @param {any} data
 * @returns {string}
 */
export function parseMinElectronVersion(data) {
  return v.parse(semverSchema, data?.obsidian?.minElectronVersion);
}

/**
 * @param {any} data
 */
export function parseManifest(data) {
  const {
    obsidian: { id, name, minAppVersion, fundingUrl, isDesktopOnly } = {},
    version,
    description,
    author,
    authorUrl,
  } = data;

  return v.parse(PluginManifestSchema, {
    id,
    name,
    version,
    minAppVersion: process.env.MIN_APP_VERSION ?? minAppVersion,
    description,
    author,
    authorUrl,
    fundingUrl,
    isDesktopOnly,
  });
}
