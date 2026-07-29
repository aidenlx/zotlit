// Response schema for GET {host}/literature-notes, the note-status query action.
import * as v from "valibot";

/**
 * An Indexed Key: an 8-char base-32 Zotero item key, optionally suffixed
 * `g<groupID>` for group-library items.
 *
 * @see `PATTERN_INDEXED_KEY` in `@zotlit/shared/indexed-key` — the canonical
 *   pattern this mirrors (this package stays dependency-free)
 */
const indexedKeyValue = v.pipe(
  v.string(),
  v.regex(/^[23456789A-NP-Z]{8}(?:g\d+)?$/u),
);

/**
 * Body of the `200` response to `GET {host}/literature-notes` — the set of
 * Indexed Keys that have at least one Literature Note in the vault; absence
 * of a key means "no note".
 *
 * @see batchUpdateRequestSchema — the symmetric `PUT /literature-notes` batch update
 * @see PROTOCOL_VERSION_HEADER
 * @see SOURCE_ID_HEADER
 */
export const noteStatusResponseSchema = v.object({
  keys: v.array(indexedKeyValue),
});

export type NoteStatusResponse = v.InferOutput<typeof noteStatusResponseSchema>;
