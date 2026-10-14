// The Layouts a Query View can draw, the Query Dataset each one shows, and
// the options of the Annotations layout as a view's keys hold them.
import * as m from "@/lib/i18n/generated/messages";

import { CARDS_LAYOUT } from "./cards-layout";
import { LIST_LAYOUT } from "./list-layout";
import type { QueryFileDataset, QueryFileView } from "./query-file";
import { TABLE_LAYOUT } from "./table-layout";

export interface QueryLayout {
  /** The view's `type`. */
  readonly type: string;
  /** The Query Datasets the layout can show. */
  readonly datasets: readonly QueryFileDataset[];
  readonly name: () => string;
  readonly icon: string;
}

/** The Layouts built so far. A Layout joins this list once it can draw. */
export const QUERY_LAYOUTS: readonly QueryLayout[] = [
  {
    type: "annotations",
    datasets: ["annotations"],
    name: () => m.query_view_layout_annotations(),
    icon: "highlighter",
  },
  TABLE_LAYOUT,
  LIST_LAYOUT,
  CARDS_LAYOUT,
];

/** The Layout that draws a view; a view with no `type` takes the Annotations layout. */
export function layoutOf(view: QueryFileView): QueryLayout | undefined {
  const type = view.type || "annotations";
  return QUERY_LAYOUTS.find((layout) => layout.type === type);
}

/** The Layouts that can show the view's dataset, as the Layout picker offers them. */
export function layoutsFor(view: Pick<QueryFileView, "from">): QueryLayout[] {
  const dataset = view.from ?? "annotations";
  return QUERY_LAYOUTS.filter((layout) => layout.datasets.includes(dataset));
}

/** The Annotations layout's options, with their defaults filled in. */
export interface AnnotationsLayoutOptions {
  /** The narrowest a card is drawn, in pixels; cards fill the row from there. */
  readonly cardWidth: number;
  readonly showComment: boolean;
  readonly showTags: boolean;
  readonly showPage: boolean;
}

export const CARD_WIDTH = { min: 200, max: 800, step: 10, default: 320 };

export const ANNOTATIONS_LAYOUT_DEFAULTS: AnnotationsLayoutOptions = {
  cardWidth: CARD_WIDTH.default,
  showComment: true,
  showTags: true,
  showPage: true,
};

/** The Annotations layout's options a view holds; a key it lacks or cannot hold takes its default. */
export function annotationsLayoutOptions(
  view: QueryFileView | null,
): AnnotationsLayoutOptions {
  const source = view?.source ?? {};
  const flag = (key: keyof AnnotationsLayoutOptions) =>
    typeof source[key] === "boolean"
      ? source[key]
      : (ANNOTATIONS_LAYOUT_DEFAULTS[key] as boolean);
  const width = source.cardWidth;
  return {
    cardWidth:
      typeof width === "number" && Number.isFinite(width)
        ? Math.min(CARD_WIDTH.max, Math.max(CARD_WIDTH.min, width))
        : CARD_WIDTH.default,
    showComment: flag("showComment"),
    showTags: flag("showTags"),
    showPage: flag("showPage"),
  };
}
