// The rows of one query as the Annotations Layout shows them: in the query's
// order, and, for a grouped view, gathered under one heading per group.
import type { QueryViewRow } from "@/services/item-query/query-view";
import type { LayoutRow } from "@/views/annot-view/layout";

import type { QueryFileSort } from "./query-file";

/** The group paths the Annotations Layout can gather rows by. */
export const LAYOUT_GROUP_PATHS = [
  "item.indexedKey",
  "attachment.indexedKey",
] as const;

/** The Projection Paths each row carries for its group heading. */
export const LAYOUT_FIELDS = ["item.title", "attachment.title"] as const;

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function groupOf(
  row: QueryViewRow,
  property: string,
): { key: string; label: string } {
  const attachment = row.attachmentIndexedKey ?? row.indexedKey;
  const attachmentTitle = text(row.values["attachment.title"]);
  if (property === "item.indexedKey" && row.itemIndexedKey !== undefined)
    return {
      key: row.itemIndexedKey,
      label: text(row.values["item.title"]) ?? row.itemIndexedKey,
    };
  // An Attachment that stands alone has no Item: it is its own group.
  return { key: attachment, label: attachmentTitle ?? attachment };
}

/**
 * The rows in the order the view shows them. Groups follow the query order of
 * their first rows, and a descending grouping reverses them; the rows inside a
 * group keep the query's order.
 */
export function shownRows(
  rows: readonly QueryViewRow[],
  groupBy: QueryFileSort | undefined,
): QueryViewRow[] {
  if (!groupBy) return [...rows];
  const groups = new Map<string, QueryViewRow[]>();
  for (const row of rows) {
    const { key } = groupOf(row, groupBy.property);
    const members = groups.get(key) ?? [];
    members.push(row);
    groups.set(key, members);
  }
  const ordered = [...groups.values()];
  if (groupBy.direction === "DESC") ordered.reverse();
  return ordered.flat();
}

/** The rows the layout shows, in the order of {@link shownRows}. */
export function layoutRows(
  rows: readonly QueryViewRow[],
  groupBy: QueryFileSort | undefined,
): LayoutRow[] {
  return shownRows(rows, groupBy).map((row) => ({
    annotationKey: row.indexedKey,
    attachmentKey: row.attachmentIndexedKey ?? row.indexedKey,
    ...(groupBy && { group: groupOf(row, groupBy.property) }),
  }));
}
