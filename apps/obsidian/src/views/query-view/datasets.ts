// What each Query Dataset gives a Query View, in one table: its engine
// descriptor, its name, the properties Sort offers, the groupings Group
// offers, and the paths of its parent records in a filter condition.
import { ANNOTATIONS, ATTACHMENTS, ITEMS } from "@zotlit/item-query";
import type { QueryDataset } from "@zotlit/item-query";

import { annotationColorLabel } from "@/lib/annotation-colors";
import * as m from "@/lib/i18n/generated/messages";
import type { QueryViewRow } from "@/services/item-query/query-view";
import { itemTypeLabel } from "@/services/profile-selection/describe";

import type { PropertyKind } from "./properties";
import type { QueryFileDataset, QueryFileGroupValue } from "./query-file";

/** A property Sort offers: its Projection Path, its label and how its values order. */
export type SortCandidate = readonly [
  path: string,
  label: () => string,
  kind: PropertyKind,
];

/** The group a row stands in, and the heading the group shows under. */
export interface Placement {
  readonly value: QueryFileGroupValue;
  readonly label: string;
}

/**
 * A grouping Group offers: its group path, its label, the Projection Paths
 * it reads, and the groups it places a row in. A row with several values of
 * a list path, such as two tags, stands in each of their groups.
 */
export interface Grouping {
  readonly path: string;
  readonly label: () => string;
  readonly fields: readonly string[];
  place(row: QueryViewRow): Placement[];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** The texts of a list; an Item's tags come as `{ name, type }`. */
function texts(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((entry: unknown) =>
          typeof entry === "object" && entry !== null && "name" in entry
            ? text(entry.name)
            : text(entry),
        )
        .filter((entry) => entry !== null)
    : [];
}

/** One group for each value, or the group of no value where there is none. */
function each(values: string[]): Placement[] {
  return values.length > 0
    ? values.map((value) => ({ value, label: value }))
    : [{ value: null, label: m.query_view_group_none() }];
}

/** A grouping by each text of the list at `field`. */
function byList(path: string, label: () => string, field: string): Grouping {
  return {
    path,
    label,
    fields: [field],
    place: (row) => each(texts(row.values[field])),
  };
}

/**
 * The Attachment's group, named by its title at `title`. A row of the
 * Attachments dataset is the Attachment itself.
 */
function attachmentPlacement(row: QueryViewRow, title: string): Placement {
  const key = row.attachmentIndexedKey ?? row.indexedKey;
  return { value: key, label: text(row.values[title]) ?? key };
}

/**
 * A grouping by the Item; an Attachment that stands alone has no Item, and
 * is its own group, named by its title at `attachmentTitle`.
 */
function byItem(attachmentTitle: string): Grouping {
  return {
    path: "item.indexedKey",
    label: m.query_view_property_item,
    fields: ["item.title", attachmentTitle],
    place: (row) =>
      row.itemIndexedKey === undefined
        ? [attachmentPlacement(row, attachmentTitle)]
        : [
            {
              value: row.itemIndexedKey,
              label: text(row.values["item.title"]) ?? row.itemIndexedKey,
            },
          ],
  };
}

const BY_ATTACHMENT: Grouping = {
  path: "attachment.indexedKey",
  label: m.query_view_property_attachment,
  fields: ["attachment.title"],
  place: (row) => [attachmentPlacement(row, "attachment.title")],
};

const BY_COLOR: Grouping = {
  path: "colorName",
  label: m.query_view_property_color,
  fields: ["color", "colorName"],
  place: (row) => {
    const hex = text(row.values.color)?.toLowerCase() ?? null;
    const value = text(row.values.colorName) ?? hex;
    if (value === null) return each([]);
    return [{ value, label: hex ? annotationColorLabel(hex) : value }];
  },
};

const BY_ITEM_TYPE: Grouping = {
  path: "itemType",
  label: m.query_view_property_item_type,
  fields: ["itemType"],
  place: (row) => {
    const itemType = text(row.values.itemType);
    return itemType === null
      ? each([])
      : [{ value: itemType, label: itemTypeLabel(itemType) }];
  },
};

const BY_TAG = byList("tags[]", m.query_view_property_tag, "tags");
const BY_ITEM_COLLECTION = byList(
  "item.collections[]",
  m.query_view_property_collection,
  "item.collections",
);

export interface DatasetSpec {
  readonly engine: QueryDataset;
  /** The dataset's name, as "Configure view" lists it. */
  readonly name: () => string;
  /** What the view says when no row matches. */
  readonly empty: () => string;
  /** The placeholder of the toolbar's Search. */
  readonly search: () => string;
  /** The properties Sort offers, in order; the engine's Sortable Fields filter them. */
  readonly sort: readonly SortCandidate[];
  /** The groupings the layouts of the dataset can gather rows by, in order. */
  readonly group: readonly Grouping[];
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
    empty: m.query_view_no_results_annotations,
    search: m.query_view_search_annotations,
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
      byItem("attachment.title"),
      BY_ATTACHMENT,
      BY_COLOR,
      BY_TAG,
      BY_ITEM_COLLECTION,
    ],
    prefix: { item: "item.", attachment: "attachment." },
  },
  attachments: {
    engine: ATTACHMENTS,
    name: m.query_view_dataset_attachments,
    empty: m.query_view_no_results_attachments,
    search: m.query_view_search_attachments,
    sort: [
      ["title", m.query_view_property_title, "text"],
      ["dateAdded", m.query_view_property_date_added, "date"],
      ["dateModified", m.query_view_property_date_modified, "date"],
      ["item.title", m.query_view_property_item_title, "text"],
      ["item.firstAuthor", m.query_view_property_first_author, "text"],
      ["item.date", m.query_view_property_item_date, "date"],
    ],
    group: [byItem("title"), BY_TAG, BY_ITEM_COLLECTION],
    prefix: { item: "item.", attachment: "" },
  },
  items: {
    engine: ITEMS,
    name: m.query_view_dataset_items,
    empty: m.query_view_no_results_items,
    search: m.query_view_search_items,
    sort: [
      ["title", m.query_view_property_title, "text"],
      ["firstAuthor", m.query_view_property_first_author, "text"],
      ["date", m.query_view_property_date, "date"],
      ["dateAdded", m.query_view_property_date_added, "date"],
      ["dateModified", m.query_view_property_date_modified, "date"],
      ["itemType", m.query_view_property_item_type, "text"],
    ],
    group: [
      BY_ITEM_TYPE,
      // An Item's tags come as `{ name, type }`; the grouping reads the names.
      BY_TAG,
      byList("collections[]", m.query_view_property_collection, "collections"),
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

/** The grouping of a view of `dataset` by `path`, where the dataset offers one. */
export function grouping(
  dataset: QueryFileDataset | undefined,
  path: string,
): Grouping | undefined {
  return datasetSpec(dataset).group.find((entry) => entry.path === path);
}
