// The reader that lists the Libraries an Item Query can read. It reads the
// columns of the layout manifest only, so it runs on every copy that passes
// the layout check, whatever its version stamps are.
import { groups, libraries } from "@drizzle/schema";
import { asc, eq } from "drizzle-orm";
import { Effect } from "effect";

import { defineStatement } from "./database";
import type { ItemQueryDatabase, ItemQueryReaderError } from "./database";

/** A Library of the copy. `libraryID` is local to the copy. */
export interface TargetLibraryRow {
  readonly libraryID: number;
  /** `null` for the personal Library. */
  readonly groupID: number | null;
  /** The name of a group Library; `null` for the personal Library. */
  readonly name: string | null;
}

const personalLibraryStatement = defineStatement<Record<string, never>>(
  "target-library",
)((db) =>
  db
    .select({ libraryID: libraries.libraryID })
    .from(libraries)
    .where(eq(libraries.type, "user"))
    .orderBy(asc(libraries.libraryID))
    .limit(1),
);

const groupLibrariesStatement = defineStatement<Record<string, never>>(
  "target-library",
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
export function readTargetLibraries(): Effect.Effect<
  TargetLibraryRow[],
  ItemQueryReaderError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const [personal] = yield* personalLibraryStatement.all({});
    const groupRows = yield* groupLibrariesStatement.all({});
    return [
      ...(personal
        ? [{ libraryID: personal.libraryID, groupID: null, name: null }]
        : []),
      ...groupRows,
    ];
  });
}
