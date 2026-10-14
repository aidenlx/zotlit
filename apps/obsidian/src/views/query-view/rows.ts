// The rows of one query as the Annotations Layout shows them: in the query's
// order, and, for a grouped view, gathered under one heading per group. A row
// with several values of a list path, such as two tags, stands in each of
// their groups.
import { annotationColorLabel } from "@/lib/annotation-colors";
import * as m from "@/lib/i18n/generated/messages";
import type { QueryViewRow } from "@/services/item-query/query-view";
import type { LayoutRow } from "@/views/annot-view/layout";

import type { QueryFileGroupValue, QueryFileSort } from "./query-file";

/** The group paths the Annotations Layout can gather rows by. */
export const LAYOUT_GROUP_PATHS = [
  "item.indexedKey",
  "attachment.indexedKey",
  "colorName",
  "tags[]",
  "item.collections[]",
] as const;
export type LayoutGroupPath = (typeof LAYOUT_GROUP_PATHS)[number];

/** The Projection Paths each row carries for its group and its heading. */
export const LAYOUT_FIELDS = [
  "item.title",
  "attachment.title",
  "color",
  "colorName",
  "tags",
  "item.collections",
] as const;

/** One group of the rows, as the Manual group order lists it. */
export interface LayoutGroup {
  /** The value the file's `groupOrder` names the group by. */
  value: QueryFileGroupValue;
  label: string;
  /** The rows in the group. */
  count: number;
  /** Whether the group shows; a Manual group order hides what it does not list. */
  shown: boolean;
}

/** What the layout shows of one query's rows. */
export interface LayoutRows {
  rows: LayoutRow[];
  /** Every group the rows hold, the shown ones first; empty when ungrouped. */
  groups: LayoutGroup[];
  /** The rows shown, each once however many groups it stands in. */
  count: number;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function texts(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => text(entry) !== null)
    : [];
}

interface Placement {
  value: QueryFileGroupValue;
  label: string;
}

function placements(row: QueryViewRow, property: string): Placement[] {
  const attachment = row.attachmentIndexedKey ?? row.indexedKey;
  const attachmentGroup = {
    value: attachment,
    label: text(row.values["attachment.title"]) ?? attachment,
  };
  const none = (values: string[]): Placement[] =>
    values.length > 0
      ? values.map((value) => ({ value, label: value }))
      : [{ value: null, label: m.query_view_group_none() }];
  switch (property) {
    case "item.indexedKey":
      // An Attachment that stands alone has no Item: it is its own group.
      return row.itemIndexedKey === undefined
        ? [attachmentGroup]
        : [
            {
              value: row.itemIndexedKey,
              label: text(row.values["item.title"]) ?? row.itemIndexedKey,
            },
          ];
    case "attachment.indexedKey":
      return [attachmentGroup];
    case "colorName": {
      const hex = text(row.values.color)?.toLowerCase() ?? null;
      const value = text(row.values.colorName) ?? hex;
      if (value === null) return none([]);
      return [{ value, label: hex ? annotationColorLabel(hex) : value }];
    }
    case "tags[]":
      return none(texts(row.values.tags));
    case "item.collections[]":
      return none(texts(row.values["item.collections"]));
    default:
      return [];
  }
}

/**
 * The rows the layout shows. Groups follow the query order of their first
 * rows, and a descending grouping reverses them; a Manual group order shows
 * the groups it lists, in its order, and hides the rest. The group of no
 * value stands last. The rows inside a group keep the query's order.
 */
export function layoutRows(
  rows: readonly QueryViewRow[],
  groupBy: QueryFileSort | undefined,
  groupOrder?: readonly QueryFileGroupValue[],
): LayoutRows {
  const base = (row: QueryViewRow): LayoutRow => ({
    annotationKey: row.indexedKey,
    attachmentKey: row.attachmentIndexedKey ?? row.indexedKey,
  });
  if (!groupBy) return { rows: rows.map(base), groups: [], count: rows.length };
  const groups = new Map<
    QueryFileGroupValue,
    { label: string; rows: LayoutRow[] }
  >();
  for (const row of rows)
    for (const { value, label } of placements(row, groupBy.property)) {
      const group = groups.get(value) ?? { label, rows: [] };
      group.rows.push({
        ...base(row),
        group: { key: value ?? "", label },
      });
      groups.set(value, group);
    }
  let order: QueryFileGroupValue[] = [...groups.keys()].filter(
    (value) => value !== null,
  );
  if (groupBy.direction === "DESC") order.reverse();
  if (groups.has(null)) order.push(null);
  let hidden: QueryFileGroupValue[] = [];
  if (groupOrder) {
    hidden = order.filter((value) => !groupOrder.includes(value));
    order = groupOrder.filter((value) => groups.has(value));
  }
  const shownRows = order.flatMap((value) => groups.get(value)!.rows);
  const summary = (value: QueryFileGroupValue, shown: boolean) => ({
    value,
    label: groups.get(value)!.label,
    count: groups.get(value)!.rows.length,
    shown,
  });
  return {
    rows: shownRows,
    groups: [
      ...order.map((value) => summary(value, true)),
      ...hidden.map((value) => summary(value, false)),
    ],
    count: new Set(shownRows.map((row) => row.annotationKey)).size,
  };
}
