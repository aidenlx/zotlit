import {
  parseAnnotationData,
  parseCitationData,
  parseEmbeddedCitationItems,
  parseEmbeddedCitationSnapshot,
} from "@zotlit/db";
import type { AnnotationInfo, CitationInfo } from "@zotlit/db";

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
const MIN_SCHEMA_VERSION = 6;

/**
 * Outcome of locating a note's schema container. `supported` carries the
 * conversion root — the `<div data-schema-version>` element passed to Turndown,
 * which converts only its children, so neither the `zotero-note znv1` storage
 * wrapper nor the container div itself leaks into output. Otherwise `version` is
 * the parsed version (or `null` when no schema container exists) for the caller
 * to log before rejecting the note as legacy.
 */
type NoteSchema =
  | { supported: true; container: HTMLElement; version: number }
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
  const container = root.querySelector<HTMLDivElement>(
    "div[data-schema-version]",
  );
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

/**
 * Read a note container's `data-citation-items` into a `Map<uri, citationKey>`.
 * The attribute lives on the schema container itself — the Turndown root, whose
 * own attributes no rule sees (Turndown converts only its children) — so it must
 * be read here, before conversion.
 */
export function parseEmbeddedCitations(
  container: Element,
): Map<string, string> {
  return parseEmbeddedCitationItems(
    container.getAttribute("data-citation-items"),
  );
}

/**
 * Read a note container's `data-citation-items` into a `Map<uri, itemData>` of
 * each cited item's full embedded CSL-JSON snapshot, for the note-import cite
 * leg's item-data fallback when the live DB can't resolve a ref.
 */
export function parseEmbeddedItemSnapshots(
  container: Element,
): Map<string, Record<string, unknown>> {
  return parseEmbeddedCitationSnapshot(
    container.getAttribute("data-citation-items"),
  );
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

/** A `<p>` matched as a clean single-annotation insertion, with its DB key. */
interface AnnotationParagraph {
  paragraph: HTMLElement;
  annotationKey: string;
}

/**
 * Whether an element is the leading annotation of an insertion paragraph: a
 * highlight/underline excerpt span or an image excerpt, both carrying
 * `data-annotation`.
 */
function isAnnotationLead(el: Element): boolean {
  if (!el.hasAttribute("data-annotation")) return false;
  if (el.nodeName === "IMG") return true;
  return (
    el.nodeName === "SPAN" &&
    (el.classList.contains("highlight") || el.classList.contains("underline"))
  );
}

/** Elements Zotero appends after the excerpt: a line break or the citation mark. */
function isAnnotationTrailing(el: Element): boolean {
  if (el.nodeName === "BR") return true;
  return (
    el.nodeName === "SPAN" &&
    el.classList.contains("citation") &&
    el.hasAttribute("data-citation")
  );
}

/**
 * Match a `<p>` as a clean single-annotation insertion — the shape Zotero's
 * "Add to note" emits: a leading excerpt (highlight/underline span or image)
 * followed only by an optional `<br>` and citation mark. Trailing text (the
 * comment slot) is ignored — under DB-as-source-of-truth the rendered text and
 * comment come from the DB annotation, not the snapshot. Leading non-whitespace
 * text or any other element makes the paragraph user-edited prose, so it bails.
 */
function matchAnnotationParagraph(p: Element): AnnotationParagraph | null {
  const [lead, ...trailing] = p.children;
  if (!lead || !isAnnotationLead(lead)) return null;
  if (!trailing.every(isAnnotationTrailing)) return null;
  for (const node of p.childNodes) {
    if (node === lead) break;
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      return null;
    }
  }
  const info = parseAnnotation(lead);
  if (!info) return null;
  return { paragraph: p as HTMLElement, annotationKey: info.annotationKey };
}

/**
 * Every clean single-annotation insertion `<p>`, in order — restricted to
 * direct children of `container`. "Add to note" emits annotation paragraphs as
 * top-level siblings, so a `<p>` nested in a `<li>`/`<blockquote>`/`<td>` is
 * user-restructured prose: subsuming it into a block callout would detach the
 * callout and break the surrounding structure. Left untouched, it falls through
 * to the inline excerpt/citation rules and keeps its place.
 */
export function findAnnotationParagraphs(
  container: Element,
): AnnotationParagraph[] {
  const result: AnnotationParagraph[] = [];
  for (const p of container.querySelectorAll(":scope > p")) {
    const matched = matchAnnotationParagraph(p);
    if (matched) result.push(matched);
  }
  return result;
}
