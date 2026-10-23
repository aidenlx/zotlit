import { regex } from "arkregex";
import { rcompare, valid } from "semver";

export interface FormatVersion {
  name: string;
  file: string;
  constant: string;
}

/** Persisted formats owned by ZotLit; register a new format at version 1. */
export const formatVersions: readonly FormatVersion[] = [
  {
    name: "Citation store",
    file: "apps/obsidian/src/services/citation-index/store.ts",
    constant: "SCHEMA_VERSION",
  },
  {
    name: "Excerpt store",
    file: "apps/obsidian/src/services/excerpt-image/store.ts",
    constant: "SCHEMA_VERSION",
  },
  {
    name: "Excerpt cache identity",
    file: "apps/obsidian/src/services/excerpt-image/contract.ts",
    constant: "EXCERPT_RENDERER_VERSION",
  },
  {
    name: "Settings",
    file: "apps/obsidian/src/services/settings/service.ts",
    constant: "CURRENT_VERSION",
  },
  {
    name: "Remembered write authorization",
    file: "apps/obsidian/src/services/zotero-local-api/write-authorization.ts",
    constant: "RECORD_VERSION",
  },
  {
    name: "Language Pack",
    file: "packages/obsidian-i18n/src/validation.ts",
    constant: "LANGUAGE_PACK_SCHEMA_VERSION",
  },
  {
    name: "Template data contract",
    file: "packages/db/src/contract/roots.ts",
    constant: "CONTRACT_VERSION",
  },
  {
    name: "Synthesized Template Document",
    file: "packages/templates/src/literature-note-template.ts",
    constant: "SYNTHESIZED_CONTRACT_VERSION",
  },
];

// MIN_SCHEMA_VERSION in note-marks.ts is a minimum-compatible Zotero version,
// not a format ZotLit writes. Upstream Zotero schema pins and Fixture settings
// copies likewise follow their owners. CLI, bridge and wire protocol versions
// describe exchanges rather than persisted formats. Register SCANNER_REVISION
// here when the scan pipeline introduces its persisted cache identity.

export function latestReleaseTag(tags: readonly string[]): string {
  const tag = tags.filter((tag) => valid(tag) !== null).sort(rcompare)[0];
  if (!tag)
    throw new Error(
      "No release tag found. Run git fetch origin --tags, then retry.",
    );
  return tag;
}

/** Registered constants use a top-level decimal integer literal. */
export function readFormatVersion(
  source: string,
  constant: string,
): number | null {
  const declaration = regex(
    `^(?:export\\s+)?const\\s+${RegExp.escape(constant)}(?:\\s*:\\s*number)?\\s*=\\s*([^;]+);`,
    "m",
  ).exec(source);
  if (!declaration) return null;
  const literal = declaration[1].trim();
  if (
    !regex("^[0-9]+$").test(literal) ||
    !Number.isSafeInteger(Number(literal))
  )
    throw new Error(
      `${constant}: use a decimal integer literal for a registered format version.`,
    );
  return Number(literal);
}

export function compareFormatVersion(
  entry: FormatVersion,
  head: number | null,
  released: number | null,
): string | null {
  if (head !== null && (released === null ? head === 1 : head <= released + 1))
    return null;
  return `${entry.name}: ${entry.constant} (${entry.file}): HEAD=${head ?? "absent"}, release=${released ?? "absent"}. One bump per release; a version that has not shipped stays where it is (a new format starts at 1).`;
}
