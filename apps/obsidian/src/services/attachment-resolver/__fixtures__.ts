// The Attachment resolver for real, over an in-process Zotero database seeded
// with the rows a suite names. The resolver's own suite and the opener suites
// build on it, so a lookup answers as the real index answers it. The database
// read is the only seam: it can be held, failed, or left unopened.
import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";

import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import {
  layerQueryClients,
  QueryClients,
} from "@/services/query-client/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import { layerRcRef } from "@/services/zotero-reads/connection";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import { layerZoteroReads, ZoteroReads } from "@/services/zotero-reads/service";
import {
  inProcessClient,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { AttachmentResolver, layerAttachmentResolver } from "./service";

/** The Zotero data directory the seeded `storage:` rows resolve under. */
export const DATA_DIR = "/fixture/zotero-data";

/** Completes on the next `resolutionsChanged`; forked, so it hears what follows. */
export const nextAnnouncement = (
  resolver: Pick<AttachmentResolver["Service"], "resolutionsChanged">,
) =>
  Stream.runHead(resolver.resolutionsChanged).pipe(
    Effect.asVoid,
    Effect.forkScoped({ startImmediately: true }),
  );

export interface ResolverHarnessOptions {
  platform?: NodeJS.Platform;
  baseAttachmentPath?: string | null;
  /** The rows each database open holds, in open order; `null` fails that open. */
  seeds?: (string | null)[];
  /** The rows of the one database open, when `seeds` is not given. */
  rows?: string;
  /** Build the first index before the test runs. @default true */
  prime?: boolean;
}

/** The resolved Zotero paths the resolver reads, as `ZoteroPref` holds them. */
function prefSnapshot(
  dataDir: string,
  baseAttachmentPath: string | null,
): ZoteroPrefSnapshot {
  return {
    state: "ready",
    // A fresh map: a new one is what tells `resolvedChanged` the paths moved.
    prefs: new Map(),
    resolvedProfileDir: null,
    profileDirOverride: null,
    dataDirOverride: null,
    dataDir,
    databasePath: `${dataDir}/zotero.sqlite`,
    sourceId: null,
    baseAttachmentPath,
    httpPort: null,
  };
}

/**
 * A real Attachment resolver over the seeded rows, on a runtime that also
 * carries `context` — a test's `TestClock`, for one. `close` disposes it.
 */
export async function openResolver(
  options: ResolverHarnessOptions,
  context: Context.Context<never> = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  const seeds = options.seeds ?? [options.rows ?? null];
  const { open } = memoryOpener((n) => seeds[n - 1] ?? null);
  let held: PromiseWithResolvers<void> | null = null;
  let reached: PromiseWithResolvers<void> | null = null;
  let failing = false;
  let failures = 0;
  const client = Effect.map(inProcessClient(layerRcRef(open)), (client) => ({
    ...client,
    AttachmentPathIndex: ((
      ...args: Parameters<typeof client.AttachmentPathIndex>
    ) =>
      Stream.unwrap(
        Effect.promise(async () => {
          if (held !== null) {
            reached?.resolve();
            await held.promise;
          }
          if (failing) {
            failures += 1;
            return Stream.fail(
              new DbUnavailable({ message: "the read failed" }),
            ) as Stream.Stream<unknown, unknown>;
          }
          return client.AttachmentPathIndex(...args) as Stream.Stream<
            unknown,
            unknown
          >;
        }),
      )) as typeof client.AttachmentPathIndex,
  }));
  const baseAttachmentPath = options.baseAttachmentPath ?? null;
  const paths = Effect.runSync(
    SubscriptionRef.make(prefSnapshot(DATA_DIR, baseAttachmentPath)),
  );

  const runtime = buildRuntime(
    layerAttachmentResolver({ platform: options.platform ?? "linux" }).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          layerQueryClients,
          layerZoteroReads(client),
          Layer.mock(ZoteroPref, {
            current: SubscriptionRef.get(paths),
            changes: SubscriptionRef.changes(paths),
          }),
        ),
      ),
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  await runtime.context();
  const service = runtime.runSync(AttachmentResolver);
  const reads = runtime.runSync(ZoteroReads);
  const queries = runtime.runSync(QueryClients);
  // These index scenarios start after the first database load has settled.
  await runtime.runPromise(
    Stream.runHead(
      reads.changes.pipe(Stream.filter(({ state }) => state !== "loading")),
    ),
  );
  if (options.prime ?? true)
    await runtime.runPromise(Effect.andThen(service.warm, service.indexed));
  const owned = stack.move();
  return {
    runtime,
    service,
    bridge: effectBridge(runtime),
    reads,
    queries,
    /** Moves the resolved Zotero data directory, as a preference change does. */
    moveDataDir: (dataDir: string) =>
      SubscriptionRef.set(paths, prefSnapshot(dataDir, baseAttachmentPath)),
    /** Makes every later path index read fail, until set back. */
    failReads: (on: boolean) => {
      failing = on;
    },
    /** How many path index reads failed. */
    get failures() {
      return failures;
    },
    /** Holds the next path index read until `release`. */
    gate: () => {
      held = Promise.withResolvers<void>();
      reached = Promise.withResolvers<void>();
      const gated = held;
      return {
        /** Settles once a read waits at the gate. */
        waiting: reached.promise,
        release: () => gated.resolve(),
      };
    },
    close: () => owned.disposeAsync(),
  };
}

export type ResolverHarness = Awaited<ReturnType<typeof openResolver>>;

/** {@link openResolver} on the test's own context, closed with its Scope. */
export const resolverFixture = Effect.fnUntraced(function* (
  options: ResolverHarnessOptions,
) {
  const context = yield* Effect.context<never>();
  return yield* Effect.acquireRelease(
    Effect.promise(() => openResolver(options, context)),
    (harness) => Effect.promise(() => harness.close()),
  );
});

/** {@link openResolver} for a Promise suite, disposed with `stack`. */
export async function resolverHarness(
  stack: AsyncDisposableStack,
  options: ResolverHarnessOptions,
  context?: Context.Context<never>,
): Promise<ResolverHarness> {
  const harness = await openResolver(options, context);
  stack.defer(() => harness.close());
  return harness;
}
