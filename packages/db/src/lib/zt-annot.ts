import { type AnnotationPositionRaw } from "@drizzle/schema";
import { getLogger } from "@logtape/logtape";

import { type Temporal } from "@zotlit/shared/temporal";

const logger = getLogger(["zotlit", "db", "annotations"]);

/**
 * Maps Zotero's numeric annotation type IDs to string names.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/annotations.js#L31-L36
 */
const ANNOT_TYPE = {
  1: "highlight",
  2: "note",
  3: "image",
  4: "ink",
  5: "underline",
  6: "text",
} as const;

export type AnnotationType = keyof typeof ANNOT_TYPE;
export type AnnotationTypeName = (typeof ANNOT_TYPE)[AnnotationType];
/**
 * {@link annotationTypeToName}'s output: a known {@link AnnotationTypeName}, or
 * `"unknown"` for a type id Zotero added after this mapping was written.
 */
export type ResolvedAnnotationTypeName = AnnotationTypeName | "unknown";

export interface Annotation {
  groupID: number | null;
  itemID: number;
  key: string;
  /** {@link key} for the personal library, `KEYgGROUPID` for a group library. */
  indexedKey: string;
  libraryID: number;
  dateAdded: Temporal.Instant;
  dateModified: Temporal.Instant;
  /** Raw `itemAnnotations.type` int; resolve names via {@link annotationTypeToName}. */
  type: AnnotationType;
  /**
   * The highlighted or underlined excerpt. Not plain text: Zotero's reader edits
   * it through a rich-text editor whose `supportedFormats` allowlist is
   * `['i','b','sub','sup']`, so the string can carry those attribute-free inline
   * tags. Render it as HTML (sanitized) rather than as a literal string.
   *
   * @see https://github.com/zotero/zotero/blob/9.0.3/reader/src/common/components/common/editor.js#L4
   */
  text: string | null;
  comment: string | null;
  /** Hex color code, e.g. `"#ffd400"`. */
  color: string | null;
  pageLabel: string | null;
  /**
   * Raw Zotero sort key. Its zero-padded formats sort correctly as text.
   *
   * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/data/item.js#L4257-L4277
   */
  sortIndex: string;
  position: AnnotationPositionRaw;
  authorName: string | null;
  isExternal: boolean;
  parentItemID: number;
  parentKey: string;
}

export function annotationTypeToName(
  type: AnnotationType,
): ResolvedAnnotationTypeName {
  const name = ANNOT_TYPE[type];
  if (name) return name;

  logger.warn("Unknown annotation type {type}", { type });
  return "unknown";
}

/**
 * Whether Zotero renders a cached excerpt image for this annotation type.
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/annotations.js#L62
 */
export function annotationHasCacheImage(_type: AnnotationType): boolean {
  const type = ANNOT_TYPE[_type];
  return type === "image" || type === "ink";
}
