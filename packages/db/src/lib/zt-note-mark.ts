import * as v from "valibot";

/**
 * Parse Zotero note-editor citation / annotation mark payloads — the
 * URL-encoded JSON a note stores in its `data-citation` / `data-annotation`
 * attributes — into the identifiers a DB query looks items and annotations up
 * by (library + key). DOM-free: the caller pulls the encoded string off the
 * element and passes it here.
 *
 * Shapes mirror Zotero's annotation→note serializer: a citation holds
 * `{ citationItems: [{ uris, locator }], properties }`; an annotation holds
 * `{ attachmentURI, annotationKey, color, pageLabel, position, citationItem }`.
 * Keys the parser does not consume (`properties`, `position`) are dropped by the
 * `v.object` schemas rather than declared.
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

const CitationItemSchema = v.object({
  uris: v.array(v.string()),
  locator: v.optional(v.string()),
});

const CitationSchema = v.object({
  citationItems: v.array(CitationItemSchema),
});

const AnnotationSchema = v.object({
  attachmentURI: v.string(),
  annotationKey: v.string(),
  color: v.optional(v.string()),
  pageLabel: v.optional(v.string()),
  citationItem: v.optional(CitationItemSchema),
});

/**
 * Decode the URL-encoded JSON Zotero stores in a mark's data attribute and
 * validate it against `schema`. Returns `null` when the value is absent, not
 * valid encoded JSON, or fails validation, so one malformed mark can't abort a
 * note import.
 */
function parseDataAttribute<TSchema extends v.GenericSchema>(
  schema: TSchema,
  encoded: string | null,
): v.InferOutput<TSchema> | null {
  if (encoded === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(decodeURIComponent(encoded));
  } catch {
    return null;
  }
  const result = v.safeParse(schema, json);
  return result.success ? result.output : null;
}

function toCitationItem(
  raw: v.InferOutput<typeof CitationItemSchema>,
): CitationItem {
  let ref: ZoteroRef | null = null;
  for (const uri of raw.uris) {
    ref = parseItemUri(uri);
    if (ref) break;
  }
  return {
    uris: raw.uris,
    ref,
    ...(raw.locator !== undefined ? { locator: raw.locator } : {}),
  };
}

/** Parse a `data-citation` payload, or `null` when absent or malformed. */
export function parseCitationData(encoded: string | null): CitationInfo | null {
  const data = parseDataAttribute(CitationSchema, encoded);
  if (!data) return null;
  return { citationItems: data.citationItems.map(toCitationItem) };
}

/**
 * One entry of a note container's `data-citation-items`: a cited item's
 * identifying {@link uris} plus its CSL-JSON {@link itemData}. Only the Better
 * BibTeX `citation-key` is read here; the rest of `itemData` is dropped until
 * `9.2-CSL` widens this schema to carry full CSL data.
 */
const EmbeddedCitationItemSchema = v.object({
  uris: v.array(v.string()),
  itemData: v.optional(v.object({ "citation-key": v.optional(v.string()) })),
});

/**
 * Decode a note container's `data-citation-items` attribute into a
 * `Map<uri, citationKey>`. Zotero hoists each cited item's CSL-JSON onto the
 * container; every URI of an entry maps to that entry's citation key, so a
 * citation mark resolves by any of its `uris`. This is the snapshot citekey
 * source for cites the live DB can't resolve (e.g. cross-library). Returns an
 * empty map when the attribute is absent or malformed, so one bad payload can't
 * abort a note import.
 */
export function parseEmbeddedCitationItems(
  encoded: string | null,
): Map<string, string> {
  const map = new Map<string, string>();
  const data = parseDataAttribute(v.array(EmbeddedCitationItemSchema), encoded);
  if (!data) return map;
  for (const entry of data) {
    const citationKey = entry.itemData?.["citation-key"];
    if (!citationKey) continue;
    for (const uri of entry.uris) {
      if (!map.has(uri)) map.set(uri, citationKey);
    }
  }
  return map;
}

/** Parse a `data-annotation` payload, or `null` when absent or malformed. */
export function parseAnnotationData(
  encoded: string | null,
): AnnotationInfo | null {
  const data = parseDataAttribute(AnnotationSchema, encoded);
  if (!data) return null;
  return {
    annotationKey: data.annotationKey,
    attachmentURI: data.attachmentURI,
    attachment: parseItemUri(data.attachmentURI),
    ...(data.color !== undefined ? { color: data.color } : {}),
    ...(data.pageLabel !== undefined ? { pageLabel: data.pageLabel } : {}),
    ...(data.citationItem
      ? { citationItem: toCitationItem(data.citationItem) }
      : {}),
  };
}
