import type { NodeDatabaseClient } from "@/client/node";
import type { SQLocalDatabaseClient } from "@/client/web";

import { defineQuery } from "./_shared";
import type { QueryRow } from "./_shared";

/**
 * Zotero's base-field mapping, narrowed to the base fields one caller tracks.
 * {@link BaseFieldTable.resolve} answers the canonical/actual fieldName split:
 * a stored field either carries a tracked name itself, or aliases one for its
 * item type (`bookSection.bookTitle` → `publicationTitle`).
 *
 * The mapping is read from the connected database rather than from a table
 * generated off Zotero's upstream schema, so custom item types and custom
 * fields resolve like stock ones.
 */
export interface BaseFieldTable<TName extends string> {
  /** fieldIDs to fetch — union of canonical ids and per-itemType alias ids. */
  readonly fieldIDs: readonly number[];
  /** Canonical name for a stored field, or `null` when it is not tracked. */
  resolve(itemTypeID: number, fieldID: number | null): TName | null;
}

/**
 * RQB v2 can't express the resolution as an inline join, because
 * `baseFieldMappingsCombined` must match on the parent `items.itemTypeID` plus
 * the child `itemData.fieldID`, and v2 `where` clauses can't reference the
 * parent. Both halves are read once and combined in memory instead.
 */
const canonicalFieldsQuery = defineQuery<void>()(
  (db, _operators, args: { names: readonly string[] }) =>
    db.query.fieldsCombined.findMany({
      where: { fieldName: { in: [...args.names] } },
      columns: { fieldID: true, fieldName: true },
    }),
);

const aliasFieldsQuery = defineQuery<void>()(
  (db, _operators, args: { names: readonly string[] }) =>
    db.query.baseFieldMappingsCombined.findMany({
      where: { baseField: { fieldName: { in: [...args.names] } } },
      columns: { itemTypeID: true, fieldID: true },
      with: { baseField: { columns: { fieldName: true } } },
    }),
);

type CanonicalFieldRow = QueryRow<typeof canonicalFieldsQuery>;
type AliasFieldRow = QueryRow<typeof aliasFieldsQuery>;

/** Per client, per tracked-name set — the mapping is fixed for a database. */
const tablesByClient = new WeakMap<
  object,
  Map<string, BaseFieldTable<string>>
>();

/**
 * The {@link BaseFieldTable} for `names`, built on first use and memoized for
 * the client. Every consumer of Zotero's base-field mapping goes through here,
 * so the search index and the Item query cannot drift apart.
 */
export function getBaseFieldTable<TName extends string>(
  db: NodeDatabaseClient,
  names: readonly TName[],
): BaseFieldTable<TName> {
  const cached = readCache<TName>(db, names);
  if (cached) return cached;
  const args = { names: [...names] };
  return writeCache(
    db,
    names,
    buildTable(
      canonicalFieldsQuery.prepared(db, args).all(),
      aliasFieldsQuery.prepared(db, args).all(),
      names,
    ),
  );
}

export async function getBaseFieldTableAsync<TName extends string>(
  db: SQLocalDatabaseClient,
  names: readonly TName[],
): Promise<BaseFieldTable<TName>> {
  const cached = readCache<TName>(db, names);
  if (cached) return cached;
  const args = { names: [...names] };
  const [canonicalRows, aliasRows] = await Promise.all([
    canonicalFieldsQuery.prepared(db, args).all(),
    aliasFieldsQuery.prepared(db, args).all(),
  ]);
  return writeCache(db, names, buildTable(canonicalRows, aliasRows, names));
}

function cacheKey(names: readonly string[]): string {
  return [...names].sort().join(" ");
}

function readCache<TName extends string>(
  db: object,
  names: readonly TName[],
): BaseFieldTable<TName> | null {
  return (tablesByClient.get(db)?.get(cacheKey(names)) ??
    null) as BaseFieldTable<TName> | null;
}

function writeCache<TName extends string>(
  db: object,
  names: readonly TName[],
  table: BaseFieldTable<TName>,
): BaseFieldTable<TName> {
  let perDb = tablesByClient.get(db);
  if (!perDb) {
    perDb = new Map();
    tablesByClient.set(db, perDb);
  }
  perDb.set(cacheKey(names), table);
  return table;
}

function buildTable<TName extends string>(
  canonicalRows: readonly CanonicalFieldRow[],
  aliasRows: readonly AliasFieldRow[],
  names: readonly TName[],
): BaseFieldTable<TName> {
  const tracked = new Set<string>(names);
  const isTracked = (value: string | undefined | null): value is TName =>
    value != null && tracked.has(value);

  /** Direct match: a field whose own name is one of `names`. */
  const canonicalByFieldID = new Map<number, TName>();
  for (const row of canonicalRows) {
    if (isTracked(row.fieldName)) {
      canonicalByFieldID.set(row.fieldID, row.fieldName);
    }
  }

  /** Per-itemType alias: `${itemTypeID}:${fieldID}` → canonical name. */
  const aliasByTypeAndField = new Map<string, TName>();
  const fieldIDs = new Set<number>(canonicalByFieldID.keys());
  for (const row of aliasRows) {
    if (row.fieldID == null) continue;
    fieldIDs.add(row.fieldID);
    if (row.itemTypeID == null) continue;
    const canonical = row.baseField?.fieldName;
    if (!isTracked(canonical)) continue;
    aliasByTypeAndField.set(`${row.itemTypeID}:${row.fieldID}`, canonical);
  }

  return {
    fieldIDs: [...fieldIDs],
    resolve(itemTypeID, fieldID) {
      if (fieldID == null) return null;
      return (
        aliasByTypeAndField.get(`${itemTypeID}:${fieldID}`) ??
        canonicalByFieldID.get(fieldID) ??
        null
      );
    },
  };
}
