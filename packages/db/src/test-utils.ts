// Shared item-fixture builder for @zotlit/db consumers' tests.
import { Temporal } from "@zotlit/shared/temporal";
import { type ItemFields } from "@zotlit/zotero-types";

import { USER_LIBRARY_ID } from "./lib/constants";
import { type BaseItem, type Item } from "./queries/items";

/** A minimal full DB item fixture (Hensher2011-shaped defaults), overridable via `fields`/`base`. */
export function makeItem(
  fields: { itemType: string } & Record<string, string | null>,
  base?: Partial<BaseItem>,
): Item {
  return {
    itemID: 1,
    libraryID: USER_LIBRARY_ID,
    key: "KX67D9YM",
    indexedKey: "KX67D9YM",
    dateAdded: Temporal.Instant.from("2024-01-15T10:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-15T10:00:00Z"),
    creators: [
      {
        firstName: "David",
        lastName: "Hensher",
        creatorType: "author",
        fieldMode: 0,
      },
    ],
    primaryCreatorType: "author",
    customFields: new Map(),
    groupID: null,
    ...base,
    fields: fields as ItemFields,
  };
}
