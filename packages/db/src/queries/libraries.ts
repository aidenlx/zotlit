import type { LibraryType } from "@drizzle/schema";

import type { NodeDatabaseClient } from "@/client/node";
import type { SQLocalDatabaseClient } from "@/client/web";

import { defineQuery } from "./_shared";
import type { FindManyOptions, QueryRow } from "./_shared";
import { hasClientRevisions, hasClientRevisionsAsync } from "./schema-version";

export interface Library {
  libraryID: number;
  type: LibraryType;
  /** Last committed Zotero server revision recorded for this Library. */
  version: number;
  /** Last committed local client revision recorded for this Library. */
  clientVersion: number | null;
  /** `groups.groupID` when {@link type} is `"group"`, `null` for the user library. */
  groupID: number | null;
  /** `groups.name` when {@link type} is `"group"`, `null` for the user library. */
  name: string | null;
}

const libraryColumns = {
  columns: { libraryID: true, type: true, version: true, clientVersion: true },
  with: {
    groups: {
      columns: { groupID: true, name: true },
    },
  },
} satisfies FindManyOptions<"libraries">;

const librariesQuery = defineQuery<void>()((db) =>
  db.query.libraries.findMany({
    ...libraryColumns,
    orderBy: { libraryID: "asc" },
  }),
);

const legacyLibrariesQuery = defineQuery<void>()((db) =>
  db.query.libraries.findMany({
    columns: { libraryID: true, type: true, version: true },
    with: libraryColumns.with,
    orderBy: { libraryID: "asc" },
  }),
);

const libraryByGroupIDQuery = defineQuery<{ groupID: number }>()(
  (db, { placeholder }) =>
    db.query.libraries.findMany({
      ...libraryColumns,
      where: { groups: { groupID: placeholder("groupID") } },
      limit: 1,
    }),
);

const legacyLibraryByGroupIDQuery = defineQuery<{ groupID: number }>()(
  (db, { placeholder }) =>
    db.query.libraries.findMany({
      columns: { libraryID: true, type: true, version: true },
      with: libraryColumns.with,
      where: { groups: { groupID: placeholder("groupID") } },
      limit: 1,
    }),
);

type LibraryRow =
  | QueryRow<typeof librariesQuery>
  | QueryRow<typeof legacyLibrariesQuery>;

function toLibrary(row: LibraryRow): Library {
  return {
    libraryID: row.libraryID,
    type: row.type,
    version: row.version,
    clientVersion: "clientVersion" in row ? row.clientVersion : null,
    groupID: row.groups?.groupID ?? null,
    name: row.groups?.name ?? null,
  };
}

/**
 * Enumerate Zotero libraries with their group join. Mirrors v1's
 * `LibrariesFull` SQL but returns the raw `type` and group fields so the UI
 * can localize labels itself.
 */
export function getLibraries(db: NodeDatabaseClient): Library[] {
  const rows = hasClientRevisions(db)
    ? librariesQuery.prepared(db).all()
    : legacyLibrariesQuery.prepared(db).all();
  return rows.map(toLibrary);
}

/**
 * Resolve the {@link Library} backing a Zotero group by its `groupID`, or
 * `null` when no group library matches.
 */
export function getLibraryByGroupID(
  db: NodeDatabaseClient,
  groupID: number,
): Library | null {
  const row = hasClientRevisions(db)
    ? libraryByGroupIDQuery.prepared(db).all({ groupID })[0]
    : legacyLibraryByGroupIDQuery.prepared(db).all({ groupID })[0];
  return row ? toLibrary(row) : null;
}

export async function getLibrariesAsync(
  db: SQLocalDatabaseClient,
): Promise<Library[]> {
  const rows = (await hasClientRevisionsAsync(db))
    ? await librariesQuery.prepared(db).all()
    : await legacyLibrariesQuery.prepared(db).all();
  return rows.map(toLibrary);
}
