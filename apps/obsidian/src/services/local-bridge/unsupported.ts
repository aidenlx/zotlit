// What the web Template Workbench cannot edit: the Profile documents that need
// Eta or JavaScript, and the ones this build cannot run. Every entry action
// asks before it opens a browser, and the Save boundary asks again before it
// writes, so both readings come from this one check.

import { gte } from "semver";

import { CONTRACT_VERSION } from "@zotlit/db";
import { parseLiteratureNoteTemplate } from "@zotlit/templates/facade";
import type { LiteratureNoteTemplateManifest } from "@zotlit/templates/facade";

/** Why the web Template Workbench cannot hold this Profile. */
export type UnsupportedProfileReason =
  /** The document is written against another data contract. */
  | "foreign-contract"
  /** The document itself is written in Eta. */
  | "eta-document"
  /** A Managed Frontmatter entry computes its value in JavaScript. */
  | "javascript-property"
  /** A partial the document carries or calls is written in Eta. */
  | "eta-dependency"
  /** The document asks for a plugin newer than this build. */
  | "min-app-version";

/**
 * The reason the web Workbench must not open or write this Profile, or `null`
 * when it may.
 */
export function unsupportedProfileReason(
  manifest: LiteratureNoteTemplateManifest,
  pluginVersion: string,
): UnsupportedProfileReason | null {
  if (manifest.contract !== CONTRACT_VERSION) return "foreign-contract";
  if (manifest.language !== "liquid") return "eta-document";
  if (manifest.frontmatter?.some((entry) => "js" in entry))
    return "javascript-property";
  if (manifest.partials?.some((partial) => partial.language === "eta"))
    return "eta-dependency";
  if (
    manifest.minAppVersion !== undefined &&
    !gte(pluginVersion, manifest.minAppVersion)
  )
    return "min-app-version";
  return null;
}

/**
 * The same reading over a document the entry actions hold as text. A source
 * that does not parse is not one of these reasons: the page's own Problems
 * strip names a broken document better than a Notice can.
 */
export function unsupportedProfileSourceReason(
  source: string,
  pluginVersion: string,
): UnsupportedProfileReason | null {
  let manifest;
  try {
    manifest = parseLiteratureNoteTemplate(source).manifest;
  } catch {
    return null;
  }
  return unsupportedProfileReason(manifest, pluginVersion);
}
