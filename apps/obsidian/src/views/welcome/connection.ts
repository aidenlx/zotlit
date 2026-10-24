import { homedir } from "node:os";

import { Effect } from "@/lib/effect";
// Zotero connection readout for Welcome View step 1; the view re-runs it on database lifecycle events for a live status.
import type { SubscriptionRuntime } from "@/lib/effect-stream";
import { subscribe } from "@/lib/effect-stream";
import type { PlainQueryClients } from "@/services/query-client/plain";
import type { PlainZoteroPref } from "@/services/zotero-pref/plain";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";

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
  reads: Pick<PlainZoteroReads, "state" | "error" | "moved">;
  queries: Pick<PlainQueryClients, "peek">;
  zoteroPref: Pick<PlainZoteroPref, "dataDir">;
}

export interface ReadConnectionStatusDeps extends ConnectionQueryDeps {
  reads: Pick<PlainZoteroReads, "state" | "error" | "moved" | "reads">;
  queries: Pick<PlainQueryClients, "peek" | "read">;
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
  runtime: SubscriptionRuntime;
  reads: Pick<
    PlainZoteroReads,
    | "changed"
    | "degraded"
    | "refresh-failed"
    | "refreshing"
    | "db-file-missing"
    | "refresh-requested"
  >;
  queries: Pick<PlainQueryClients, "invalidate">;
}): () => void {
  return subscribe(deps.runtime, deps.reads["changed"], () =>
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
 * ZotLit cannot read the Zotero data directory the settings name: no
 * connection serves, as where the folder is missing or unreadable at start,
 * or the one that serves reads another folder, as where the data folder
 * changed to one that does not read. The Library View then says "Zotero not
 * found" in place of its tree and list.
 *
 * @see apps/obsidian/docs/adr/0077-the-library-view-is-the-first-screen.md
 */
export function unavailable(deps: Pick<ConnectionQueryDeps, "reads">): boolean {
  return (
    deps.reads.state === "degraded" ||
    (deps.reads.error !== null && deps.reads.moved)
  );
}

/**
 * The last refresh of the database the settings name failed while that
 * database still serves, as for a locked or briefly unreadable file: the
 * Library View keeps its rows and says so.
 */
export function refreshFailed(
  deps: Pick<ConnectionQueryDeps, "reads">,
): boolean {
  return !unavailable(deps) && deps.reads.error !== null;
}

/**
 * Whether step 1 reads as missing: no connection serves, or the folder the
 * settings name does not read, so step 1 shows the broken location rather
 * than the earlier connection's item count.
 */
function missing(deps: Pick<ConnectionQueryDeps, "reads">): boolean {
  return unavailable(deps) || refreshFailed(deps);
}

export async function readConnectionStatus(
  deps: ReadConnectionStatusDeps,
): Promise<ConnectionReadout> {
  const { reads } = deps.reads;
  if (missing(deps)) return { status: "missing" };

  const held = await deps.queries.read(ITEM_COUNT_KEY, ({ signal }) =>
    Effect.runPromise(reads.ConnectionReadout({}), { signal }),
  );
  if (held === null || deps.reads.state !== "ready" || missing(deps)) {
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
  if (missing(deps)) return { status: "missing" };

  const held = deps.queries.peek<{ itemCount: number }>(ITEM_COUNT_KEY);
  return held === null ? null : connectedReadout(deps, held.value.itemCount);
}
