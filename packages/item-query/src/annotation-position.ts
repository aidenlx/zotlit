import { parseAnnotationPosition } from "@zotlit/db";
import type { AnnotationPosition, AnnotationPositionRaw } from "@zotlit/db";
import type { HydratedAnnotation } from "@zotlit/db/item-query";

/** Parse at the query boundary, preserving an unreadable stored position. */
export function readAnnotationPosition(
  annotation: HydratedAnnotation,
): AnnotationPosition {
  let raw: unknown;
  try {
    raw = JSON.parse(annotation.position);
  } catch {
    return { kind: "unknown", raw: annotation.position };
  }
  // The database's parser validates the unknown JSON against the document
  // kind before it returns a typed position.
  return parseAnnotationPosition(
    raw as AnnotationPositionRaw,
    annotation.attachment.contentType ?? "",
  );
}

export function annotationPageIndex(
  annotation: HydratedAnnotation,
): number | null {
  const position = readAnnotationPosition(annotation);
  switch (position.kind) {
    case "pdf-rects":
    case "pdf-ink":
    case "pdf-text":
      return position.pageIndex;
    default:
      return null;
  }
}
