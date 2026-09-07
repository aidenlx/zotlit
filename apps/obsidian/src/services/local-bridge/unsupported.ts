// What the web Template Workbench cannot edit: the Profile documents that need
// Eta or JavaScript. Every entry action asks before it opens a browser, and the
// Save boundary asks again before it writes.

import { parseLiteratureNoteTemplate } from "@zotlit/templates/facade";

/** Why the web Template Workbench cannot hold this Profile. */
export type UnsupportedProfileReason =
  /** The document itself is written in Eta. */
  | "eta-document"
  /** A Managed Frontmatter entry computes its value in JavaScript. */
  | "javascript-property"
  /** A partial the document calls is written in Eta. */
  | "eta-dependency";

/**
 * The reason the web Workbench must not open this Profile, or `null` when it
 * may. A source that does not parse is not one of these reasons: the page's own
 * Problems strip names a broken document better than a Notice can.
 */
export function unsupportedProfileReason(
  source: string,
): UnsupportedProfileReason | null {
  let manifest;
  try {
    manifest = parseLiteratureNoteTemplate(source).manifest;
  } catch {
    return null;
  }
  if (manifest.language !== "liquid") return "eta-document";
  if (manifest.frontmatter?.some((entry) => "js" in entry))
    return "javascript-property";
  if (manifest.partials?.some((partial) => partial.language === "eta"))
    return "eta-dependency";
  return null;
}
