// What each Query Dataset gives a Query View, in one table: its engine
// descriptor, its name, the properties Sort and Group offer, and the paths of
// its parent records in a filter condition.
import { ANNOTATIONS, ATTACHMENTS, ITEMS } from "@zotlit/item-query";
import type { QueryDataset } from "@zotlit/item-query";

import * as m from "@/lib/i18n/generated/messages";

import type { PropertyKind } from "./properties";
import type { QueryFileDataset } from "./query-file";

/** A property Sort offers: its Projection Path, its label and how its values order. */
export type SortCandidate = readonly [
  path: string,
  label: () => string,
  kind: PropertyKind,
];

/** A group path Group offers, and its label. */
export type GroupCandidate = readonly [path: string, label: () => string];

export interface DatasetSpec {
  readonly engine: QueryDataset;
  /** The dataset's name, as "Configure view" lists it. */
  readonly name: () => string;
  /** The properties Sort offers, in order; the engine's Sortable Fields filter them. */
  readonly sort: readonly SortCandidate[];
  /** The group paths the layouts of the dataset can gather rows by, in order. */
  readonly group: readonly GroupCandidate[];
  /**
   * What a filter condition puts before a field of the Item and of the
   * Attachment; `null` where the dataset has no Attachment.
   */
  readonly prefix: {
    readonly item: string;
    readonly attachment: string | null;
  };
}

export const DATASETS: Readonly<Record<QueryFileDataset, DatasetSpec>> = {
  annotations: {
    engine: ANNOTATIONS,
    name: m.query_view_dataset_annotations,
    sort: [
      ["sortIndex", m.query_view_property_position, "number"],
      ["pageIndex", m.query_view_property_page, "number"],
      ["dateAdded", m.query_view_property_date_added, "date"],
      ["dateModified", m.query_view_property_date_modified, "date"],
      ["color", m.query_view_property_color, "text"],
      ["type", m.query_view_property_type, "text"],
      ["item.title", m.query_view_property_item_title, "text"],
      ["item.firstAuthor", m.query_view_property_first_author, "text"],
      ["item.date", m.query_view_property_item_date, "date"],
      ["item.dateModified", m.query_view_property_item_date_modified, "date"],
      ["attachment.title", m.query_view_property_attachment_title, "text"],
      [
        "attachment.dateAdded",
        m.query_view_property_attachment_date_added,
        "date",
      ],
    ],
    group: [
      ["item.indexedKey", m.query_view_property_item],
      ["attachment.indexedKey", m.query_view_property_attachment],
      ["colorName", m.query_view_property_color],
      ["tags[]", m.query_view_property_tag],
      ["item.collections[]", m.query_view_property_collection],
    ],
    prefix: { item: "item.", attachment: "attachment." },
  },
  attachments: {
    engine: ATTACHMENTS,
    name: m.query_view_dataset_attachments,
    sort: [
      ["title", m.query_view_property_title, "text"],
      ["dateAdded", m.query_view_property_date_added, "date"],
      ["dateModified", m.query_view_property_date_modified, "date"],
      ["item.title", m.query_view_property_item_title, "text"],
      ["item.firstAuthor", m.query_view_property_first_author, "text"],
      ["item.date", m.query_view_property_item_date, "date"],
    ],
    group: [
      ["item.indexedKey", m.query_view_property_item],
      ["tags[]", m.query_view_property_tag],
      ["item.collections[]", m.query_view_property_collection],
    ],
    prefix: { item: "item.", attachment: "" },
  },
  items: {
    engine: ITEMS,
    name: m.query_view_dataset_items,
    sort: [
      ["title", m.query_view_property_title, "text"],
      ["firstAuthor", m.query_view_property_first_author, "text"],
      ["date", m.query_view_property_date, "date"],
      ["dateAdded", m.query_view_property_date_added, "date"],
      ["dateModified", m.query_view_property_date_modified, "date"],
      ["itemType", m.query_view_property_item_type, "text"],
    ],
    group: [
      ["itemType", m.query_view_property_item_type],
      ["tags[]", m.query_view_property_tag],
      ["collections[]", m.query_view_property_collection],
    ],
    prefix: { item: "", attachment: null },
  },
};

/** The spec of a view's dataset; a view that names none reads Annotations. */
export function datasetSpec(
  dataset: QueryFileDataset | undefined,
): DatasetSpec {
  return DATASETS[dataset ?? "annotations"];
}
