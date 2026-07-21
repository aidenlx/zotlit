// Zotero connection readout for Welcome View step 1; the view re-runs it on DB lifecycle events for a live status.
import { homedir } from "node:os";

import { getIndexSignature, getLibraries } from "@zotlit/db";

import { type DatabaseService } from "@/services/database/service";
import { type SettingsService } from "@/services/settings/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

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

export interface ReadConnectionStatusDeps {
  db: Pick<DatabaseService, "state" | "ready" | "client" | "error">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir">;
  settings: Pick<SettingsService, "loaded">;
  /** @default getLibraries */
  loadLibraries?: typeof getLibraries;
  /** @default getIndexSignature */
  loadIndexSignature?: typeof getIndexSignature;
}

export async function readConnectionStatus(
  deps: ReadConnectionStatusDeps,
): Promise<ConnectionReadout> {
  await deps.db.ready;
  // A failed most-recent refresh (a broken or moved data path) keeps the
  // service "ready" serving a stale client; surface that as missing so step 1
  // reflects the broken location instead of stale item data.
  if (deps.db.state !== "ready" || deps.db.error) return { status: "missing" };

  const loadLibraries = deps.loadLibraries ?? getLibraries;
  const loadIndexSignature = deps.loadIndexSignature ?? getIndexSignature;

  const settings = await deps.settings.loaded;
  const libraryID = settings["zotero.citation-library"];
  const client = deps.db.client;

  const library =
    loadLibraries(client).find((l) => l.libraryID === libraryID)?.name ?? null;
  const itemCount = loadIndexSignature(client, libraryID).count;
  const path = deps.zoteroPref.dataDir.replace(homedir(), "~");

  return { status: "connected", path, library, itemCount };
}
