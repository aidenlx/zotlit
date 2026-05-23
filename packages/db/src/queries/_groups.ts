import { groups } from "@drizzle/schema";
import { eq, sql } from "drizzle-orm";

import { defineQuery } from "./_shared";

export type GroupQueryParam = {
  libraryID: number;
};

export const groupQueryBuilder = defineQuery((db) =>
  db
    .select({ groupID: groups.groupID })
    .from(groups)
    .where(eq(groups.libraryID, sql.placeholder("libraryID")))
    .limit(1),
);
