// Rebuildable Excerpt Images live in device-local IndexedDB, separate from saved vault assets.
import { openDB } from "idb";
import type { DBSchema } from "idb";

import { detectExcerptImageFormat, isExcerptImage } from "./format";
import type { ExcerptImage, ExcerptImageFormat } from "./format";
import type { ExcerptCache, ExcerptEntry } from "./service";

export const EXCERPT_CACHE_BUDGET = 256 * 1024 * 1024;
const SCHEMA_VERSION = 1;

export interface ExcerptStore extends ExcerptCache, Disposable {
  clear(): Promise<void>;
}

interface StoredExcerpt extends Omit<ExcerptEntry, "format"> {
  key: string;
  byteCount: number;
  lastAccess: number;
  /** Absent on records written before format metadata; the payload then decides. */
  format?: ExcerptImageFormat;
}
interface ExcerptSchema extends DBSchema {
  images: {
    key: string;
    value: StoredExcerpt;
    indexes: { access: number };
  };
  accounting: {
    key: string;
    value: { totalBytes: number; clock: number };
  };
}

/**
 * Reads the image a record holds. A record with a format must match it, and a
 * record written before format metadata is read as the container it actually is.
 */
function storedImage(
  record: StoredExcerpt | undefined,
): ExcerptImage | undefined {
  if (!record) return undefined;
  const format = record.format ?? detectExcerptImageFormat(record.bytes);
  const image = format && { bytes: record.bytes, format };
  return image && isExcerptImage(image) ? image : undefined;
}

/** All image/accounting changes share one transaction, including concurrent puts. */
export async function openExcerptStore(
  appId: string,
  budget = EXCERPT_CACHE_BUDGET,
): Promise<ExcerptStore> {
  const db = await openDB<ExcerptSchema>(
    `${appId}-zotlit-excerpt-images`,
    SCHEMA_VERSION,
    {
      upgrade(database) {
        while (database.objectStoreNames.length)
          database.deleteObjectStore(database.objectStoreNames[0]!);
        database
          .createObjectStore("images", { keyPath: "key" })
          .createIndex("access", "lastAccess");
        database.createObjectStore("accounting");
      },
      blocking() {
        db.close();
      },
    },
  );
  return {
    async get(key, pdf) {
      const tx = db.transaction(["images", "accounting"], "readwrite");
      // Observe transaction failures even when an individual request rejects first.
      void tx.done.catch(() => undefined);
      const images = tx.objectStore("images");
      const accounting = tx.objectStore("accounting");
      const record = await images.get(key);
      const image = storedImage(record);
      if (record && image) {
        if (
          !pdf ||
          (pdf.size === record.pdf.size && pdf.mtimeMs === record.pdf.mtimeMs)
        ) {
          const state = (await accounting.get("state"))!;
          record.lastAccess = ++state.clock;
          await images.put(record);
          await accounting.put(state, "state");
        }
        await tx.done;
        return { bytes: image.bytes, format: image.format, pdf: record.pdf };
      }
      await tx.done;
      return undefined;
    },
    async put(key, entry) {
      const byteCount = entry.bytes.byteLength;
      if (byteCount > budget) return;
      const tx = db.transaction(["images", "accounting"], "readwrite");
      void tx.done.catch(() => undefined);
      const images = tx.objectStore("images");
      const accounting = tx.objectStore("accounting");
      const state = (await accounting.get("state")) ?? {
        totalBytes: 0,
        clock: 0,
      };
      const previous = await images.get(key);
      state.totalBytes += byteCount - (previous?.byteCount ?? 0);
      await images.put({ ...entry, key, byteCount, lastAccess: ++state.clock });
      let cursor = await images.index("access").openCursor();
      while (cursor && state.totalBytes > budget) {
        state.totalBytes -= cursor.value.byteCount;
        await cursor.delete();
        cursor = await cursor.continue();
      }
      await accounting.put(state, "state");
      await tx.done;
    },
    async clear() {
      const tx = db.transaction(["images", "accounting"], "readwrite");
      void tx.done.catch(() => undefined);
      await Promise.all([
        tx.objectStore("images").clear(),
        tx.objectStore("accounting").clear(),
      ]);
      await tx.done;
    },
    [Symbol.dispose]() {
      db.close();
    },
  };
}
