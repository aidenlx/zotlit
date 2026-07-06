import { Temporal } from "@zotlit/shared/temporal";

export const FIELD_ZOTERO_KEY = "zotero-key";
export const FIELD_CITEKEY = "citekey";
/** v1-compatible key (v1: `zotero-atchs`); kept so upgraded notes are not re-keyed. */
export const FIELD_ATTACHMENTS = "zotero-atchs";
/**
 * Identity of an imported Zotero note. Disjoint from {@link FIELD_ZOTERO_KEY}
 * so imported notes never register as literature notes.
 */
export const FIELD_ZOTERO_NOTE_KEY = "zotero-note-key";
/**
 * Source Child Note's Zotero `dateModified`, serialized via
 * {@link stringifyInstant}. Used by batch re-import to skip unchanged notes.
 */
export const FIELD_ZOTERO_LASTMOD = "zotero-lastmod";
/**
 * Serialize a `Temporal.Instant` as an ISO 8601 string at second resolution.
 * @param options.utc Output UTC (`…Z`); otherwise local datetime with offset
 *   (e.g. `2024-01-01T18:00:00+08:00`).
 * @default { utc: false }
 */
export function stringifyInstant(
  instant: Temporal.Instant,
  options?: { utc: boolean },
): string {
  if (options?.utc) {
    return instant.toString({ smallestUnit: "second" });
  }
  return instant
    .toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toString({ smallestUnit: "second", timeZoneName: "never" });
}

/**
 * Frontmatter keys owned by the system; user expressions cannot target them.
 * Item identity fields are written from item data; attachment scope is managed
 * by the update flow.
 */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  FIELD_ZOTERO_KEY,
  FIELD_CITEKEY,
  FIELD_ATTACHMENTS,
  FIELD_ZOTERO_NOTE_KEY,
  FIELD_ZOTERO_LASTMOD,
]);

export const ZOTERO_DB_FILENAME = "zotero.sqlite";
export const ZOTERO_WAL_FILENAME = "zotero.sqlite-wal";
export const ZOTERO_DB_READ_TEMP_PREFIX = "zotlit-db-";
