/** The real service and adapter over a test's scoped RPC transport. */
import { RpcSchema } from "effect/rpc";

import { Context, Effect, Layer, Stream } from "@/lib/effect";
import type { Scope } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";

import type { ZoteroReadsClient } from "./in-process";
import { plainZoteroReads } from "./plain";
import type { PlainZoteroReads } from "./plain";
import { ZoteroReads as ZoteroReadsRpc } from "./rpc";
import { layerZoteroReads, ZoteroReads } from "./service";
import type { ZoteroReadsApi } from "./service";

export const readsFixture = Effect.fn("readsFixture")(function* (
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
) {
  const context = yield* Effect.context<never>();
  const handle = yield* Effect.acquireRelease(
    Effect.promise(() => openReads(client, context)),
    (handle) => Effect.promise(handle.close),
  );
  return handle;
});

async function openReads(
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
  context = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  const runtime = buildRuntime(
    layerZoteroReads(client).pipe(
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  await runtime.context();
  const service = runtime.runSync(ZoteroReads);
  const plain = Object.assign(plainZoteroReads(runtime), { runtime });
  const owned = stack.move();
  return { runtime, service, plain, close: () => owned.disposeAsync() };
}

/** Legacy consumer fixtures can construct synchronously; only the test owner awaits ready. */
export type TestReads = PlainZoteroReads &
  AsyncDisposable & {
    runtime: import("@/lib/effect-stream").SubscriptionRuntime;
    ready: Promise<{ reads: ZoteroReadsApi; client: ZoteroReadsApi }>;
  };

export function testReads(
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
): TestReads {
  const stack = new AsyncDisposableStack();
  const runtime = buildRuntime(layerZoteroReads(client), stack);
  let plain: PlainZoteroReads | undefined;
  const loaded = runtime
    .context()
    .then(
      () => (plain = Object.assign(plainZoteroReads(runtime), { runtime })),
    );
  // Calls made by a consumer during fixture startup wait for the real layer.
  const reads: Record<string, unknown> = {};
  for (const [tag, rpc] of ZoteroReadsRpc.requests) {
    if (
      [
        "Changes",
        "Snapshot",
        "Refresh",
        "NotifyExternalChange",
        "Configure",
        "Ping",
      ].includes(tag)
    )
      continue;
    const invoke = (...args: unknown[]) =>
      Effect.map(
        Effect.promise(() => loaded),
        (adapter) =>
          (
            adapter.reads[tag as keyof ZoteroReadsApi] as (
              ...args: unknown[]
            ) => unknown
          )(...args),
      );
    reads[tag] = RpcSchema.isStreamSchema(rpc.successSchema)
      ? (...args: unknown[]) =>
          Stream.unwrap(
            invoke(...args) as Effect.Effect<Stream.Stream<unknown>>,
          )
      : (...args: unknown[]) =>
          Effect.flatten(
            invoke(...args) as Effect.Effect<Effect.Effect<unknown>>,
          );
  }
  const api = reads as unknown as ZoteroReadsApi;
  return {
    ready: loaded.then(() => ({ reads: api, client: api })),
    reads: api,
    get state() {
      return plain?.state ?? "loading";
    },
    get error() {
      return plain?.error ?? null;
    },
    get moved() {
      return plain?.moved ?? false;
    },
    get dbFileMissing() {
      return plain?.dbFileMissing ?? false;
    },
    get activeReadMode() {
      return plain?.activeReadMode ?? null;
    },
    snapshot: Effect.flatMap(
      Effect.promise(() => loaded),
      (adapter) => adapter.snapshot,
    ),
    acquireRead: async () => (await loaded).acquireRead(),
    refresh: async () => (await loaded).refresh(),
    notifyExternalChange: () => {
      void loaded.then((adapter) => adapter.notifyExternalChange());
    },
    runtime,
    changes: Stream.unwrap(
      Effect.map(
        Effect.promise(() => loaded),
        (adapter) => adapter["changes"],
      ),
    ),
    changed: Stream.unwrap(
      Effect.map(
        Effect.promise(() => loaded),
        (adapter) => adapter["changed"],
      ),
    ),
    degraded: Stream.unwrap(
      Effect.map(
        Effect.promise(() => loaded),
        (adapter) => adapter["degraded"],
      ),
    ),
    "refresh-failed": Stream.unwrap(
      Effect.map(
        Effect.promise(() => loaded),
        (adapter) => adapter["refresh-failed"],
      ),
    ),
    refreshing: Stream.unwrap(
      Effect.map(
        Effect.promise(() => loaded),
        (adapter) => adapter["refreshing"],
      ),
    ),
    "db-file-missing": Stream.unwrap(
      Effect.map(
        Effect.promise(() => loaded),
        (adapter) => adapter["db-file-missing"],
      ),
    ),
    "refresh-requested": Stream.unwrap(
      Effect.map(
        Effect.promise(() => loaded),
        (adapter) => adapter["refresh-requested"],
      ),
    ),
    [Symbol.asyncDispose]: async () => {
      await loaded;
      await stack.disposeAsync();
    },
  };
}
