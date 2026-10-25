// An in-memory metadata cache for tests. The test drives it; the tag's own
// layer runs over it (`layerMetadataCacheFrom`, or `layerHostApp` from
// ./obsidian-host-app). The other capability tags' fixtures copy this shape.
import type { CachedMetadata, EventRef, TFile } from "obsidian";

import type { MetadataCacheSource } from "@/lib/obsidian-metadata-cache";

type Callback = (...args: unknown[]) => unknown;

/**
 * The cache entries of a test vault, by path, and Obsidian's metadata cache
 * events. A module under test that still reads `app.metadataCache` takes this
 * object, so it reads the same entries as the tag.
 */
export class MemoryMetadataCache implements MetadataCacheSource {
  readonly entries = new Map<string, CachedMetadata>();
  /** The file each linkpath resolves to, whatever the source note; the test sets it. */
  readonly links = new Map<string, TFile>();
  /** Mirrors Obsidian's `isCacheClean()`: no parse pending, resolver idle. */
  clean = false;
  readonly #listeners = new Map<string, Set<Callback>>();
  readonly #cleanCallbacks: (() => void)[] = [];

  getFileCache(file: TFile): CachedMetadata | null {
    return this.getCache(file.path);
  }

  getFirstLinkpathDest(linkpath: string, _sourcePath: string): TFile | null {
    return this.links.get(linkpath) ?? null;
  }

  /** As Obsidian: `null` for a path it holds nothing for, `{}` for a non-Markdown file. */
  getCache(path: string): CachedMetadata | null {
    const cache = this.entries.get(path);
    if (!cache) return null;
    return path.endsWith(".md") ? cache : {};
  }

  on(name: string, callback: Callback): EventRef {
    let listeners = this.#listeners.get(name);
    if (!listeners) this.#listeners.set(name, (listeners = new Set()));
    listeners.add(callback);
    const ref = { e: this, name, fn: callback };
    return ref;
  }

  offref(ref: EventRef): void {
    const { name, fn } = ref as unknown as { name: string; fn: Callback };
    this.#listeners.get(name)?.delete(fn);
  }

  /** How many listeners are registered for `name`. */
  listenerCount(name: string): number {
    return this.#listeners.get(name)?.size ?? 0;
  }

  /** Hold `cache` for `path` and announce nothing. */
  setCache(path: string, cache: CachedMetadata): void {
    this.entries.set(path, cache);
  }

  /** The file was indexed: hold `cache`, then `changed`. */
  change(file: TFile, cache: CachedMetadata, data = ""): void {
    this.entries.set(file.path, cache);
    this.trigger("changed", file, data, cache);
  }

  /** The file was deleted: drop its entry, then `deleted`. */
  delete(file: TFile): void {
    const prevCache = this.entries.get(file.path) ?? null;
    this.entries.delete(file.path);
    this.trigger("deleted", file, prevCache);
  }

  /**
   * Obsidian's undocumented one-shot: at once when the cache is clean, else
   * after the next `resolved` drains the queue.
   */
  onCleanCache(callback: () => void): void {
    if (this.clean) callback();
    else this.#cleanCallbacks.push(callback);
  }

  /** The resolver queue drains: the cache is clean, `resolved` fires, then queued clean-cache callbacks run. */
  resolve(): void {
    this.clean = true;
    this.trigger("resolved");
    for (const callback of this.#cleanCallbacks.splice(0)) callback();
  }

  /** Call each listener of `name`, in registration order. */
  trigger(name: string, ...args: unknown[]): void {
    for (const callback of this.#listeners.get(name) ?? [])
      callback(...args);
  }
}
