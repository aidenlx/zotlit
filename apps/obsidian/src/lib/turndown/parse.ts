/**
 * Decode the URL-encoded JSON that Zotero's note editor stores in
 * `data-citation` / `data-annotation` attributes, and resolve the Zotero
 * object URIs inside them to the identifiers `@zotlit/db` looks items and
 * annotations up by (library + key).
 *
 * Shapes mirror Zotero's annotation→note serializer: a citation holds
 * `{ citationItems: [{ uris, locator }], properties }`; an annotation holds
 * `{ attachmentURI, annotationKey, color, pageLabel, position, citationItem }`.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/editorInstance.js#L1614-L1652
 * @see https://github.com/zotero/note-editor/blob/107ab75c3247c6584bda2303ecbddf4b317fdd2d/src/core/schema/nodes.js#L369-L455
 */

/** A Zotero object URI resolved to the identifiers a DB query needs. */
export interface ZoteroRef {
  /** `"user"` for personal libraries (synced or local), `"group"` for groups. */
  libraryType: "user" | "group";
  /** Group ID when {@link libraryType} is `"group"`, else `null`. */
  groupID: number | null;
  /** The Zotero object key (last URI path segment). */
  key: string;
}

/** A single cited item parsed from a `data-citation` payload. */
export interface CitationItem {
  /** Raw Zotero object URIs identifying the cited regular item. */
  uris: string[];
  /** First {@link uris} entry resolved to a {@link ZoteroRef}, else `null`. */
  ref: ZoteroRef | null;
  /** Locator (page/section) the citation pins, when present. */
  locator?: string;
}

/** Parsed `data-citation` payload (one Zotero citation mark). */
export interface CitationInfo {
  citationItems: CitationItem[];
}

/** Parsed `data-annotation` payload (highlight / underline / image excerpt). */
export interface AnnotationInfo {
  /** The annotation item's own Zotero key. */
  annotationKey: string;
  /** URI of the attachment the annotation belongs to. */
  attachmentURI: string;
  /**
   * Attachment URI resolved to a {@link ZoteroRef}. The annotation shares the
   * attachment's library, so this also carries the library for its own lookup.
   */
  attachment: ZoteroRef | null;
  color?: string;
  pageLabel?: string;
  /**
   * Key of the embedded image Zotero rendered for an image-excerpt annotation
   * (the `data-attachment-key` attribute), distinct from {@link attachmentURI}
   * which points at the source PDF. Absent for highlight/underline marks.
   */
  imageAttachmentKey?: string;
  /** The cited regular item (attachment's parent) the excerpt points at. */
  citationItem?: CitationItem;
}

/**
 * Matches a Zotero item URI — the internal `http://zotero.org/` identifier
 * stored in note payloads (not the `https://www.zotero.org` web URL).
 *
 * @example http://zotero.org/users/local/aB3/items/KEY
 * @example http://zotero.org/users/12345/items/KEY (synced user library)
 * @example http://zotero.org/groups/9/items/KEY
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/uri.js#L39-L43
 */
const ITEM_URI = new URLPattern({
  protocol: "http",
  hostname: "zotero.org",
  pathname: "/:type(users|groups){/local}?/:libraryID/items/:key",
});

export function parseItemUri(uri: string): ZoteroRef | null {
  const groups = ITEM_URI.exec(uri)?.pathname.groups;
  const key = groups?.key;
  if (!key) return null;
  if (groups.type === "groups") {
    const groupID = Number(groups.libraryID);
    if (!Number.isInteger(groupID)) return null;
    return { libraryType: "group", groupID, key };
  }
  return { libraryType: "user", groupID: null, key };
}

/**
 * Read an element's data attribute and decode the URL-encoded JSON Zotero
 * stores there. Returns `null` when the attribute is absent or its payload
 * is not valid encoded JSON, so one malformed mark can't abort a note import.
 */
function decode(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(decodeURIComponent(value));
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toCitationItem(raw: Record<string, unknown>): CitationItem {
  const uris = Array.isArray(raw.uris)
    ? raw.uris.filter((u): u is string => typeof u === "string")
    : [];
  let ref: ZoteroRef | null = null;
  for (const uri of uris) {
    ref = parseItemUri(uri);
    if (ref) break;
  }
  return {
    uris,
    ref,
    ...(typeof raw.locator === "string" ? { locator: raw.locator } : {}),
  };
}

export function parseCitation(el: Element): CitationInfo | null {
  const data = decode(el.getAttribute("data-citation"));
  if (!isRecord(data) || !Array.isArray(data.citationItems)) return null;
  return {
    citationItems: data.citationItems.filter(isRecord).map(toCitationItem),
  };
}

export function parseAnnotation(el: Element): AnnotationInfo | null {
  const data = decode(el.getAttribute("data-annotation"));
  if (!isRecord(data)) return null;
  const { annotationKey, attachmentURI } = data;
  if (typeof annotationKey !== "string" || typeof attachmentURI !== "string") {
    return null;
  }
  const imageAttachmentKey = el.getAttribute("data-attachment-key");
  return {
    annotationKey,
    attachmentURI,
    attachment: parseItemUri(attachmentURI),
    ...(typeof data.color === "string" ? { color: data.color } : {}),
    ...(typeof data.pageLabel === "string"
      ? { pageLabel: data.pageLabel }
      : {}),
    ...(imageAttachmentKey ? { imageAttachmentKey } : {}),
    ...(isRecord(data.citationItem)
      ? { citationItem: toCitationItem(data.citationItem) }
      : {}),
  };
}
