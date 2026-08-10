// Where the Citation Index keeps its literal-citekey scans between sessions.

import { openDB } from "idb";
import type { DBSchema } from "idb";
import type { App } from "obsidian";

import type { CitationOccurrence } from "./scan";

/** One file's scan, plus what decides whether it still describes that file. */
export interface FileScan {
  /** `TFile.stat.mtime` when the scan ran. */
  mtime: number;
  /** `TFile.stat.size` when the scan ran. */
  size: number;
  /** The literal-citekey occurrences only — a wikilink is never stored. */
  occurrences: CitationOccurrence[];
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
const SCHEMA_VERSION = 1;

interface CitationIndexSchema extends DBSchema {
  scans: { key: string; value: CitekeyRecord };
}

/**
 * Opens the vault's own citation-index database, mirroring how Obsidian
 * persists its metadata cache: one IndexedDB database per app id, written a
 * record at a time.
 */
export async function openCitekeyStore(app: App): Promise<CitekeyStore> {
  const db = await openDB<CitationIndexSchema>(
    `${app.appId}-zotlit-citation-index`,
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
