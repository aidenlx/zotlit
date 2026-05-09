// @ts-check

import * as v from "valibot";

/**
 * Obsidian plugin manifest
 * @see https://docs.obsidian.md/Reference/Manifest
 */
export const PluginManifestSchema = v.object({
  id: v.string(),
  name: v.string(),
  version: v.string(),
  minAppVersion: v.string(),
  description: v.string(),
  author: v.string(),
  authorUrl: v.optional(v.string()),
  fundingUrl: v.optional(
    v.union([v.string(), v.record(v.string(), v.string())]),
  ),
  isDesktopOnly: v.boolean(),
});

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
