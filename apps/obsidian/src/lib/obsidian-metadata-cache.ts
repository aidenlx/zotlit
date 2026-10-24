// The metadata cache as a capability tag: the reads ZotLit makes and the
// events it follows, without the Obsidian `App`.
//
// The pattern each Obsidian capability tag copies (FileManager, Vault,
// Workspace):
// - Layer shape. `make<Tag>(source)` builds the service over the Obsidian
//   object on the layer's Scope. `layer<Tag>` reads `ObsidianApp` once and
//   passes the object in; `layer<Tag>From(source)` takes any object of the
//   same shape, for a test host.
// - Events. One `obsidianEventSource` (`@/lib/obsidian-event-source`) for the
//   source: one listener per Obsidian event name, registered at build and
//   removed when the layer closes, all publishing one tagged union into one
//   PubSub, so the order across names stays. Consumers narrow `changes` with
//   `filterTag` and handle it with `forkEach` (`@/lib/effect-stream`), which
//   logs a failed handler for each event and keeps the subscription. A view or
//   a legacy service subscribes through the bridge.
// - Reads. A sync Obsidian read is `Effect.sync`; Obsidian values such as
//   `TFile` and `CachedMetadata` stay plain data.
// - Test layer. `src/lib/__fixtures__/obsidian-<tag>.ts` holds an in-memory
//   object of the source shape, which the test drives, and a test layer that
//   runs this same `make<Tag>` over it. A legacy module under test that still
//   reads `app` gets the same object, so both read one store.
import type {
  CachedMetadata,
  MetadataCache as ObsidianMetadataCache,
  TFile,
} from "obsidian";

import { Context, Deferred, Effect, Layer, Stream } from "@/lib/effect";
import { filterTag } from "@/lib/effect-stream";
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
export type MetadataCacheSource = Pick<ObsidianMetadataCache, "getFileCache"> &
  ObsidianEventEmitter;

export interface MetadataCacheShape {
  /** The cache entry of the file now, `null` when the cache holds none. */
  fileCache(file: TFile): Effect.Effect<CachedMetadata | null>;
  /** Each metadata cache event, in Obsidian's order, from when the consumer's Stream starts. */
  readonly changes: Stream.Stream<MetadataEvent>;
  /**
   * Completes at the first `resolved` after the layer starts, or at once
   * after it. It does not complete for a vault where `resolved` never fires
   * after the layer starts (the cache resolved before, and no file changes).
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
  const resolved = yield* Deferred.make<void>();
  // Attach before the listeners, so the first `resolved` cannot pass by.
  yield* filterTag(events.stream, "resolved").pipe(
    Stream.take(1),
    Stream.runDrain,
    Effect.andThen(Deferred.succeed(resolved, undefined)),
    Effect.forkScoped({ startImmediately: true }),
  );
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
    fileCache: (file) => Effect.sync(() => source.getFileCache(file)),
    changes: events.stream,
    whenResolved: Deferred.await(resolved),
  });
});

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
