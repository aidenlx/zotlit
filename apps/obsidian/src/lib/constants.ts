import { Temporal } from "@zotlit/shared/temporal";

/** @see https://zotlit.aidenlx.site — the v2 documentation site. */
export const DOCS_SITE_URL = "https://zotlit.aidenlx.site";

/**
 * Host and repository ZotLit's releases are served from, as shown to the user
 * when a download is attributed to its source.
 */
export const RELEASE_ORIGIN = "github.com/aidenlx/zotlit";

/**
 * Base URL of the Resource Release serving a plugin version — the `res-<version>`
 * release carrying the Language Packs and template data JSON Schemas a build
 * downloads at runtime. The plugin's own release tag carries only `main.js`,
 * `manifest.json`, and `styles.css`.
 *
 * @see docs/adr/0019-runtime-assets-ship-on-a-parallel-resource-release.md
 */
export const resourceReleaseUrl = (pluginVersion: string): string =>
  `https://${RELEASE_ORIGIN}/releases/download/res-${pluginVersion}`;

export const FIELD_ZOTERO_KEY = "zotero-key";
export const FIELD_CITEKEY = "citekey";
/**
 * CSL ID of the Zotero-installed style one document renders its Citations and
 * references with, overriding the vault Citation and References Style. The
 * native Pandoc integration reads the same property.
 */
export const FIELD_CITATION_STYLE = "zotlit-csl";
/**
 * Document Language of one note, written as standard Pandoc metadata. It is the
 * document-wide language every Pandoc writer reads, and the explicit Citation
 * Locale citeproc renders that document's Citations and references in.
 */
export const FIELD_DOCUMENT_LANGUAGE = "lang";
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
 * Item identity fields are written from item data by the update flow.
 */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  FIELD_ZOTERO_KEY,
  FIELD_ZOTERO_NOTE_KEY,
  FIELD_ZOTERO_LASTMOD,
]);

export const ZOTERO_DB_FILENAME = "zotero.sqlite";
export const ZOTERO_WAL_FILENAME = "zotero.sqlite-wal";
export const ZOTERO_DB_READ_TEMP_PREFIX = "zotlit-db-";
/**
 * Parent folder for read snapshots placed beside the Zotero database instead of
 * in the system temp folder. Dot-prefixed so it stays out of the way, and named
 * so a user who finds it knows who wrote it.
 *
 * @see `planReadParents` in `services/database/read-parent.ts` for when it is used.
 */
export const ZOTERO_DB_READ_PARENT_DIRNAME = ".zotlit-db-reads";
