import { deletedItems, items, itemTags, tags } from "@drizzle/schema";
import { and, eq, notExists } from "drizzle-orm";

import { defineStatement } from "./database";

const tagValuesStatement = defineStatement<{ libraryID: number }>("tag-values")(
  (db, { placeholder }) =>
    db
      .selectDistinct({ name: tags.name, type: itemTags.type })
      .from(items)
      .innerJoin(itemTags, eq(itemTags.itemID, items.itemID))
      .innerJoin(tags, eq(tags.tagID, itemTags.tagID))
      .where(
        and(
          eq(items.libraryID, placeholder("libraryID")),
          notExists(
            db
              .select({ itemID: deletedItems.itemID })
              .from(deletedItems)
              .where(eq(deletedItems.itemID, items.itemID)),
          ),
        ),
      ),
);

/** Tag names and application types on non-trashed records of one Library. */
export function readTagValues(library: { libraryID: number }) {
  return tagValuesStatement.all(library);
}
