// The narrow Profile Match document writer shared by the editor and pack export.
import type { MatchTree } from "./literature-note-template";
import { updateLiteratureNoteTemplateManifestKey } from "./literature-note-template-manifest-edit";

/**
 * Preserve every byte outside the match value (or pair on removal).
 * @param match A Match tree to set, or undefined to remove the key.
 * @throws When either document is invalid, including aliases orphaned by removal.
 */
export function updateLiteratureNoteTemplateMatch(
  source: string,
  match: MatchTree | undefined,
): string {
  return updateLiteratureNoteTemplateManifestKey(source, "match", match);
}
