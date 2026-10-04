import type { ScanRow } from "@zotlit/db/item-query";

import type { ProjectionValue } from "./request";

/**
 * The field registry of Item Query. Validation, execution, and the Item Query
 * Schema read the same entries, so a field exists only here.
 */
interface FieldDefinition {
  /** Reads the value from the scan row of an Item. */
  readonly read: (row: ScanRow) => ProjectionValue;
}

const FIELDS = {
  itemType: { read: (row) => row.itemType },
  dateAdded: { read: (row) => row.dateAdded },
  dateModified: { read: (row) => row.dateModified },
} satisfies Record<string, FieldDefinition>;

export type FieldName = keyof typeof FIELDS;

export const FIELD_NAMES = Object.keys(FIELDS) as FieldName[];

/** The projection of a request that names no fields. */
export const DEFAULT_FIELDS: readonly FieldName[] = [
  "itemType",
  "dateModified",
];

export function isFieldName(name: string): name is FieldName {
  return Object.hasOwn(FIELDS, name);
}

export function readField(name: FieldName, row: ScanRow): ProjectionValue {
  return FIELDS[name].read(row);
}
