// The metadata cache as a capability tag: the reads ZotLit makes and the
// events it follows, without the Obsidian `App`. Later tags copy its shape;
// policies/events.md (Capability tags) describes it.
import { Context, Effect, Layer } from "effect";
import type { Stream } from "effect";
import type {
  CachedMetadata,
  MetadataCache as ObsidianMetadataCache,
  TFile,
} from "obsidian";

import { ObsidianApp } from "@/lib/obsidian-app";
import { obsidianEventSource } from "@/lib/obsidian-event-source";
import type { ObsidianEventEmitter } from "@/lib/obsidian-event-source";

/** One metadata cache event, tagged with its Obsidian event name. */
export type MetadataEvent =
  /** The file was indexed: its text and its cache entry. */
  | {
      readonly _tag: "changed";
      readonly file: TFile;
      readonly data: string;
      readonly cache: CachedMetadata;
    }
  /** The file was deleted; its last cache entry, if the cache held one. */
  | {
      readonly _tag: "deleted";
      readonly file: TFile;
      readonly prevCache: CachedMetadata | null;
    }
  /** The links of the file were resolved. */
  | { readonly _tag: "resolve"; readonly file: TFile }
  /** Every file's links are resolved. */
  | { readonly _tag: "resolved" };

/** The Obsidian object the tag reads: what `app.metadataCache` gives. */
export type MetadataCacheSource = Pick<
  ObsidianMetadataCache,
  | "getFileCache"
  | "getCache"
  | "getFirstLinkpathDest"
  | "onCleanCache"
  | "resolvedLinks"
> &
  ObsidianEventEmitter;

export interface MetadataCacheShape {
  /** The cache entry of the file now, `null` when the cache holds none. */
  fileCache(file: TFile): Effect.Effect<CachedMetadata | null>;
  /** The cache entry at `path` now, by Obsidian's `getCache`; `null` when the cache holds none. */
  cache(path: string): Effect.Effect<CachedMetadata | null>;
  /**
   * Obsidian's `resolvedLinks` now: for each source path, the count of links
   * to each target path. Obsidian's own object, which it updates in place.
   */
  readonly resolvedLinks: Effect.Effect<
    Readonly<Record<string, Readonly<Record<string, number>>>>
  >;
  /**
   * The file `linkpath` resolves to from the note at `sourcePath`, by
   * Obsidian's `getFirstLinkpathDest`; `null` when no file matches.
   */
  firstLinkpathDest(
    linkpath: string,
    sourcePath: string,
  ): Effect.Effect<TFile | null>;
  /** Each metadata cache event, in Obsidian's order, from when the consumer's Stream starts. */
  readonly changes: Stream.Stream<MetadataEvent>;
  /**
   * Completes once the cache is resolved: at once when it already is, else
   * when the parse queue and the link resolver next go idle. It reads
   * Obsidian's undocumented `onCleanCache`. During startup the cache is empty and reads as
   * resolved until the vault loads, so a consumer that needs every file waits
   * for layout-ready first.
   */
  readonly whenResolved: Effect.Effect<void>;
}

/** The vault's metadata cache. */
export class MetadataCache extends Context.Service<
  MetadataCache,
  MetadataCacheShape
>()("zotlit/obsidian/MetadataCache") {}

/** The metadata cache service over `source`, for the life of the Scope. */
export const makeMetadataCache = Effect.fnUntraced(function* (
  source: MetadataCacheSource,
) {
  const events = yield* obsidianEventSource<MetadataEvent>();
  yield* events.listen(
    source,
    "changed",
    (file: TFile, data: string, cache: CachedMetadata) => ({
      _tag: "changed",
      file,
      data,
      cache,
    }),
  );
  yield* events.listen(
    source,
    "deleted",
    (file: TFile, prevCache: CachedMetadata | null) => ({
      _tag: "deleted",
      file,
      prevCache,
    }),
  );
  yield* events.listen(source, "resolve", (file: TFile) => ({
    _tag: "resolve",
    file,
  }));
  yield* events.listen(source, "resolved", () => ({ _tag: "resolved" }));
  return MetadataCache.of({
    // Untraced: the Note Index reads it per note in a loop over the vault.
    fileCache: Effect.fnUntraced(function* (file) {
      return yield* Effect.sync(() => source.getFileCache(file));
    }),
    // Untraced: the graph reads it per drawn node.
    cache: Effect.fnUntraced(function* (path) {
      return yield* Effect.sync(() => source.getCache(path));
    }),
    resolvedLinks: Effect.sync(() => source.resolvedLinks).pipe(
      Effect.withSpan("MetadataCache.resolvedLinks"),
    ),
    // Untraced: an editor resolves each visible wikilink per decoration build.
    firstLinkpathDest: Effect.fnUntraced(function* (linkpath, sourcePath) {
      return yield* Effect.sync(() =>
        source.getFirstLinkpathDest(linkpath, sourcePath),
      );
    }),
    changes: events.stream,
    whenResolved: whenResolved(source),
  });
});

/**
 * Obsidian's own one-shot (it uses it before rewriting links on rename): it
 * calls back at once when no parse task runs and the resolver queue is idle,
 * else after the next `finished`/`resolved` (Obsidian 1.13.7). The public
 * `resolved` fires only when the resolver queue drains after running, so a
 * vault with no indexable files never emits it.
 */
function whenResolved(source: MetadataCacheSource): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    source.onCleanCache(() => resume(Effect.void));
  });
}

/** The tag over any object of the metadata cache's shape, such as a test host's. */
export const layerMetadataCacheFrom = (
  source: MetadataCacheSource,
): Layer.Layer<MetadataCache> =>
  Layer.effect(MetadataCache, makeMetadataCache(source));

/** The tag over the vault's metadata cache. */
export const layerMetadataCache: Layer.Layer<
  MetadataCache,
  never,
  ObsidianApp
> = Layer.effect(
  MetadataCache,
  Effect.gen(function* () {
    const app = yield* ObsidianApp;
    return yield* makeMetadataCache(app.metadataCache);
  }),
);

/**
 * Obsidian's metadata cache reads over the tag, for plain code that takes
 * them, such as a presentation helper: each call runs the tag's read with
 * `run`, the runner of the caller's layer.
 */
export function metadataCacheReads(
  metadata: Pick<MetadataCacheShape, "fileCache" | "firstLinkpathDest">,
  run: <A>(effect: Effect.Effect<A>) => A,
): Pick<ObsidianMetadataCache, "getFileCache" | "getFirstLinkpathDest"> {
  return {
    getFileCache: (file) => run(metadata.fileCache(file)),
    getFirstLinkpathDest: (linkpath, sourcePath) =>
      run(metadata.firstLinkpathDest(linkpath, sourcePath)),
  };
}
