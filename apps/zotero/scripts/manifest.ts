import { basename } from "node:path";
import { valid } from "semver";
import * as v from "valibot";

/**
 * Zotero WebExtension-style plugin manifest.
 *
 * Icons are referenced relative to the XPI root; `vite-zotero-plugin.ts`
 * stages the `zotero.icon` source there for the manifest to resolve at
 * runtime.
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

/** `zotero.icon` in package.json — the icon source, relative to the package. */
const IconSourceSchema = v.pipe(
  v.string("`zotero.icon` must be a package-relative path to the icon file"),
  v.nonEmpty(),
);

/**
 * Where the build stages the icon inside the XPI. Both the staging step and
 * the manifest's `icons` map go through this, so the declared path and the
 * packed file cannot drift apart.
 */
export function iconEntryPath(iconSource: string): string {
  return `icons/${basename(iconSource)}`;
}

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
    zotero: { id, strict_min_version, strict_max_version, icon } = {},
  } = data;

  const iconEntry = iconEntryPath(v.parse(IconSourceSchema, icon));

  return v.parse(ZoteroManifestSchema, {
    manifest_version: 2,
    name: "ZotLit",
    version,
    description,
    author,
    homepage_url: homepage,
    icons: {
      32: iconEntry,
      48: iconEntry,
      64: iconEntry,
      96: iconEntry,
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
