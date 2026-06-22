import { type NodeDatabaseClient } from "@/client/node";
import { parseItemUri } from "@/lib/zt-note-mark";

import { defineQuery } from "./_shared";

/**
 * Zotero's `dc:relation` predicate — the user-facing "Related" panel. Stored
 * reciprocally (both items get the row) and read forward-only by Zotero, so a
 * single `itemID = X AND predicate = dc:relation` lookup returns the complete
 * set the user sees. Other predicates (`owl:sameAs`, `dc:replaces`) are
 * sync/merge internals and are excluded.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/data/item.js#L6099 (`_getRelatedItems`)
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/elements/relatedBox.js
 */
const RELATED_ITEM_PREDICATE = "dc:relation";

const relatedObjectsByItemQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }) =>
    db.query.itemRelations.findMany({
      where: {
        itemID: placeholder("itemID"),
        predicate: { predicate: RELATED_ITEM_PREDICATE },
      },
      columns: { object: true },
    }),
);

/**
 * Keys of the items directly related to `itemID` via Zotero's "Related" panel
 * (`dc:relation`). Forward-only and depth-1, matching Zotero's own panel.
 *
 * `dc:relation` is a same-library invariant (Zotero rejects cross-library
 * relations), so callers resolve these keys within the source item's library.
 * Object URIs that don't parse to a Zotero item (e.g. a collection relation
 * sharing the row shape) are skipped.
 */
export function getRelatedKeysByItemID(
  db: NodeDatabaseClient,
  itemID: number,
): string[] {
  return relatedObjectsByItemQuery
    .prepared(db)
    .all({ itemID })
    .flatMap((row) => {
      const ref = parseItemUri(row.object);
      return ref ? [ref.key] : [];
    });
}
