// Rebuildable PNGs live in device-local IndexedDB, separate from saved vault assets.
import { openDB } from "idb";
import type { DBSchema } from "idb";

import { normalizeExcerptPayload } from "./format";
import type { ExcerptCache, ExcerptEntry } from "./service";

export const EXCERPT_CACHE_BUDGET = 256 * 1024 * 1024;
export const EXCERPT_CACHE_SCHEMA_VERSION = 2;

export interface ExcerptStore extends ExcerptCache, Disposable {
  clear(): Promise<void>;
}

interface StoredExcerpt extends ExcerptEntry {
  key: string;
  byteCount: number;
  lastAccess: number;
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

/** All image/accounting changes share one transaction, including concurrent puts. */
export async function openExcerptStore(
  appId: string,
  budget = EXCERPT_CACHE_BUDGET,
): Promise<ExcerptStore> {
  const db = await openDB<ExcerptSchema>(
    `${appId}-zotlit-excerpt-images`,
    EXCERPT_CACHE_SCHEMA_VERSION,
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
      let payload: ReturnType<typeof normalizeExcerptPayload> | undefined;
      if (
        record &&
        (!pdf ||
          (pdf.size === record.pdf.size && pdf.mtimeMs === record.pdf.mtimeMs))
      ) {
        try {
          payload = normalizeExcerptPayload(record);
        } catch {
          await tx.done;
          return undefined;
        }
        const state = (await accounting.get("state"))!;
        record.lastAccess = ++state.clock;
        await images.put(record);
        await accounting.put(state, "state");
      }
      await tx.done;
      return payload && record ? { ...payload, pdf: record.pdf } : undefined;
    },
    async put(key, entry) {
      const payload = normalizeExcerptPayload(entry);
      const byteCount = payload.bytes.byteLength;
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
      await images.put({
        ...payload,
        pdf: entry.pdf,
        key,
        byteCount,
        lastAccess: ++state.clock,
      });
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
