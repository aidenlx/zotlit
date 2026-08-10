// The Pandoc engine binary cache: a flat directory of files, backed by OPFS on the device.

const ROOT_DIR = "zotlit";
const CACHE_DIR = "pandoc-engine";

declare global {
  interface FileSystemFileHandle {
    /**
     * Chromium's OPFS rename, replacing an entry already named `name`.
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/move
     */
    move(name: string): Promise<void>;
  }
}

/**
 * A flat directory the engine binary is cached in. Entries are addressed by
 * name alone, and {@link rename} is atomic, so a reader never observes a
 * half-written entry.
 */
export interface EngineBinaryStore {
  list(): Promise<string[]>;
  /** `undefined` when nothing is stored under `name`. */
  read(name: string): Promise<Uint8Array<ArrayBuffer> | undefined>;
  write(name: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  /** Replaces an entry already named `to`. */
  rename(from: string, to: string): Promise<void>;
  /** A name that is already gone is a success. */
  remove(name: string): Promise<void>;
  /** Drops the directory itself, with everything in it. */
  clear(): Promise<void>;
}

/**
 * OPFS is origin-scoped and Obsidian serves every vault from one origin, so
 * this directory — and the binary in it — is shared device-wide, with no
 * per-vault isolation.
 */
export function createOpfsBinaryStore(): EngineBinaryStore {
  return {
    async list() {
      const names: string[] = [];
      for await (const name of (await cacheDir()).keys()) names.push(name);
      return names;
    },
    async read(name) {
      const dir = await cacheDir();
      try {
        const handle = await dir.getFileHandle(name);
        return new Uint8Array(await (await handle.getFile()).arrayBuffer());
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    },
    async write(name, bytes) {
      const dir = await cacheDir();
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
    },
    async rename(from, to) {
      const dir = await cacheDir();
      await (await dir.getFileHandle(from)).move(to);
    },
    async remove(name) {
      const dir = await cacheDir();
      try {
        await dir.removeEntry(name);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },
    async clear() {
      const root = await navigator.storage.getDirectory();
      const zotlit = await root.getDirectoryHandle(ROOT_DIR, { create: true });
      try {
        await zotlit.removeEntry(CACHE_DIR, { recursive: true });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },
  };
}

async function cacheDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const zotlit = await root.getDirectoryHandle(ROOT_DIR, { create: true });
  return zotlit.getDirectoryHandle(CACHE_DIR, { create: true });
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}
