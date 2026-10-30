import type { AnnotationRecord } from "@/services/annotation-repository/service";

export interface ExcerptViewport {
  convertToViewportPoint(x: number, y: number): [number, number];
}

export function clipExcerptBounds(
  rect: number[],
  pageView: number[],
): number[] {
  const crop = [
    Math.max(rect[0]!, pageView[0]!),
    Math.max(rect[1]!, pageView[1]!),
    Math.min(rect[2]!, pageView[2]!),
    Math.min(rect[3]!, pageView[3]!),
  ];
  if (crop[2]! <= crop[0]! || crop[3]! <= crop[1]!)
    throw new Error("Excerpt outside PDF page");
  return crop;
}

/** Zotero's padded small-ink crop includes round-cap spill in PDF units. */
export function excerptBounds(annotation: AnnotationRecord): number[] {
  const position = annotation.position;
  if (annotation.type === "image" && position.kind === "pdf-rects") {
    const rect = position.rects[0];
    if (rect?.every(Number.isFinite) && rect[2] > rect[0] && rect[3] > rect[1])
      return rect;
  }
  if (annotation.type === "ink" && position.kind === "pdf-ink") {
    if (!Number.isFinite(position.width) || position.width <= 0)
      throw new Error("Invalid ink width");
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (const path of position.paths) {
      if (path.length % 2 || !path.every(Number.isFinite))
        throw new Error("Invalid ink path");
      for (let i = 0; i < path.length; i += 2) {
        bounds[0] = Math.min(bounds[0]!, path[i]!);
        bounds[1] = Math.min(bounds[1]!, path[i + 1]!);
        bounds[2] = Math.max(bounds[2]!, path[i]!);
        bounds[3] = Math.max(bounds[3]!, path[i + 1]!);
      }
    }
    if (!bounds.every(Number.isFinite)) throw new Error("Empty ink paths");
    const padding = 10 + position.width / 2;
    for (const axis of [0, 1]) {
      bounds[axis]! -= padding;
      bounds[axis + 2]! += padding;
      if (bounds[axis + 2]! - bounds[axis]! < 30) {
        const center = (bounds[axis]! + bounds[axis + 2]!) / 2;
        bounds[axis] = center - 30;
        bounds[axis + 2] = center + 30;
      }
    }
    return bounds;
  }
  throw new Error("Unsupported excerpt bounds");
}

/** Apply the same rotated, crop-box-aware viewport to the crop and strokes. */
export function viewportBounds(
  crop: number[],
  viewport: ExcerptViewport,
): number[] {
  const a = viewport.convertToViewportPoint(crop[0]!, crop[1]!);
  const b = viewport.convertToViewportPoint(crop[2]!, crop[3]!);
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.abs(b[0] - a[0]),
    Math.abs(b[1] - a[1]),
  ];
}

/** Paint stored paths after the PDF background; isolated points are round marks. */
export function paintInk(options: {
  annotation: AnnotationRecord;
  viewport: ExcerptViewport;
  context: CanvasRenderingContext2D;
}): void {
  const { annotation, viewport, context } = options;
  const position = annotation.position;
  if (annotation.type !== "ink" || position.kind !== "pdf-ink") return;
  if (!annotation.color) throw new Error("Ink color unavailable");
  const origin = viewport.convertToViewportPoint(0, 0);
  const unit = viewport.convertToViewportPoint(position.width, 0);
  const width = Math.hypot(unit[0] - origin[0], unit[1] - origin[1]);
  context.strokeStyle = context.fillStyle = annotation.color;
  context.lineWidth = width;
  context.lineCap = context.lineJoin = "round";
  for (const path of position.paths) {
    if (!path.length) continue;
    const first = viewport.convertToViewportPoint(path[0]!, path[1]!);
    context.beginPath();
    context.moveTo(...first);
    let distinct = false;
    for (let i = 2; i < path.length; i += 2) {
      const point = viewport.convertToViewportPoint(path[i]!, path[i + 1]!);
      distinct ||= point[0] !== first[0] || point[1] !== first[1];
      context.lineTo(...point);
    }
    if (distinct) context.stroke();
    else {
      context.beginPath();
      context.arc(...first, width / 2, 0, 2 * Math.PI);
      context.fill();
    }
  }
}
