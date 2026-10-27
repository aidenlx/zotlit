// Where the Citation Index keeps its note scans between sessions.

import { openDB } from "idb";
import type { DBSchema } from "idb";

import type { NoteScanRecord } from "./scan-note";

// Persisted version: packages/scripts/lib/format-versions.ts.
export const SCANNER_REVISION = 1;

/** One file's scan, plus what decides whether it still describes that file. */
export interface FileScan extends Pick<
  NoteScanRecord,
  | "citekeys"
  | "wikilinks"
  | "malformedWikilinks"
  | "annotations"
  | "malformedAnnotationCitations"
> {
  /** `TFile.stat.mtime` when the scan ran. */
  mtime: number;
  /** `TFile.stat.size` when the scan ran. */
  size: number;
  scannerRevision: number;
}

/** A {@link FileScan} under the path it belongs to. */
export interface CitekeyRecord extends FileScan {
  path: string;
}

/**
 * The persistence seam of the Citation Index. Everything it holds is derived
 * data the vault can rebuild, so a record it loses costs one rescan.
 */
export interface CitekeyStore extends Disposable {
  /** Every record the store holds, in no particular order. */
  load(): Promise<CitekeyRecord[]>;
  put(record: CitekeyRecord): Promise<void>;
  drop(path: string): Promise<void>;
  clear(): Promise<void>;
}

/** The object store holding one {@link CitekeyRecord} per path. */
const SCANS = "scans";

/**
 * Bump to discard every stored scan: the upgrade recreates the store empty and
 * the backfill rebuilds it, which is how a change to {@link FileScan} ships.
 */
// Persisted version: packages/scripts/lib/format-versions.ts.
const SCHEMA_VERSION = 2;

interface CitationIndexSchema extends DBSchema {
  scans: { key: string; value: CitekeyRecord };
}

/**
 * Opens the vault's own citation-index database, mirroring how Obsidian
 * persists its metadata cache: one IndexedDB database per app id, written a
 * record at a time.
 */
export async function openCitekeyStore(appId: string): Promise<CitekeyStore> {
  const db = await openDB<CitationIndexSchema>(
    `${appId}-zotlit-citation-index`,
    SCHEMA_VERSION,
    {
      upgrade(database) {
        if (database.objectStoreNames.contains(SCANS)) {
          database.deleteObjectStore(SCANS);
        }
        database.createObjectStore(SCANS, { keyPath: "path" });
      },
    },
  );
  return {
    load: () => db.getAll(SCANS),
    put: async (record) => {
      await db.put(SCANS, record);
    },
    drop: (path) => db.delete(SCANS, path),
    clear: () => db.clear(SCANS),
    [Symbol.dispose]: () => db.close(),
  };
}
