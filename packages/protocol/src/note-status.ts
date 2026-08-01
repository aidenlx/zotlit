// Response schema for GET {host}/literature-notes, the note-status query action.
import * as v from "valibot";

import { isIndexedKey } from "@zotlit/db";

/**
 * An Indexed Key: an 8-char base-32 Zotero item key, optionally suffixed
 * `g<groupID>` for group-library items.
 *
 * @see `isIndexedKey` in `@zotlit/db` — the canonical validator
 */
const indexedKeyValue = v.pipe(v.string(), v.check(isIndexedKey));

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
