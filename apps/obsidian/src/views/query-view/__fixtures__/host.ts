// A Query View test registry over in-memory host services and controlled query reads.
import { Effect, Layer, Queue, Stream } from "effect";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { layerUnreadViewServices } from "@/lib/__fixtures__/view-atoms";
import { buildRuntime } from "@/lib/effect-layer";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import type { MetadataEvent } from "@/lib/obsidian-metadata-cache";
import { Vault } from "@/lib/obsidian-vault";
import { makeViewRegistry } from "@/lib/view-atoms";
import { QueryService } from "@/services/item-query/service";
import { DEFAULT_LIBRARY_SCOPE } from "@/services/library-scope/scope";
import { LibraryScope } from "@/services/library-scope/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsEvent } from "@/services/zotero-reads/service";
import { layerAnnotServices } from "@/views/annot-view/__fixtures__/host";
import type { AnnotHostOptions } from "@/views/annot-view/__fixtures__/host";
import type { QueryViewDeps } from "@/views/query-view/view";

export async function makeQueryHost<R = never>(
  deps: Pick<QueryViewDeps, "query" | "reads" | "libraryScope" | "app">,
  options: AnnotHostOptions<R> = {},
) {
  const stack = new AsyncDisposableStack();
  let libraryRevision = 0;
  let querySubscribers = 0;
  const runtime = buildRuntime(
    Layer.mergeAll(
      layerUnreadViewServices,
      layerHost(options.sources),
      layerAnnotServices(options),
      Layer.mock(Vault, {
        changes: Stream.empty,
        getFileByPath: (path) =>
          Effect.sync(() => deps.app.vault.getFileByPath(path)),
      }),
      Layer.mock(MetadataCache, {
        fileCache: (file) =>
          Effect.sync(() => deps.app.metadataCache.getFileCache(file)),
        changes: Stream.callback<MetadataEvent>((queue) =>
          Effect.acquireRelease(
            Effect.sync(() =>
              deps.app.metadataCache.on("changed", (file, data, cache) => {
                Queue.offerUnsafe(queue, {
                  _tag: "changed",
                  file,
                  data,
                  cache,
                });
              }),
            ),
            (ref) => Effect.sync(() => deps.app.metadataCache.offref(ref)),
          ),
        ),
      }),
      Layer.mock(QueryService, {
        run: (request) =>
          Effect.promise((signal) => deps.query.run(request, signal)),
        customFieldNames: Effect.promise((signal) =>
          deps.query.customFieldNames(signal),
        ),
        changed: Stream.callback<void>((queue) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              querySubscribers += 1;
              return deps.query.on("changed", () => {
                Queue.offerUnsafe(queue, undefined);
              });
            }),
            (off) =>
              Effect.sync(() => {
                querySubscribers -= 1;
                off();
              }),
          ),
        ),
      }),
      Layer.mock(ZoteroReads, {
        reads: stubService<ZoteroReads["Service"]["reads"]>(
          "ZoteroReadsApi",
          {},
        ),
        current: Effect.succeed({
          state: "ready" as const,
          error: null,
          moved: false,
          dbFileMissing: false,
          activeReadMode: null,
        }),
        changes: Stream.succeed({
          state: "ready" as const,
          error: null,
          moved: false,
          dbFileMissing: false,
          activeReadMode: null,
        }),
        snapshot: Effect.acquireDisposable(
          Effect.promise(() => deps.reads.acquireRead()),
        ).pipe(Effect.map((lease) => lease.reads)),
        events: Stream.mergeAll(
          [
            Stream.map(deps.reads.changed, (): ZoteroReadsEvent => ({
              _tag: "changed",
            })),
            Stream.map(deps.reads.degraded, (error): ZoteroReadsEvent => ({
              _tag: "degraded",
              error,
            })),
            Stream.map(deps.reads["db-file-missing"], (): ZoteroReadsEvent => ({
              _tag: "db-file-missing",
            })),
          ],
          { concurrency: "unbounded" },
        ),
        ...options.reads,
      }),
      Layer.mock(LibraryScope, {
        current: Effect.sync(() => deps.libraryScope.current),
        changes: Stream.concat(
          Stream.make(null),
          deps.libraryScope["libraries-changed"].pipe(
            Stream.tap(() =>
              Effect.sync(() => {
                libraryRevision += 1;
              }),
            ),
          ),
        ).pipe(
          Stream.map(() => ({
            current: deps.libraryScope.current,
            all: deps.libraryScope.current
              ? {
                  ...deps.libraryScope.current,
                  available: deps.libraryScope.current.available.map(
                    (library) => ({
                      ...library,
                      name:
                        libraryRevision === 0
                          ? library.name
                          : `${library.name ?? "Library"} ${libraryRevision}`,
                    }),
                  ),
                }
              : null,
            invalid: false,
            effective: DEFAULT_LIBRARY_SCOPE,
            libraryRows: null,
          })),
        ),
      }),
      options.services ?? Layer.empty,
    ),
    stack,
  );
  const registry = makeViewRegistry(await runtime.context(), { idleTTL: 0 });
  return {
    registry,
    querySubscribers: () => querySubscribers,
    async [Symbol.asyncDispose]() {
      registry.dispose();
      await stack.disposeAsync();
    },
  };
}
