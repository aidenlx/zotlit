// The order `↑` and `↓` walk the Annotations of one PDF in: page, then down
// the page, then across it.
import type { AnnotationRecord } from "@/services/annotation-repository/service";

/** Where one Annotation sits, reduced to what the walk sorts on. */
interface Seat {
  key: string;
  pageIndex: number;
  /** PDF user space puts the origin at the bottom left, so the top is the largest y. */
  top: number;
  left: number;
}

/**
 * Every Annotation the reader can walk to, in reading order.
 *
 * The order is geometric — page, top edge, left edge — rather than the order
 * the list arrived in: Zotero's list route sorts by date, and its Sort Index is
 * an offset into the page's text, so neither says where a mark sits on screen.
 * An Annotation whose position this build draws nowhere is left out, because
 * `↓` can only reach a mark that exists.
 *
 * A quote spilled across a page break is seated on the page it starts on, which
 * is where its own text begins.
 *
 * @returns the Indexed Keys, in the order the keys walk them.
 * @see https://github.com/aidenlx/zotlit/issues/1148
 */
export function readingOrder(
  annotations: readonly AnnotationRecord[],
): string[] {
  return annotations
    .flatMap((annotation) => seatOf(annotation) ?? [])
    .sort(
      (a, b) => a.pageIndex - b.pageIndex || b.top - a.top || a.left - b.left,
    )
    .map(({ key }) => key);
}

/**
 * The Annotation one arrow key moves to, wrapping at both ends. With nothing
 * selected the walk enters the list at whichever end the key points from.
 *
 * @param order the Indexed Keys in reading order.
 * @param selected the Indexed Key selected now, or `null`.
 * @param step `1` for `↓` and `-1` for `↑`.
 * @returns the Indexed Key to select, or `null` while there is nothing to walk.
 */
export function stepReadingOrder(
  order: readonly string[],
  selected: string | null,
  step: 1 | -1,
): string | null {
  if (order.length === 0) return null;
  const from = selected === null ? -1 : order.indexOf(selected);
  if (from === -1) return (step === 1 ? order.at(0) : order.at(-1)) ?? null;
  return order[(from + step + order.length) % order.length] ?? null;
}

function seatOf({ key, position }: AnnotationRecord): Seat | null {
  switch (position.kind) {
    case "pdf-rects":
    case "pdf-text": {
      const rects = position.rects;
      if (rects.length === 0) return null;
      return {
        key,
        pageIndex: position.pageIndex,
        top: Math.max(...rects.map((rect) => Math.max(rect[1], rect[3]))),
        left: Math.min(...rects.map((rect) => Math.min(rect[0], rect[2]))),
      };
    }
    case "pdf-ink": {
      const points = position.paths.flatMap((path) => path);
      if (points.length < 2) return null;
      const xs = points.filter((_, index) => index % 2 === 0);
      const ys = points.filter((_, index) => index % 2 === 1);
      return {
        key,
        pageIndex: position.pageIndex,
        top: Math.max(...ys),
        left: Math.min(...xs),
      };
    }
    default:
      return null;
  }
}
