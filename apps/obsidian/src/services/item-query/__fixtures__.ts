// ZotLit Query built from its layer over a test's reads, for tests outside Effect.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, Layer, Stream } from "effect";

import { layerTestObsidianEnv } from "@/lib/__fixtures__/obsidian-env";
import { effectBridge } from "@/lib/effect-bridge";
import type { EffectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import { settleAtEdge } from "@/lib/signal-edge";
import type { LibraryScope as SavedLibraryScope } from "@/services/library-scope/scope";
import { LibraryScope } from "@/services/library-scope/service";
import { UseLedger } from "@/services/use-ledger/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { bindQuery } from "./handle";
import type { QueryHandle } from "./handle";
import { layerQueryService, QueryService } from "./service";

/** The Zotero source a test's jobs name. */
export interface QuerySource {
  readonly sourceId: string;
  readonly databasePath: string;
  readonly dataDir: string;
  readonly baseAttachmentPath: string | null;
}

export interface QueryFixtureOptions {
  /** The worker operations the jobs go to. */
  readonly reads: ZoteroReads["Service"]["reads"];
  readonly source: QuerySource;
  /** The saved Library Scope of each job; all Libraries where absent. */
  readonly effective?: () => SavedLibraryScope;
  /** The device Uses of each job; none where absent. */
  readonly uses?: Readonly<Record<string, number>>;
  readonly vaultName?: string;
  readonly basePath?: string;
  readonly pluginVersion?: string;
}

function prefSnapshot(source: QuerySource): ZoteroPrefSnapshot {
  return {
    state: "ready",
    prefs: new Map(),
    resolvedProfileDir: null,
    profileDirOverride: null,
    dataDirOverride: null,
    dataDir: source.dataDir,
    databasePath: source.databasePath,
    sourceId: source.sourceId,
    baseAttachmentPath: source.baseAttachmentPath,
    httpPort: null,
  };
}

/** ZotLit Query over `options.reads`, the real file system, and fixed deps. */
export function layerTestQueryService(
  options: QueryFixtureOptions,
  useLedger: Layer.Layer<UseLedger> = Layer.mock(UseLedger, {
    uses: Effect.succeed(options.uses ?? {}),
    changes: Stream.empty,
  }),
): Layer.Layer<QueryService> {
  return layerQueryService({
    pluginVersion: options.pluginVersion ?? "2.2.0",
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ZoteroReads, { reads: options.reads }),
        Layer.mock(ZoteroPref, {
          current: Effect.succeed(prefSnapshot(options.source)),
        }),
        Layer.mock(LibraryScope, {
          effective: Effect.sync(
            (): SavedLibraryScope => options.effective?.() ?? { mode: "all" },
          ),
        }),
        useLedger,
        layerTestObsidianEnv({
          vaultName: options.vaultName,
          basePath: options.basePath,
        }),
        NodeFileSystem.layer,
      ),
    ),
  );
}

/** The built service, its Promise edge, and the runners a test calls it through. */
export interface QueryFixture {
  readonly service: QueryService["Service"];
  readonly handle: QueryHandle;
  readonly bridge: EffectBridge;
  /**
   * One run as Obsidian's CLI makes it: `signal` interrupts it, and a
   * failure rejects with its error. It runs outside the runtime's Scope, so
   * a run after the unload reaches the closed service.
   */
  readonly cli: <A, E>(
    effect: Effect.Effect<A, E, QueryService>,
    signal?: AbortSignal,
  ) => Promise<A>;
}

/** ZotLit Query from {@link layerTestQueryService}; `stack` closes it. */
export async function buildQueryService(
  options: QueryFixtureOptions,
  stack: AsyncDisposableStack,
): Promise<QueryFixture> {
  const runtime = buildRuntime(layerTestQueryService(options), stack);
  const context = await runtime.context();
  const service = runtime.runSync(QueryService);
  const bridge = effectBridge(runtime);
  const runExit = Effect.runPromiseExitWith(context);
  return {
    service,
    handle: bindQuery(bridge, service),
    bridge,
    cli: async (effect, signal = new AbortController().signal) =>
      settleAtEdge(await runExit(effect, { signal }), signal),
  };
}
