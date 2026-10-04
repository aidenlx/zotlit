import { Data } from "effect";

/**
 * The layout manifest of Item Query: every table and column that a reader
 * statement reads. The layout check verifies each copy against it, so a reader
 * that reads a table or column outside it fails the manifest test. Extend it
 * with each new reader.
 */
export const ITEM_QUERY_LAYOUT = {
  items: [
    "itemID",
    "itemTypeID",
    "libraryID",
    "key",
    "dateAdded",
    "dateModified",
  ],
  itemTypesCombined: ["itemTypeID", "typeName"],
  deletedItems: ["itemID"],
  fieldsCombined: ["fieldID", "fieldName", "custom"],
  baseFieldMappingsCombined: ["itemTypeID", "fieldID", "baseFieldID"],
  itemData: ["itemID", "fieldID", "valueID"],
  itemDataValues: ["valueID", "value"],
  creators: ["creatorID", "firstName", "lastName", "fieldMode"],
  creatorTypes: ["creatorTypeID", "creatorType"],
  itemCreators: ["itemID", "creatorID", "creatorTypeID", "orderIndex"],
  tags: ["tagID", "name"],
  itemTags: ["itemID", "tagID", "type"],
  collections: [
    "collectionID",
    "collectionName",
    "parentCollectionID",
    "libraryID",
  ],
  deletedCollections: ["collectionID"],
  collectionItems: ["itemID", "collectionID"],
  itemAttachments: ["itemID", "parentItemID"],
  libraries: ["libraryID", "type"],
  groups: ["groupID", "libraryID", "name"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** A table, or one column of a table, that the copy lacks. */
export interface LayoutGap {
  readonly table: string;
  /** `null` when the whole table is missing. */
  readonly column: string | null;
}

/** The Zotero schema versions of a copy, as its `version` table stamps them. */
export interface LayoutVersions {
  /** `null` when the copy carries no `userdata` stamp. */
  readonly userdata: number | null;
  /** `null` when the copy carries no `compatibility` stamp. */
  readonly compatibility: number | null;
}

/**
 * The Zotero database lacks a table or column that Item Query reads. The
 * version stamps do not decide this; the layout of the copy does.
 */
export class ItemQueryLayoutError extends Data.TaggedError(
  "ItemQueryLayoutError",
)<{
  /** What the copy lacks, in manifest order. */
  readonly missing: readonly LayoutGap[];
  readonly versions: LayoutVersions;
}> {
  override get message(): string {
    const missing = this.missing
      .map(({ table, column }) =>
        column === null ? `the table ${table}` : `${table}.${column}`,
      )
      .join(", ");
    return `This version of ZotLit cannot read the data layout of this Zotero database. Missing: ${missing}. Update ZotLit to read it.`;
  }
}

/**
 * Compare the columns of a copy, by table, with {@link ITEM_QUERY_LAYOUT}. A
 * missing table counts once, not once for each of its columns.
 */
export function findLayoutGaps(
  columns: ReadonlyMap<string, ReadonlySet<string>>,
): LayoutGap[] {
  const gaps: LayoutGap[] = [];
  for (const [table, expected] of Object.entries(ITEM_QUERY_LAYOUT)) {
    const present = columns.get(table);
    if (!present) {
      gaps.push({ table, column: null });
      continue;
    }
    for (const column of expected) {
      if (!present.has(column)) gaps.push({ table, column });
    }
  }
  return gaps;
}
