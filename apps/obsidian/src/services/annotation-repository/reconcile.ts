// How a refused write's two values are compared.

import { wireColor } from "./write";
import type { ConflictedWrite } from "./write";

/**
 * Whether the value Zotero holds now is the one the write asked for, in which
 * case the conflict is no conflict: the user's edit is already what stands, so
 * it resolves silently rather than asking them to choose between two equal
 * values.
 *
 * A delete never resolves this way. It names no value, so there is nothing for
 * a fresh read to equal, and the user is asked "Delete anyway" against the copy
 * Zotero holds now.
 */
export function resolvesSilently(
  write: ConflictedWrite,
  attempted: string | null,
  fresh: string | null,
): boolean {
  if (write === "delete") return false;
  if (write === "color") {
    return (
      attempted !== null &&
      fresh !== null &&
      wireColor(attempted) === wireColor(fresh)
    );
  }
  // Zotero stores a cleared comment as no comment, so the empty string the
  // editor sends and the absent value Zotero answers are the same value.
  return (attempted ?? "") === (fresh ?? "");
}
