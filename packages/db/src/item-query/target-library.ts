// The reader that resolves the Target Library of an Item Query. It reads the
// columns of the layout manifest only, so it runs on every copy that passes
// the layout check, whatever its version stamps are.
import { groups, libraries } from "@drizzle/schema";
import { asc, eq } from "drizzle-orm";
import { Effect } from "effect";

import { defineStatement } from "./database";
import type { ItemQueryDatabase, ItemQueryReaderError } from "./database";

/** The Library a caller names: the personal Library, or a group by its ID. */
export type TargetLibrarySelector =
  | { readonly type: "personal" }
  | { readonly type: "group"; readonly groupID: number };

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

const groupLibraryStatement = defineStatement<{ groupID: number }>(
  "target-library",
)((db, { placeholder }) =>
  db
    .select({ libraryID: groups.libraryID, name: groups.name })
    .from(groups)
    .where(eq(groups.groupID, placeholder("groupID"))),
);

/** Read the Library that the selector names; `null` when the copy has none. */
export function readTargetLibrary(
  selector: TargetLibrarySelector,
): Effect.Effect<
  TargetLibraryRow | null,
  ItemQueryReaderError,
  ItemQueryDatabase
> {
  if (selector.type === "personal") {
    return Effect.map(personalLibraryStatement.all({}), ([row]) =>
      row ? { libraryID: row.libraryID, groupID: null, name: null } : null,
    );
  }
  const { groupID } = selector;
  return Effect.map(groupLibraryStatement.all({ groupID }), ([row]) =>
    row ? { libraryID: row.libraryID, groupID, name: row.name } : null,
  );
}
