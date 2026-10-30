// Shared universe predicates for Attachments, Annotations, and their relations.
import {
  deletedItems,
  itemAttachments,
  itemTypesCombined,
} from "@drizzle/schema";
import type { AnyColumn } from "drizzle-orm";
import { eq, inArray, notExists, notInArray } from "drizzle-orm";

import type { NodeDatabaseClient } from "@/client/node";
import { CHILD_ITEM_TYPES } from "@/lib/item-types";

export function recordUniverse(
  db: NodeDatabaseClient,
  records: readonly { itemID: AnyColumn }[],
  attachment: boolean,
) {
  return [
    notInArray(itemTypesCombined.typeName, [...CHILD_ITEM_TYPES]),
    ...(attachment ? [inArray(itemAttachments.linkMode, [0, 1, 2, 3])] : []),
    ...records.map((table) =>
      notExists(
        db
          .select({ itemID: deletedItems.itemID })
          .from(deletedItems)
          .where(eq(deletedItems.itemID, table.itemID)),
      ),
    ),
  ];
}
