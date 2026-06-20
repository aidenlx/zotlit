import { valid } from "semver";
import * as v from "valibot";

/**
 * Zotero WebExtension-style plugin manifest.
 *
 * Icons are referenced relative to the XPI root; the actual files must exist
 * at `addon/icons/logo.svg` for the manifest to resolve at runtime.
 */
export const ZoteroManifestSchema = v.object({
  manifest_version: v.literal(2),
  name: v.string(),
  version: v.pipe(
    v.string(),
    v.check((s) => valid(s) !== null, "must be a valid semver version"),
  ),
  description: v.optional(v.string()),
  author: v.optional(v.string()),
  homepage_url: v.optional(v.string()),
  icons: v.record(v.string(), v.string()),
  applications: v.object({
    zotero: v.object({
      id: v.string(),
      strict_min_version: v.string(),
      strict_max_version: v.optional(v.string()),
      update_url: v.string(),
    }),
  }),
});

export type ZoteroManifest = v.InferOutput<typeof ZoteroManifestSchema>;

/**
 * `version` is passed through verbatim (no `coerce()`) so prerelease
 * identifiers like `-alpha.1` survive into the manifest — Zotero's Mozilla
 * toolkit comparator orders them correctly, and stripping them would break
 * auto-update between prereleases. The schema still rejects non-semver garbage.
 *
 * @param updateUrl build-time `update_url` for `applications.zotero`, resolved
 *   from `package.json#repository` + prerelease status.
 * @see apps/obsidian/scripts/manifest.js — sibling manifest synthesizer.
 * @see release-constants.ts#updateUrl — derives the `updateUrl` argument.
 */
export function parseManifest(data: any, updateUrl: string): ZoteroManifest {
  const {
    version,
    description,
    author,
    homepage,
    zotero: { id, strict_min_version, strict_max_version } = {},
  } = data;

  return v.parse(ZoteroManifestSchema, {
    manifest_version: 2,
    name: "ZotLit",
    version,
    description,
    author,
    homepage_url: homepage,
    icons: {
      32: "icons/logo.svg",
      48: "icons/logo.svg",
      64: "icons/logo.svg",
      96: "icons/logo.svg",
    },
    applications: {
      zotero: {
        id,
        strict_min_version,
        strict_max_version,
        update_url: updateUrl,
      },
    },
  });
}
