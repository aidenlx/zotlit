/** The native service and lease edge over a test's scoped RPC transport. */
import { Context, Effect, Layer, Stream } from "effect";
import type { ManagedRuntime, Scope } from "effect";
import { RpcSchema } from "effect/rpc";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import type { EffectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";

import type { ZoteroReadsClient } from "./in-process";
import { acquireReadLease } from "./lease";
import { ZoteroReads as ZoteroReadsRpc } from "./rpc";
import { layerZoteroReads, ZoteroReads } from "./service";
import type { ZoteroReadsApi, ZoteroReadLease } from "./service";

export const readsFixture = Effect.fn("readsFixture")(function* (
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
) {
  const context = yield* Effect.context<never>();
  const handle = yield* Effect.acquireRelease(
    Effect.promise(() => openReads(client, context)),
    (handle) => Effect.promise(() => handle.close()),
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
  const bridge = effectBridge(runtime);
  const native = runtime.runSync(ZoteroReads);
  const service = Object.assign(native, {
    runtime,
    bridge,
    acquireRead: () => acquireReadLease(native, bridge),
  });
  const owned = stack.move();
  return { runtime, service, close: () => owned.disposeAsync() };
}

/** Legacy consumer fixtures can construct synchronously; only the test owner awaits ready. */
export type TestReads = ZoteroReads["Service"] &
  AsyncDisposable & {
    runtime: ManagedRuntime.ManagedRuntime<ZoteroReads, never>;
    bridge: EffectBridge;
    acquireRead(): Promise<ZoteroReadLease>;
    ready: Promise<{ reads: ZoteroReadsApi; client: ZoteroReadsApi }>;
  };

export function testReads(
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
): TestReads {
  const stack = new AsyncDisposableStack();
  const runtime = buildRuntime(layerZoteroReads(client), stack);
  let native: ZoteroReads["Service"] | undefined;
  let bridge: EffectBridge;
  const loaded = runtime.context().then(() => {
    bridge = effectBridge(runtime);
    return (native = runtime.runSync(ZoteroReads));
  });
  const service = Effect.promise(() => loaded);
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
        (native) =>
          (
            native.reads[tag as keyof ZoteroReadsApi] as (
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
    current: Effect.suspend(
      () =>
        native?.current ??
        Effect.succeed({
          state: "loading" as const,
          error: null,
          moved: false,
          dbFileMissing: false,
          activeReadMode: null,
        }),
    ),
    snapshot: Effect.flatMap(service, (reads) => reads.snapshot),
    refresh: Effect.flatMap(service, (reads) => reads.refresh),
    notifyExternalChange: Effect.flatMap(
      service,
      (reads) => reads.notifyExternalChange,
    ),
    changes: Stream.unwrap(Effect.map(service, (reads) => reads.changes)),
    events: Stream.unwrap(Effect.map(service, (reads) => reads.events)),
    acquireRead: async () => acquireReadLease(await loaded, bridge),
    get bridge() {
      return bridge;
    },
    runtime,
    [Symbol.asyncDispose]: async () => {
      await loaded;
      await stack.disposeAsync();
    },
  };
}

/** One answer per read a test calls: the read's input in, its result out. */
export type ReadsAnswers = {
  readonly [K in keyof ZoteroReadsApi]?: (
    input: Parameters<ZoteroReadsApi[K]>[0],
  ) => ReturnType<ZoteroReadsApi[K]>;
};

/**
 * A {@link ZoteroReadsApi} that answers the reads in `answers`; any other read
 * throws.
 */
export function readsAnswering(answers: ReadsAnswers): ZoteroReadsApi {
  // The one cast: the RPC client's methods are generic over their call
  // options, which a plain function cannot state. ReadsAnswers checks each
  // answer against its read's input and result.
  return stubService<ZoteroReadsApi>(
    "ZoteroReadsApi",
    answers as Partial<ZoteroReadsApi>,
  );
}
