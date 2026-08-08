// Reads the signed-in Zotero account's username from the `settings` table.
import type { NodeDatabaseClient } from "@/client/node";

import { defineQuery } from "./_shared";

const usernameQuery = defineQuery<void>()((db) =>
  db.query.settings.findMany({
    columns: { value: true },
    where: { setting: "account", key: "username" },
    limit: 1,
  }),
);

/**
 * The account username backs `zt.weblink`'s personal-library URL
 * (`https://www.zotero.org/{username}/...`). The `settings.value` column is
 * loosely typed, so the raw `(setting='account', key='username')` value is
 * checked before use.
 *
 * @returns the username, or `null` when the account never synced (no row) or
 *   the stored value is empty / not a string.
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/users.js#L93
 */
export function getCurrentUsername(db: NodeDatabaseClient): string | null {
  const value = usernameQuery.prepared(db).all()[0]?.value;
  return typeof value === "string" && value !== "" ? value : null;
}
