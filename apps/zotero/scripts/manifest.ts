import { coerce, valid } from "semver";
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
 * Synthesize the Zotero manifest from `package.json`.
 *
 * Source of truth: top-level `version`/`description`/`author`/`homepage` plus
 * a dedicated `zotero` block holding plugin-specific fields. Mirrors the
 * pattern in `apps/obsidian/scripts/manifest.js`.
 */
export function parseManifest(data: any): ZoteroManifest {
  const {
    version,
    description,
    author,
    homepage,
    zotero: { id, strict_min_version, strict_max_version, update_url } = {},
  } = data;

  const cleanVersion = coerce(version)?.version ?? version;

  return v.parse(ZoteroManifestSchema, {
    manifest_version: 2,
    name: "ZotLit",
    version: cleanVersion,
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
        update_url,
      },
    },
  });
}
