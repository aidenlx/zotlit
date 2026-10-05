// The reader that lists the Libraries of the source: the ones an Item Query
// can read. It reads the
// columns of the layout manifest only, so it runs on every copy that passes
// the layout check, whatever its version stamps are.
import { groups, libraries } from "@drizzle/schema";
import { asc, eq } from "drizzle-orm";
import { Effect } from "effect";

import { defineStatement } from "./database";
import type { ItemQueryDatabase, ItemQueryReaderError } from "./database";

/** A Library of the copy. `libraryID` is local to the copy. */
export interface SourceLibrary {
  readonly libraryID: number;
  readonly type: "user" | "group";
  /** `null` for the personal Library. */
  readonly groupID: number | null;
  /** The name of a group Library; `null` for the personal Library. */
  readonly name: string | null;
}

const personalLibraryStatement = defineStatement<Record<string, never>>(
  "source-libraries",
)((db) =>
  db
    .select({ libraryID: libraries.libraryID })
    .from(libraries)
    .where(eq(libraries.type, "user"))
    .orderBy(asc(libraries.libraryID))
    .limit(1),
);

const groupLibrariesStatement = defineStatement<Record<string, never>>(
  "source-libraries",
)((db) =>
  db
    .select({
      libraryID: groups.libraryID,
      groupID: groups.groupID,
      name: groups.name,
    })
    .from(groups)
    .orderBy(asc(groups.groupID)),
);

/**
 * Read the personal Library and every group Library of the copy, in the
 * canonical order: the personal Library first, then the groups by ascending
 * group ID.
 */
export function readSourceLibraries(): Effect.Effect<
  SourceLibrary[],
  ItemQueryReaderError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const [personal] = yield* personalLibraryStatement.all({});
    const groupRows = yield* groupLibrariesStatement.all({});
    return [
      ...(personal
        ? [{ ...personal, type: "user" as const, groupID: null, name: null }]
        : []),
      ...groupRows.map((group) => ({ ...group, type: "group" as const })),
    ];
  });
}
