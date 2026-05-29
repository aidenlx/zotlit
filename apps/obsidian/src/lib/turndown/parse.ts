import {
  parseAnnotationData,
  parseCitationData,
  type AnnotationInfo,
  type CitationInfo,
} from "@zotlit/db";

/**
 * DOM glue over `@zotlit/db`'s note-mark parsers: read the URL-encoded payloads
 * off Zotero note elements, and locate the schema container that gates whether
 * a note is in a format this parser understands. The JSON/URI parsing itself is
 * DOM-free and lives in `@zotlit/db` (`zt-note-mark`).
 */

/**
 * Lowest `data-schema-version` this parser supports. v6 is the first
 * Zotero-6-era schema (March 2022); the modern annotation shape
 * (`attachmentURI` + `annotationKey`) arrived in v4 and the `data-citation-items`
 * hoist in v2, so gating at v6 lets every mark parser assume the modern shapes
 * with no legacy-version branching.
 *
 * @see note-html-format-schema-report.md §5
 */
export const MIN_SCHEMA_VERSION = 6;

/**
 * Outcome of locating a note's schema container. `supported` carries the
 * conversion root — the `<div data-schema-version>` element whose `innerHTML`
 * should be converted, so neither the `zotero-note znv1` storage wrapper nor the
 * container div leaks into output. Otherwise `version` is the parsed version (or
 * `null` when no schema container exists) for the caller to log before rejecting
 * the note as legacy.
 */
export type NoteSchema =
  | { supported: true; container: Element; version: number }
  | { supported: false; version: number | null };

/**
 * Locate the note's schema container and read its `data-schema-version`.
 *
 * Depth-tolerant `querySelector` rather than `body > div`: a note read straight
 * from Zotero's SQLite keeps the `<div class="zotero-note znv1">` storage
 * wrapper, so the schema container is a grandchild of `<body>`. The same
 * selector also matches the unwrapped form returned by `item.getNote()` / the
 * API.
 *
 * @see note-html-format-schema-report.md §2
 */
export function parseNoteSchema(root: ParentNode): NoteSchema {
  const container = root.querySelector("div[data-schema-version]");
  if (!container) return { supported: false, version: null };
  const version = Number.parseInt(
    container.getAttribute("data-schema-version") ?? "",
    10,
  );
  if (!Number.isInteger(version)) return { supported: false, version: null };
  if (version < MIN_SCHEMA_VERSION) return { supported: false, version };
  return { supported: true, container, version };
}

export function parseCitation(el: Element): CitationInfo | null {
  return parseCitationData(el.getAttribute("data-citation"));
}

/** A parsed annotation mark plus the embedded-image key carried on its element. */
export interface NoteAnnotation extends AnnotationInfo {
  /**
   * Key of the embedded image Zotero rendered for an image-excerpt annotation
   * (the `data-attachment-key` attribute), distinct from {@link attachmentURI}
   * which points at the source PDF. Absent for highlight/underline marks.
   */
  imageAttachmentKey?: string;
}

export function parseAnnotation(el: Element): NoteAnnotation | null {
  const info = parseAnnotationData(el.getAttribute("data-annotation"));
  if (!info) return null;
  const imageAttachmentKey = el.getAttribute("data-attachment-key");
  return imageAttachmentKey ? { ...info, imageAttachmentKey } : info;
}
