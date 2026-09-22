// Rebuildable Excerpt Images live in device-local IndexedDB, separate from saved vault assets.
import { openDB } from "idb";
import type { DBSchema } from "idb";

import { detectExcerptImageFormat, isExcerptImage } from "./format";
import type { ExcerptImage, ExcerptImageFormat } from "./format";
import type { ExcerptCache, ExcerptEntry, ExcerptIdentity } from "./service";

export const EXCERPT_CACHE_BUDGET = 256 * 1024 * 1024;
const SCHEMA_VERSION = 2;

export interface ExcerptStore extends ExcerptCache, Disposable {
  /** One Annotation's latest image, as {@link ExcerptCache.latest} records it. */
  latest(identity: string): Promise<ExcerptIdentity | undefined>;
  /** Replaces one Annotation's latest reference. */
  putLatest(identity: string, reference: ExcerptIdentity): Promise<void>;
  clear(): Promise<void>;
}

interface StoredExcerpt extends Omit<ExcerptEntry, "format"> {
  key: string;
  byteCount: number;
  lastAccess: number;
  /** Absent on records written before format metadata; the payload then decides. */
  format?: ExcerptImageFormat;
}

/** One Annotation's latest image, as the store keeps the reference that locates it. */
interface StoredLatest extends ExcerptIdentity {
  /** {@link excerptAnnotationIdentity} of the Annotation, which is the record key. */
  identity: string;
}

interface ExcerptSchema extends DBSchema {
  images: {
    key: string;
    value: StoredExcerpt;
    indexes: { access: number };
  };
  /**
   * One record per verified Annotation: the image it last displayed, which is
   * what a display paints while the Annotation's current pixels resolve, and
   * what an eviction follows to the bytes it locates.
   */
  latest: {
    key: string;
    value: StoredLatest;
    indexes: { image: string };
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
        database
          .createObjectStore("latest", { keyPath: "identity" })
          .createIndex("image", "key");
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
      const tx = db.transaction(
        ["images", "latest", "accounting"],
        "readwrite",
      );
      void tx.done.catch(() => undefined);
      const images = tx.objectStore("images");
      const latest = tx.objectStore("latest");
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
        // The bytes a reference locates leave with them: a reference without its
        // image would paint nothing after a restart and refresh for nothing.
        let pointing = await latest.index("image").openCursor(cursor.value.key);
        while (pointing) {
          await pointing.delete();
          pointing = await pointing.continue();
        }
        await cursor.delete();
        cursor = await cursor.continue();
      }
      await accounting.put(state, "state");
      await tx.done;
    },
    async latest(identity) {
      return await db.get("latest", identity);
    },
    async putLatest(identity, reference) {
      const tx = db.transaction("latest", "readwrite");
      void tx.done.catch(() => undefined);
      await tx.objectStore("latest").put({ identity, ...reference });
      await tx.done;
    },
    async clear() {
      const tx = db.transaction(
        ["images", "latest", "accounting"],
        "readwrite",
      );
      void tx.done.catch(() => undefined);
      await Promise.all([
        tx.objectStore("images").clear(),
        tx.objectStore("latest").clear(),
        tx.objectStore("accounting").clear(),
      ]);
      await tx.done;
    },
    [Symbol.dispose]() {
      db.close();
    },
  };
}
