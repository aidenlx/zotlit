import { groups } from "@drizzle/schema";
import { eq } from "drizzle-orm";

import type { NodeDatabaseClient } from "@/client/node";

import { defineQuery } from "./_shared";

export const groupsQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }) =>
    db
      .select({ groupID: groups.groupID })
      .from(groups)
      .where(eq(groups.libraryID, placeholder("libraryID")))
      .limit(1),
);

/** Resolve a library's `groupID` (null for the user library). */
export function groupIDForLibrary(
  db: NodeDatabaseClient,
  libraryID: number,
): number | null {
  return groupsQuery.prepared(db).get({ libraryID })?.groupID ?? null;
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
