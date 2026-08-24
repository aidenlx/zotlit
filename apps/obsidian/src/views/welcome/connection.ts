// Zotero connection readout for Welcome View step 1; the view re-runs it on DB lifecycle events for a live status.
import { homedir } from "node:os";

import { getIndexSignature, getLibraries } from "@zotlit/db";

import type { DatabaseService } from "@/services/database/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

export type ConnectionReadout =
  | { status: "checking" }
  | { status: "missing" }
  | {
      status: "connected";
      path: string;
      /** Items across every library the database holds, independent of Library Scope. */
      itemCount: number;
    };

interface ConnectionQueryDeps {
  db: Pick<DatabaseService, "client">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir">;
  /** @default getLibraries */
  loadLibraries?: typeof getLibraries;
  /** @default getIndexSignature */
  loadIndexSignature?: typeof getIndexSignature;
}

export interface ReadConnectionStatusDeps extends ConnectionQueryDeps {
  db: Pick<DatabaseService, "state" | "ready" | "client" | "error">;
}

export interface ReadConnectionSyncDeps extends ConnectionQueryDeps {
  db: Pick<DatabaseService, "state" | "client" | "error">;
}

/**
 * Step 1 answers "is Zotero reachable, and does it hold anything", so it counts
 * every library the database holds rather than a configured subset — Library
 * Scope governs discovery, not whether the connection is healthy.
 */
function connectedReadout(deps: ConnectionQueryDeps): ConnectionReadout {
  const loadLibraries = deps.loadLibraries ?? getLibraries;
  const loadIndexSignature = deps.loadIndexSignature ?? getIndexSignature;

  const client = deps.db.client;
  const itemCount = loadLibraries(client).reduce(
    (total, library) =>
      total + loadIndexSignature(client, library.libraryID).count,
    0,
  );
  const path = deps.zoteroPref.dataDir.replace(homedir(), "~");

  return { status: "connected", path, itemCount };
}

export async function readConnectionStatus(
  deps: ReadConnectionStatusDeps,
): Promise<ConnectionReadout> {
  await deps.db.ready;
  // A failed most-recent refresh (a broken or moved data path) keeps the
  // service "ready" serving a stale client; surface that as missing so step 1
  // reflects the broken location instead of stale item data.
  if (deps.db.state !== "ready" || deps.db.error) return { status: "missing" };

  return connectedReadout(deps);
}

/**
 * Synchronous readout for seeding step 1 before the view's first paint.
 * @returns `null` when the DB is still doing its first load — the caller shows
 * the checking spinner until the async readout lands. When the DB is already
 * settled (the common open path), the definite readout is available
 * synchronously, so the spinner never has to flash.
 */
export function readConnectionSync(
  deps: ReadConnectionSyncDeps,
): ConnectionReadout | null {
  if (deps.db.state === "loading") return null;
  if (deps.db.state !== "ready" || deps.db.error) return { status: "missing" };

  return connectedReadout(deps);
}
