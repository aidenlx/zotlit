import { parseAnnotationPosition } from "@zotlit/db";
import type { AnnotationPosition, AnnotationPositionRaw } from "@zotlit/db";
import type { AnnotationDetails } from "@zotlit/db/item-query";

import type { ValueShape } from "./fields";

const STRING: ValueShape = { kind: "scalar", type: "string" };
const NUMBER: ValueShape = { kind: "scalar", type: "number" };
const RECT: ValueShape = {
  kind: "list",
  element: NUMBER,
};
const RECTS: ValueShape = {
  kind: "list",
  element: RECT,
};
const REFINED_BY: ValueShape = {
  kind: "object",
  keys: { start: NUMBER, end: NUMBER },
};

/** Exact Projection Path shapes for each stored position kind. */
export const ANNOTATION_POSITION_SHAPES = {
  "pdf-rects": {
    kind: "object",
    keys: {
      kind: STRING,
      pageIndex: NUMBER,
      rects: RECTS,
      nextPageRects: RECTS,
    },
  },
  "pdf-ink": {
    kind: "object",
    keys: { kind: STRING, pageIndex: NUMBER, width: NUMBER, paths: RECTS },
  },
  "pdf-text": {
    kind: "object",
    keys: {
      kind: STRING,
      pageIndex: NUMBER,
      rects: RECTS,
      fontSize: NUMBER,
      rotation: NUMBER,
    },
  },
  "epub-cfi": {
    kind: "object",
    keys: { kind: STRING, value: STRING },
  },
  "snapshot-css": {
    kind: "object",
    keys: { kind: STRING, value: STRING, refinedBy: REFINED_BY },
  },
  "snapshot-text": {
    kind: "object",
    keys: { kind: STRING, start: NUMBER, end: NUMBER },
  },
  unknown: {
    kind: "object",
    keys: { kind: STRING, raw: { kind: "json" } },
  },
} as const satisfies Readonly<Record<AnnotationPosition["kind"], ValueShape>>;

/** Every Projection Path that can occur below a position. */
export const ANNOTATION_POSITION_SHAPE: ValueShape = {
  kind: "object",
  keys: Object.fromEntries(
    Object.values(ANNOTATION_POSITION_SHAPES).flatMap((shape) =>
      Object.entries(shape.keys),
    ),
  ),
};

/** Parse at the query boundary, preserving an unreadable stored position. */
export function readAnnotationPosition(
  annotation: AnnotationDetails,
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
  annotation: AnnotationDetails,
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
