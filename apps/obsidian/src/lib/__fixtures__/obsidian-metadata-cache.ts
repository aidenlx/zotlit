// An in-memory metadata cache and the MetadataCache test layer over it. The
// shape the other capability tags' test layers copy: the test drives the
// in-memory object; the tag's own `make` runs over it.
import type { App, CachedMetadata, EventRef, TFile } from "obsidian";

import { Layer } from "@/lib/effect";
import { ObsidianApp } from "@/lib/obsidian-app";
import { layerMetadataCacheFrom } from "@/lib/obsidian-metadata-cache";
import type {
  MetadataCache,
  MetadataCacheSource,
} from "@/lib/obsidian-metadata-cache";

type Callback = (...args: unknown[]) => unknown;

/**
 * The cache entries of a test vault, by path, and Obsidian's metadata cache
 * events. A module under test that still reads `app.metadataCache` takes this
 * object, so it reads the same entries as the tag.
 */
export class MemoryMetadataCache implements MetadataCacheSource {
  readonly entries = new Map<string, CachedMetadata>();
  readonly #listeners = new Map<string, Set<Callback>>();

  getFileCache(file: TFile): CachedMetadata | null {
    return this.getCache(file.path);
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
    return { e: this, name, fn: callback } as unknown as EventRef;
  }

  offref(ref: EventRef): void {
    const { name, fn } = ref as unknown as { name: string; fn: Callback };
    this.#listeners.get(name)?.delete(fn);
  }

  /** The listeners registered for `name`. */
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

  /** Every link is resolved: `resolved`. */
  resolve(): void {
    this.trigger("resolved");
  }

  /** Call each listener of `name`, in registration order. */
  trigger(name: string, ...args: unknown[]): void {
    for (const callback of this.#listeners.get(name) ?? [])
      callback(...args);
  }
}

/** The MetadataCache tag over `cache`, an in-memory one by default. */
export function layerMetadataCacheTest(
  cache: MetadataCacheSource = new MemoryMetadataCache(),
): Layer.Layer<MetadataCache> {
  return layerMetadataCacheFrom(cache);
}

/**
 * A test host's `app` and the MetadataCache tag over its `metadataCache`, for
 * a layer that reads both until the other capability tags land.
 */
export function layerHostApp(
  app: App,
): Layer.Layer<ObsidianApp | MetadataCache> {
  return layerMetadataCacheFrom(app.metadataCache).pipe(
    Layer.provideMerge(Layer.succeed(ObsidianApp, app)),
  );
}
