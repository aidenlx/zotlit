// A sort of an Items view by a vault property, `vault.<name>`, alone or mixed
// with Zotero fields. ZotLit Query cannot read a vault property, and it
// applies `limit` before it returns rows, so a view that sorts by one asks it
// for every match up to a cap, ordered by the view's Zotero fields, then
// sorts the rows here and keeps the view's `limit` of them, in each group of
// a grouped view, so `limit` still counts the rows the researcher sees.
//
// @see apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md
import { valueText } from "@zotlit/item-query";
import type { ProjectionJson } from "@zotlit/item-query";

import type {
  QueryViewRequest,
  QueryViewRow,
} from "@/services/item-query/query-view";
import type { LayoutRow } from "@/views/annot-view/layout";

import type { PropertyOption } from "./properties";
import { isVaultProperty, vaultName, vaultProperty } from "./query-file";
import type {
  QueryFileDataset,
  QueryFileSort,
  QueryFileView,
} from "./query-file";
import { COLLATOR, layoutRows } from "./rows";
import type { LayoutRows } from "./rows";
import type { VaultPropertyType, VaultValue } from "./table-notes";

/**
 * The most rows ZotLit Query returns to a view sorted by a vault property.
 * Past it the view sorts the first rows only, and shows that more matched.
 */
export const VAULT_SORT_CAP = 5000;

/**
 * What ZotLit Query runs for a view sorted by a vault property: every match
 * up to the cap, with the value of each Zotero field the view sorts by, which
 * the sort here compares.
 */
export function vaultSortRequest(request: QueryViewRequest): QueryViewRequest {
  const sortFields = (request.sort ?? []).map(({ field }) => field);
  return {
    ...request,
    fields: [...new Set([...(request.fields ?? []), ...sortFields])],
    limit: VAULT_SORT_CAP,
  };
}

/** A vault value as it sorts: `null` for an empty one, which sorts last. */
function sortValue(value: VaultValue): string | number | boolean | null {
  if (!value.note || value.value === null || value.value === undefined)
    return null;
  const { value: v } = value;
  if (typeof v === "number" || typeof v === "boolean") return v;
  const text = typeof v === "string" ? v : valueText(v as ProjectionJson);
  return text === "" ? null : text;
}

/** The scalar order of ZotLit Query: booleans, numbers, strings. */
function compareScalars(
  a: string | number | boolean,
  b: string | number | boolean,
): number {
  if (typeof a !== typeof b) return COLLATOR.compare(typeof a, typeof b);
  if (typeof a === "string") return COLLATOR.compare(a, b as string);
  return Number(a) - Number(b);
}

/**
 * `rows`, which come in ZotLit Query's order of the view's Zotero sort
 * fields, in the order of the view's whole `sort`. A vault property
 * compares in ZotLit Query's string order, an empty value last in both
 * directions. A Zotero field keeps ZotLit Query's own order of it, which
 * may sort by another key than the value a row shows, such as the first day
 * of a date: of two rows that tie on the sort keys before it, the one whose
 * values of the Zotero fields so far came first in ZotLit Query's rows
 * comes first. Rows that tie on every key keep ZotLit Query's order.
 */
export function sortByVault<R extends QueryViewRow>(
  rows: readonly R[],
  sort: readonly QueryFileSort[],
  read: (row: R, name: string) => VaultValue,
): R[] {
  const fields = sort.filter(({ property }) => !isVaultProperty(property));
  // The rank of each row on each Zotero field: where the run of rows that
  // share its values of that field and the fields before it begins.
  const ranks = new Map<R, number[]>();
  const firsts = fields.map(() => new Map<string, number>());
  rows.forEach((row, index) => {
    const prefix: unknown[] = [];
    ranks.set(
      row,
      fields.map(({ property }, i) => {
        prefix.push(row.values[property] ?? null);
        const key = JSON.stringify(prefix);
        if (!firsts[i]!.has(key)) firsts[i]!.set(key, index);
        return firsts[i]!.get(key)!;
      }),
    );
  });
  const keys = sort.map(({ property, direction }) => {
    const name = vaultName(property);
    if (name === null) {
      const i = fields.findIndex((field) => field.property === property);
      return (a: R, b: R) => ranks.get(a)![i]! - ranks.get(b)![i]!;
    }
    const values = new Map(
      rows.map((row) => [row, sortValue(read(row, name))]),
    );
    const sign = direction === "DESC" ? -1 : 1;
    return (a: R, b: R) => {
      const x = values.get(a)!;
      const y = values.get(b)!;
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return sign * compareScalars(x, y);
    };
  });
  const order = new Map(rows.map((row, index) => [row, index]));
  return [...rows].sort((a, b) => {
    for (const compare of keys) {
      const by = compare(a, b);
      if (by !== 0) return by;
    }
    return order.get(a)! - order.get(b)!;
  });
}

/**
 * The first `limit` rows the layout shows, in each group of a grouped view;
 * `dropped` says whether it left any out.
 */
export function limitRows<R extends Pick<LayoutRow, "group">>(
  rows: readonly R[],
  limit: number | null,
): { rows: R[]; dropped: boolean } {
  if (limit === null) return { rows: [...rows], dropped: false };
  const counts = new Map<string, number>();
  const kept = rows.filter((row) => {
    const group = row.group?.key ?? "";
    const count = counts.get(group) ?? 0;
    counts.set(group, count + 1);
    return count < limit;
  });
  return { rows: kept, dropped: kept.length < rows.length };
}

/**
 * The vault properties the Sort control offers an Items view, after the
 * Zotero fields: each name the Literature Notes give a property, ordered as
 * its type orders.
 */
export function vaultSortOptions(
  dataset: QueryFileDataset | undefined,
  names: readonly string[],
  {
    labelOf,
    typeOf,
  }: {
    labelOf: (path: string) => string;
    typeOf: (name: string) => VaultPropertyType;
  },
): PropertyOption[] {
  if (dataset !== "items") return [];
  return names.map((name) => {
    const path = vaultProperty(name);
    const type = typeOf(name);
    return {
      path,
      label: labelOf(path),
      kind: type === "number" || type === "date" ? type : "text",
    };
  });
}

/**
 * What the layout shows of a view sorted by a vault property: `rows` sorted
 * by the view's whole `sort`, gathered as the view groups them, and the
 * first `limit` of them in each group. `dropped` says whether the limit left
 * any out. A group's `count` is the rows it holds before the limit.
 */
export function vaultSortedLayout<R extends QueryViewRow>(
  rows: readonly R[],
  view: Pick<QueryFileView, "from" | "groupBy" | "groupOrder" | "limit">,
  {
    sort,
    read,
  }: {
    sort: readonly QueryFileSort[];
    read: (row: R, name: string) => VaultValue;
  },
): LayoutRows & { dropped: boolean } {
  const laid = layoutRows(sortByVault(rows, sort, read), view);
  const { rows: kept, dropped } = limitRows(laid.rows, view.limit ?? null);
  return {
    ...laid,
    rows: kept,
    count: new Set(kept.map((row) => row.annotationKey)).size,
    dropped,
  };
}
