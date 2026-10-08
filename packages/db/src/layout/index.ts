// The layout of a Zotero database copy: the columns of each table and view,
// and the version stamps. Every reader asks this module which columns a copy
// has; the stamps are for logging only. It reads a copy once and keeps the
// answer for the life of the client. This core is synchronous; the Effect
// adapter of the Item Query readers is `src/item-query/layout.ts`.
import { version } from "@drizzle/schema";
import { getLogger } from "@logtape/logtape";
import { inArray, sql } from "drizzle-orm";

import type { NodeDatabaseClient } from "@/client/node";
import { defineQuery } from "@/queries/_shared";

const logger = getLogger(["zotlit", "db", "layout"]);

/**
 * The layout manifest of the readers: every table and column that a reader
 * statement of Item Query, and the Library reader of `getLibraries`, needs.
 * A copy without one of them is a copy the readers cannot read. The manifest
 * test fails when a reader statement reads a table or column outside it and
 * {@link OPTIONAL_LAYOUT_COLUMNS}; extend it with each new reader.
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
  libraries: ["libraryID", "type", "version"],
  groups: ["groupID", "libraryID", "name"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/**
 * The columns a reader reads only when the copy has them: Zotero added them
 * after the lowest supported layout. A reader asks {@link DatabaseLayout.has}
 * before it selects one.
 */
export const OPTIONAL_LAYOUT_COLUMNS = {
  libraries: ["clientVersion"],
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

/** The layout of one copy, as it was when the copy was first read. */
export interface DatabaseLayout {
  /** The columns of each table and view. */
  readonly columns: ReadonlyMap<string, ReadonlySet<string>>;
  /** The version stamps. They do not decide what the readers read. */
  readonly versions: LayoutVersions;
  /**
   * What the copy lacks of {@link ITEM_QUERY_LAYOUT}, in manifest order. Empty
   * when the readers can read the copy.
   */
  readonly missing: readonly LayoutGap[];
  /** Whether the copy has `column` in `table`. */
  has(table: string, column: string): boolean;
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

/** Name each gap for a person: `the table t` or `t.column`. */
export function describeLayoutGaps(missing: readonly LayoutGap[]): string {
  return missing
    .map(({ table, column }) =>
      column === null ? `the table ${table}` : `${table}.${column}`,
    )
    .join(", ");
}

// ---------------------------------------------------------------------------
// The two statements of a layout read. The Effect adapter runs the same
// builders through its own statement seam, then records the rows here.

/** @internal The columns of each table and view of the copy. */
export const selectLayoutColumns = (db: NodeDatabaseClient) =>
  db
    .select({
      table: sql<string>`m.name`,
      column: sql<string>`c.name`,
    })
    .from(
      sql`sqlite_schema as m join pragma_table_info(m.name) as c where m.type in ('table', 'view')`,
    );

/** @internal The `userdata` and `compatibility` stamps of the copy. */
export const selectLayoutVersions = (db: NodeDatabaseClient) =>
  db
    .select({ schema: version.schema, version: version.version })
    .from(version)
    .where(inArray(version.schema, ["userdata", "compatibility"]));

/** @internal A row of {@link selectLayoutColumns}. */
export interface LayoutColumnRow {
  table: string;
  column: string;
}

/** @internal A row of {@link selectLayoutVersions}. */
export interface LayoutVersionRow {
  schema: string;
  version: number;
}

const columnsQuery = defineQuery<void>()(selectLayoutColumns);
const versionsQuery = defineQuery<void>()(selectLayoutVersions);

/** The layout of each copy; a copy has one client. */
const layouts = new WeakMap<NodeDatabaseClient, DatabaseLayout>();

/** @internal The layout already read for `client`, if any. */
export function knownLayout(
  client: NodeDatabaseClient,
): DatabaseLayout | undefined {
  return layouts.get(client);
}

/** @internal The columns of the copy, by table. */
export function columnsByTable(
  rows: readonly LayoutColumnRow[],
): ReadonlyMap<string, ReadonlySet<string>> {
  return new Map(
    [...Map.groupBy(rows, (row) => row.table)].map(([table, group]) => [
      table,
      new Set(group.map((row) => row.column)),
    ]),
  );
}

/** @internal Whether the copy has a `version` table to read the stamps from. */
export function hasVersionStamps(
  columns: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const stamped = columns.get("version");
  return !!stamped?.has("schema") && !!stamped.has("version");
}

/**
 * @internal Keep the layout of `client` from the rows of its two statements
 * and log its stamps. Call it once for each copy, after
 * {@link knownLayout} gave nothing.
 */
export function recordLayout(
  client: NodeDatabaseClient,
  columns: ReadonlyMap<string, ReadonlySet<string>>,
  versionRows: readonly LayoutVersionRow[],
): DatabaseLayout {
  const stamp = (schema: string) =>
    versionRows.find((row) => row.schema === schema)?.version ?? null;
  const versions: LayoutVersions = {
    userdata: stamp("userdata"),
    compatibility: stamp("compatibility"),
  };
  const missing = findLayoutGaps(columns);
  const layout: DatabaseLayout = {
    columns,
    versions,
    missing,
    has: (table, column) => columns.get(table)?.has(column) ?? false,
  };
  layouts.set(client, layout);
  if (missing.length > 0) {
    logger.warn(
      "The readers cannot read the layout of the Zotero database (userdata {userdata}, compatibility {compatibility}). Missing: {missing}",
      { ...versions, missing: describeLayoutGaps(missing) },
    );
  } else {
    logger.debug(
      "Read the layout of the Zotero database (userdata {userdata}, compatibility {compatibility})",
      { ...versions },
    );
  }
  return layout;
}

/**
 * Read the layout of the copy behind `client`: the columns of each table and
 * view, the `userdata` and `compatibility` stamps, and the gaps against the
 * manifest. The first call on a copy runs two statements and logs the stamps;
 * every later call gives the same answer and runs none.
 */
export function readDatabaseLayout(client: NodeDatabaseClient): DatabaseLayout {
  const known = knownLayout(client);
  if (known) return known;
  const columns = columnsByTable(columnsQuery.prepared(client).all());
  const versionRows = hasVersionStamps(columns)
    ? versionsQuery.prepared(client).all()
    : [];
  return recordLayout(client, columns, versionRows);
}
