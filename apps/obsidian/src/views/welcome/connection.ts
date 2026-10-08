// Zotero connection readout for Welcome View step 1; the view re-runs it on database lifecycle events for a live status.

import { Effect } from "effect";
import { homedir } from "node:os";

import type { QueryClientService } from "@/services/query-client/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

export type ConnectionReadout =
  | { status: "checking" }
  | { status: "missing" }
  | {
      status: "connected";
      path: string;
      /** Items across every library the database holds, independent of Library Scope. */
      itemCount: number;
    };

/** The query key the held item count lives under. */
const ITEM_COUNT_KEY = ["welcome", "connection-readout"] as const;

interface ConnectionQueryDeps {
  reads: Pick<ZoteroReadsService, "state" | "error">;
  queries: Pick<QueryClientService, "peek">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir">;
}

export interface ReadConnectionStatusDeps extends ConnectionQueryDeps {
  reads: Pick<ZoteroReadsService, "state" | "error" | "ready">;
  queries: Pick<QueryClientService, "peek" | "read">;
}

export type ReadConnectionSyncDeps = ConnectionQueryDeps;

/**
 * Keeps the held item count current for the plugin's life: a database change
 * marks it stale, and the next readout reads it again while the old count
 * still seeds the view.
 *
 * @returns the unsubscribe.
 */
export function holdConnectionReadout(deps: {
  reads: Pick<ZoteroReadsService, "on">;
  queries: Pick<QueryClientService, "invalidate">;
}): () => void {
  return deps.reads.on("changed", () =>
    deps.queries.invalidate(ITEM_COUNT_KEY),
  );
}

/**
 * Step 1 answers "is Zotero reachable, and does it hold anything", so it counts
 * every library the database holds rather than a configured subset — Library
 * Scope governs discovery, not whether the connection is healthy.
 */
function connectedReadout(
  deps: Pick<ConnectionQueryDeps, "zoteroPref">,
  itemCount: number,
): ConnectionReadout {
  const path = deps.zoteroPref.dataDir.replace(homedir(), "~");
  return { status: "connected", path, itemCount };
}

/**
 * A failed most-recent refresh (a broken or moved data path) keeps the
 * database serving a stale connection; surface that as missing so step 1
 * reflects the broken location instead of stale item data.
 */
function unavailable(deps: Pick<ConnectionQueryDeps, "reads">): boolean {
  return deps.reads.state === "degraded" || deps.reads.error !== null;
}

export async function readConnectionStatus(
  deps: ReadConnectionStatusDeps,
): Promise<ConnectionReadout> {
  const { reads } = await deps.reads.ready;
  if (unavailable(deps)) return { status: "missing" };

  const held = await deps.queries.read(ITEM_COUNT_KEY, ({ signal }) =>
    Effect.runPromise(reads.ConnectionReadout({}), { signal }),
  );
  if (held === null || deps.reads.state !== "ready" || unavailable(deps)) {
    return { status: "missing" };
  }
  return connectedReadout(deps, held.itemCount);
}

/**
 * Synchronous readout for seeding step 1 before the view's first paint, from
 * the held item count.
 * @returns `null` while the database is doing its first load or no count is
 * held yet — the caller shows the checking spinner until the async readout
 * lands. When the count is held (the common open path), the definite readout
 * is available synchronously, so the spinner never has to flash.
 */
export function readConnectionSync(
  deps: ReadConnectionSyncDeps,
): ConnectionReadout | null {
  if (deps.reads.state === "loading") return null;
  if (unavailable(deps)) return { status: "missing" };

  const held = deps.queries.peek<{ itemCount: number }>(ITEM_COUNT_KEY);
  return held === null ? null : connectedReadout(deps, held.value.itemCount);
}
