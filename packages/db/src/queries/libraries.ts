import type { DatabaseClient } from "../client";

export type LibraryType = "user" | "group";

export interface Library {
  libraryID: number;
  type: LibraryType;
  /** `groups.groupID` when {@link type} is `"group"`, `null` for the user library. */
  groupID: number | null;
  /** `groups.name` when {@link type} is `"group"`, `null` for the user library. */
  name: string | null;
}

/**
 * Enumerate Zotero libraries with their group join. Mirrors v1's
 * `LibrariesFull` SQL but returns the raw `type` and group fields so the UI
 * can localize labels itself.
 */
export function getLibraries(db: DatabaseClient): Library[] {
  const rows = db.query.libraries
    .findMany({
      columns: { libraryID: true, type: true },
      with: {
        groups: {
          columns: { groupID: true, name: true },
        },
      },
      orderBy: { libraryID: "asc" },
    })
    .sync();
  return rows.map((row) => ({
    libraryID: row.libraryID,
    type: row.type as LibraryType,
    groupID: row.groups?.groupID ?? null,
    name: row.groups?.name ?? null,
  }));
}
