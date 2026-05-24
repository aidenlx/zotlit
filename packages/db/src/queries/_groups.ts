import { groups } from "@drizzle/schema";
import { eq } from "drizzle-orm";

import { defineQuery } from "./_shared";

export const groupsQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }) =>
    db
      .select({ groupID: groups.groupID })
      .from(groups)
      .where(eq(groups.libraryID, placeholder("libraryID")))
      .limit(1),
);
