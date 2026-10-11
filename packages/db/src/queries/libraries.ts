import { groups, libraries } from "@drizzle/schema";
import type { LibraryType } from "@drizzle/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { NodeDatabaseClient } from "@/client/node";
import type { SQLocalDatabaseClient } from "@/client/web";
import { readDatabaseLayout } from "@/layout";

import { defineQuery } from "./_shared";
import { hasClientRevisionsAsync } from "./schema-version";

export interface Library {
  libraryID: number;
  type: LibraryType;
  /** Last committed Zotero server revision recorded for this Library. */
  version: number;
  /**
   * Last committed local client revision recorded for this Library; `null`
   * when the copy has no `libraries.clientVersion` column.
   */
  clientVersion: number | null;
  /** `groups.groupID` when {@link type} is `"group"`, `null` for the user library. */
  groupID: number | null;
  /** `groups.name` when {@link type} is `"group"`, `null` for the user library. */
  name: string | null;
}

/** The columns of a Library row that a copy may lack. */
export type LibraryColumns = { clientVersion: boolean };

/**
 * The Library reader: each personal and group Library of the copy with its
 * group join, as one {@link Library} row, in `libraryID` order. It selects
 * `clientVersion` only when `columns` says the copy has it. The synchronous
 * queries here and the Item Query reader `readLibraries` build their
 * statements with it.
 */
export function selectLibraries(
  db: NodeDatabaseClient,
  columns: LibraryColumns,
  where?: SQL,
) {
  return db
    .select({
      libraryID: libraries.libraryID,
      type: libraries.type,
      version: libraries.version,
      clientVersion: columns.clientVersion
        ? sql<number | null>`${libraries.clientVersion}`
        : sql<number | null>`null`,
      groupID: groups.groupID,
      name: groups.name,
    })
    .from(libraries)
    .leftJoin(groups, eq(groups.libraryID, libraries.libraryID))
    .where(and(inArray(libraries.type, ["user", "group"]), where))
    .orderBy(asc(libraries.libraryID));
}

/** The Library columns of the copy behind `db`, from its layout. */
function libraryColumns(db: NodeDatabaseClient): LibraryColumns {
  return {
    clientVersion: readDatabaseLayout(db).has("libraries", "clientVersion"),
  };
}

const librariesQuery = defineQuery<void>()(
  (db, _operators, columns: LibraryColumns) => selectLibraries(db, columns),
);

const libraryByGroupIDQuery = defineQuery<{ groupID: number }>()(
  (db, { placeholder }, columns: LibraryColumns) =>
    selectLibraries(
      db,
      columns,
      eq(groups.groupID, placeholder("groupID")),
    ).limit(1),
);

const libraryByIDQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }, columns: LibraryColumns) =>
    selectLibraries(
      db,
      columns,
      eq(libraries.libraryID, placeholder("libraryID")),
    ).limit(1),
);

/**
 * Enumerate the personal and group Libraries with their group join. Mirrors
 * v1's `LibrariesFull` SQL but returns the raw `type` and group fields so the
 * UI can localize labels itself.
 */
export function getLibraries(db: NodeDatabaseClient): Library[] {
  return librariesQuery.prepared(db, libraryColumns(db)).all();
}

/**
 * Resolve the {@link Library} backing a Zotero group by its `groupID`, or
 * `null` when no group library matches.
 */
export function getLibraryByGroupID(
  db: NodeDatabaseClient,
  groupID: number,
): Library | null {
  return (
    libraryByGroupIDQuery
      .prepared(db, libraryColumns(db))
      .all({ groupID })[0] ?? null
  );
}

export async function getLibrariesAsync(
  db: SQLocalDatabaseClient,
): Promise<Library[]> {
  return librariesQuery
    .prepared(db, { clientVersion: await hasClientRevisionsAsync(db) })
    .all();
}

/** Resolve a library's `groupID` (null for the user library). */
export function groupIDForLibrary(
  db: NodeDatabaseClient,
  libraryID: number,
): number | null {
  return (
    libraryByIDQuery.prepared(db, libraryColumns(db)).all({ libraryID })[0]
      ?.groupID ?? null
  );
}

/** Async-client form of {@link groupIDForLibrary}. */
export async function groupIDForLibraryAsync(
  db: SQLocalDatabaseClient,
  libraryID: number,
): Promise<number | null> {
  const [row] = await libraryByIDQuery
    .prepared(db, { clientVersion: false })
    .all({ libraryID });
  return row?.groupID ?? null;
}

/** Per-call `libraryID → groupID` cache; a batch resolves each library once. */
export type GroupIDMemo = Map<number, number | null>;

/** Resolve a library's `groupID` (null for the user library), caching per call. */
export function resolveGroupID(
  db: NodeDatabaseClient,
  libraryID: number,
  memo: GroupIDMemo,
): number | null {
  const cached = memo.get(libraryID);
  if (cached !== undefined) return cached;
  const groupID = groupIDForLibrary(db, libraryID);
  memo.set(libraryID, groupID);
  return groupID;
}
