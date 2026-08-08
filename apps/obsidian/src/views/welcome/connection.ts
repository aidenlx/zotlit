// Zotero connection readout for Welcome View step 1; the view re-runs it on DB lifecycle events for a live status.
import { homedir } from "node:os";

import { getIndexSignature, getLibraries } from "@zotlit/db";

import type { DatabaseService } from "@/services/database/service";
import type { Settings, SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

export type ConnectionReadout =
  | { status: "checking" }
  | { status: "missing" }
  | {
      status: "connected";
      path: string;
      /** Group library name, or `null` for the user library (UI resolves the default label). */
      library: string | null;
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
  settings: Pick<SettingsService, "loaded">;
}

export interface ReadConnectionSyncDeps extends ConnectionQueryDeps {
  db: Pick<DatabaseService, "state" | "client" | "error">;
  settings: Pick<SettingsService, "current">;
}

function connectedReadout(
  deps: ConnectionQueryDeps,
  settings: Readonly<Settings>,
): ConnectionReadout {
  const loadLibraries = deps.loadLibraries ?? getLibraries;
  const loadIndexSignature = deps.loadIndexSignature ?? getIndexSignature;

  const libraryID = settings["zotero.citation-library"];
  const client = deps.db.client;

  const library =
    loadLibraries(client).find((l) => l.libraryID === libraryID)?.name ?? null;
  const itemCount = loadIndexSignature(client, libraryID).count;
  const path = deps.zoteroPref.dataDir.replace(homedir(), "~");

  return { status: "connected", path, library, itemCount };
}

export async function readConnectionStatus(
  deps: ReadConnectionStatusDeps,
): Promise<ConnectionReadout> {
  await deps.db.ready;
  // A failed most-recent refresh (a broken or moved data path) keeps the
  // service "ready" serving a stale client; surface that as missing so step 1
  // reflects the broken location instead of stale item data.
  if (deps.db.state !== "ready" || deps.db.error) return { status: "missing" };

  const settings = await deps.settings.loaded;
  return connectedReadout(deps, settings);
}

/**
 * Synchronous readout for seeding step 1 before the view's first paint.
 * @returns `null` when the DB is still doing its first load or settings haven't
 * loaded yet — the caller shows the checking spinner until the async readout
 * lands. When the DB is already settled (the common open path), the definite
 * readout is available synchronously, so the spinner never has to flash.
 */
export function readConnectionSync(
  deps: ReadConnectionSyncDeps,
): ConnectionReadout | null {
  if (deps.db.state === "loading") return null;
  if (deps.db.state !== "ready" || deps.db.error) return { status: "missing" };

  const settings = deps.settings.current;
  if (!settings) return null;

  return connectedReadout(deps, settings);
}
