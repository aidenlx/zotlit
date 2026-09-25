// How a refused write's two values are compared.

import type { AnnotationPosition } from "@zotlit/db";

import { wireColor, writablePosition, writePosition } from "./write";
import type { ConflictedWrite, GeometryEdit } from "./write";

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
  write: Exclude<ConflictedWrite, "geometry">,
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

/**
 * Whether the geometry Zotero holds now is the one a Geometry Edit asked for,
 * compared as Zotero stores it: three decimals, so an unrounded proposal equals
 * its own saved copy. Quoted text counts only where the edit carried some.
 */
export function sameStoredGeometry(
  attempted: GeometryEdit,
  fresh: { position: AnnotationPosition; text: string | null },
): boolean {
  return (
    writePosition(attempted.position) === storedPosition(fresh.position) &&
    (attempted.text === undefined || attempted.text === fresh.text)
  );
}

/**
 * A read position as the string a write would send for it; `null` for a
 * position no Geometry Edit writes.
 */
export function storedPosition(position: AnnotationPosition): string | null {
  const writable = writablePosition(position);
  return writable === null ? null : writePosition(writable);
}
