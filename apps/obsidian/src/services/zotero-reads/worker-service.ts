import { Effect, Exit, Scope, Stream } from "effect";
// Renderer service for the Web Worker adapter: spawns the worker on load, feeds it settings, terminates it on unload.
import type { App } from "obsidian";
import workerSource from "virtual:zotero-reads-worker";

import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import type { ZoteroReadsClient } from "./in-process";
import type { DbUnavailable, ReadsConfig } from "./rpc";
import { connectWorker, makeWorkerReads } from "./worker-host";

const logger = getLogger("zotero-reads");

/**
 * Vault-scoped localStorage key of the dev toggle: `"worker"` runs ZoteroReads
 * on the Web Worker adapter. Anything else leaves the worker unspawned.
 */
export const READS_ADAPTER_STORAGE_KEY = "zotlit-reads-adapter";

export interface ZoteroReadsWorkerDeps {
  settings: SettingsService;
  zoteroPref: ZoteroPrefService;
  storage: Pick<App, "loadLocalStorage">;
}

function readsConfig(
  settings: Readonly<Settings>,
  zoteroPref: ZoteroPrefService,
): ReadsConfig {
  return {
    databasePath: zoteroPref.databasePath,
    readMode: settings["zotero.read-mode"],
    autoRefresh: settings["zotero.auto-refresh"],
  };
}

/**
 * The ZoteroReads Web Worker, owned by the renderer. While the dev toggle is
 * on, it spawns the worker on load with the current settings, pushes every
 * change of the database path, Read Mode, or auto-refresh through
 * `Configure`, and terminates the worker on unload. A worker that dies moves
 * {@link state} to `degraded`; {@link refresh} spawns a new one.
 */
export class ZoteroReadsWorker extends Service<void> {
  readonly #settings;
  readonly #zoteroPref;
  /** Whether the dev toggle asked for the worker this session. */
  readonly enabled: boolean;
  #reads: ZoteroReadsClient | null = null;
  #state: "loading" | "ready" | "degraded" = "loading";
  #error: DbUnavailable | null = null;

  ready: Promise<void>;

  constructor(deps: ZoteroReadsWorkerDeps) {
    super();
    this.#settings = deps.settings;
    this.#zoteroPref = deps.zoteroPref;
    this.enabled =
      deps.storage.loadLocalStorage(READS_ADAPTER_STORAGE_KEY) === "worker";
    this.ready = this.#load();
  }

  /** The worker's client; `null` while the toggle is off or before load. */
  get reads(): ZoteroReadsClient | null {
    return this.#reads;
  }

  get state(): "loading" | "ready" | "degraded" {
    return this.#state;
  }

  get error(): DbUnavailable | null {
    return this.#error;
  }

  /** Refresh the database; spawns a new worker first when the last one died. */
  async refresh(): Promise<void> {
    await this.ready;
    if (!this.#reads) return;
    await Effect.runPromise(this.#reads.Refresh());
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    if (!this.enabled) {
      this.commit(stack.move());
      return;
    }
    await this.#zoteroPref.ready;
    let config = readsConfig(await this.#settings.loaded, this.#zoteroPref);
    logger.info("Starting the ZoteroReads worker (dev toggle)");

    const scope = Effect.runSync(Scope.make());
    stack.defer(() => Effect.runPromise(Scope.close(scope, Exit.void)));
    const reads = await Effect.runPromise(
      makeWorkerReads(
        connectWorker(
          workerSource,
          Effect.sync(() => config),
        ),
      ).pipe(Scope.provide(scope)),
    );
    Effect.runFork(
      Stream.runForEach(reads.Changes(), (event) =>
        Effect.sync(() => {
          switch (event._tag) {
            case "state":
              this.#state = event.state;
              this.#error = event.error;
              break;
            case "changed":
              this.#state = "ready";
              this.#error = null;
              break;
            case "degraded":
              this.#state = "degraded";
              this.#error = event.error;
              break;
          }
        }),
      ).pipe(Effect.ignore, Effect.forkIn(scope)),
    );

    const push = (): void => {
      const settings = this.#settings.current;
      if (!settings) return;
      const next = readsConfig(settings, this.#zoteroPref);
      if (
        next.databasePath === config.databasePath &&
        next.readMode === config.readMode &&
        next.autoRefresh === config.autoRefresh
      )
        return;
      config = next;
      void Effect.runPromise(Effect.ignore(reads.Configure(next)));
    };
    stack.defer(this.#settings.subscribe(push));
    stack.defer(this.#zoteroPref.on("resolved-changed", push));

    this.#reads = reads;
    stack.defer(() => {
      this.#reads = null;
    });
    this.commit(stack.move());
  }
}
