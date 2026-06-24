export const FIELD_ZOTERO_KEY = "zotero-key";
export const FIELD_CITEKEY = "citekey";
/** v1-compatible key (v1: `zotero-atchs`); kept so upgraded notes are not re-keyed. */
export const FIELD_ATTACHMENTS = "zotero-atchs";

/**
 * Frontmatter keys owned by the system; user expressions cannot target them.
 * Item identity fields are written from item data; attachment scope is managed
 * by the update flow.
 */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  FIELD_ZOTERO_KEY,
  FIELD_CITEKEY,
  FIELD_ATTACHMENTS,
]);

export const ZOTERO_DB_FILENAME = "zotero.sqlite";
export const ZOTERO_WAL_FILENAME = "zotero.sqlite-wal";
export const ZOTERO_DB_READ_TEMP_PREFIX = "zotlit-db-";
