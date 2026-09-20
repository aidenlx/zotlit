// Reads the signed-in Zotero account's identity from the `settings` table.
import { getLogger } from "@logtape/logtape";

import type { NodeDatabaseClient } from "@/client/node";

import { defineQuery } from "./_shared";

const logger = getLogger(["zotlit", "db", "account"]);

/**
 * How Zotero identifies the signed-in account. It writes `localUserKey` on
 * first run and `userID` once the account syncs, preferring the latter, so a
 * database Zotero has opened carries at least one — together they name the
 * personal library in an `itemUri`.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/users.js#L61
 */
export interface ZoteroUserIdentity {
  /** Numeric account id; `null` until the account syncs with zotero.org. */
  userID: number | null;
  /** Random 8-character key Zotero writes on first run. */
  localUserKey: string | null;
  /**
   * Account username; `null` when the account never synced. Backs
   * `zt.weblink`'s personal-library URL (`https://www.zotero.org/{username}/…`).
   */
  username: string | null;
}

export interface ZoteroDatabaseIdentity {
  userID: number | null;
  localUserKey: string | null;
  /** Exact Local API database id, or `null` before Zotero initializes it. */
  serverID: string | null;
}

const identityQuery = defineQuery<void>()((db) =>
  db.query.settings.findMany({
    columns: { key: true, value: true },
    where: {
      setting: "account",
      key: { in: ["userID", "localUserKey", "username"] },
    },
  }),
);

const localApiIdentityQuery = defineQuery<void>()((db) =>
  db.query.settings.findMany({
    columns: { value: true },
    where: { setting: "localAPI", key: "serverID" },
    limit: 1,
  }),
);

/**
 * The `settings.value` column is loosely typed, so every raw value is checked
 * before use; Zotero stores `userID` as a positive integer and may hold it as
 * text.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/users.js#L61
 */
export function getZoteroIdentity(db: NodeDatabaseClient): ZoteroUserIdentity {
  const rows = identityQuery.prepared(db).all();
  const text = (key: string): string | null => {
    const value = rows.find((row) => row.key === key)?.value;
    return typeof value === "string" && value !== "" ? value : null;
  };
  const rawUserID = rows.find((row) => row.key === "userID")?.value;
  const userID = typeof rawUserID === "number" ? rawUserID : Number(rawUserID);
  const resolvedUserID = Number.isInteger(userID) && userID > 0 ? userID : null;
  const localUserKey = text("localUserKey");
  if (resolvedUserID == null && localUserKey == null)
    logger.warn(
      "Zotero database carries neither userID nor localUserKey; personal-library items have no Item URI to build",
    );
  return {
    userID: resolvedUserID,
    localUserKey,
    username: text("username"),
  };
}

/** Identity needed to bind a verified database snapshot to a Local API session. */
export function getZoteroDatabaseIdentity(
  db: NodeDatabaseClient,
): ZoteroDatabaseIdentity {
  const { userID, localUserKey } = getZoteroIdentity(db);
  const value = localApiIdentityQuery.prepared(db).all()[0]?.value;
  return {
    userID,
    localUserKey,
    serverID: typeof value === "string" && value !== "" ? value : null,
  };
}
