// Reports the Zotero schema versions of the database being read.
import type { NodeDatabaseClient } from "@/client/node";
import type { SQLocalDatabaseClient } from "@/client/web";

import { defineQuery } from "./_shared";

/**
 * Inclusive version ranges ZotLit is tested against, keyed by the
 * `version.schema` row that holds each one. This is the range of Zotero clients
 * exercised. The typed schema exposes newer columns. Queries that use them
 * must keep an explicit path for supported userdata 125 databases.
 *
 * - `userdata` counts Zotero's applied migration steps. Zotero 9.0.0 through
 *   9.0.6 sit at 125; Zotero 10.0.0 raises it to 129.
 * - `compatibility` is the client generation the file demands. Zotero refuses a
 *   database whose value exceeds its own `_maxCompatibility` — 7 on Zotero 9,
 *   9 on Zotero 10.
 *
 * @see https://github.com/zotero/zotero/blob/10.0.0/resource/schema/userdata.sql
 * @see https://github.com/zotero/zotero/blob/10.0.0/chrome/content/zotero/xpcom/schema.js#L45
 */
export const SUPPORTED_SCHEMA_VERSIONS = {
  userdata: { min: 125, max: 129 },
  compatibility: { min: 7, max: 9 },
} as const;

export interface ZoteroSchemaVersions {
  /** `null` when the database carries no `userdata` row. */
  userdata: number | null;
  /** `null` when the database carries no `compatibility` row. */
  compatibility: number | null;
  /** Both versions are present and inside {@link SUPPORTED_SCHEMA_VERSIONS}. */
  supported: boolean;
}

const versionQuery = defineQuery<void>()((db) =>
  db.query.version.findMany({
    columns: { schema: true, version: true },
    where: { schema: { in: ["userdata", "compatibility"] } },
  }),
);

/**
 * `supported: false` means ZotLit reads a database shape it was never tested
 * against, so a query may return wrong data or none. The caller decides what to
 * do with that; the read itself stays allowed, because a stale range would
 * otherwise block a working Zotero upgrade.
 */
export function getSchemaVersions(
  db: NodeDatabaseClient,
): ZoteroSchemaVersions {
  const rows = versionQuery.prepared(db).all();
  const readVersion = (schema: string): number | null => {
    const version = rows.find((row) => row.schema === schema)?.version;
    return typeof version === "number" ? version : null;
  };
  const userdata = readVersion("userdata");
  const compatibility = readVersion("compatibility");
  const supported =
    inRange(userdata, SUPPORTED_SCHEMA_VERSIONS.userdata) &&
    inRange(compatibility, SUPPORTED_SCHEMA_VERSIONS.compatibility);
  return { userdata, compatibility, supported };
}

/** Whether local client revision columns added in userdata 129 are available. */
export function hasClientRevisions(db: NodeDatabaseClient): boolean {
  const { userdata } = getSchemaVersions(db);
  return userdata !== null && userdata >= 129;
}

/** Async-client form of {@link hasClientRevisions}. */
export async function hasClientRevisionsAsync(
  db: SQLocalDatabaseClient,
): Promise<boolean> {
  const rows = await versionQuery.prepared(db).all();
  const userdata = rows.find(({ schema }) => schema === "userdata")?.version;
  return typeof userdata === "number" && userdata >= 129;
}

function inRange(
  version: number | null,
  { min, max }: { min: number; max: number },
): boolean {
  return version !== null && version >= min && version <= max;
}
