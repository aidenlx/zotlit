// The worker adapter's lifetime: degraded on a worker death, a new worker on Refresh, termination on scope end.
import {
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Queue,
  Scope,
  Stream,
} from "effect";
import type { Duration } from "effect";
import { TestClock } from "effect/testing";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import { ZOTERO_DB_READ_PARENT_DIRNAME } from "@/lib/constants";
import type { EffectiveReadMode } from "@/services/database/read-source";

import { layerRcRef } from "./connection";
import { makeInProcessClient } from "./in-process";
import type { ZoteroReadsClient } from "./in-process";
import { DbUnavailable } from "./rpc";
import type { ChangeEvent, ReadsConfig } from "./rpc";
import { ZoteroReadsService } from "./service";
import { connectWorker, makeWorkerReads } from "./worker-host";
import type { WorkerConnection } from "./worker-host";
import { WORKER_CLOSED } from "./worker-signal";

/**
 * Stand-in workers: each connection serves the handler layer in process over
 * a fresh `:memory:` database whose library 1 reports the worker's number.
 * `kill(n)` raises worker #n's error event; `cut(n, how)` makes its
 * `Changes` feed fail or end, as a transport gone with no error event.
 * `ended(n)` tells whether its scope (the real adapter terminates the worker
 * there) has closed; `abandoned(n)` whether its close wait was skipped.
 */
function fakeWorkers(
  options: {
    failStart?: (n: number) => boolean;
    hangStart?: (n: number) => boolean;
    /** The Read Mode worker #n's connections open with. */
    readMode?: (n: number) => EffectiveReadMode;
    /**
     * How many pings worker #n leaves unanswered before it answers again;
     * `Infinity` is a worker stuck in a loop.
     */
    unanswered?: (n: number) => number;
    /**
     * How long worker #n's scope waits for its graceful close, as a worker
     * that never confirms it; an abandoned worker skips the wait.
     */
    closeWait?: (n: number) => Duration.Input | undefined;
  } = {},
) {
  let spawned = 0;
  const deaths = new Map<number, Deferred.Deferred<DbUnavailable>>();
  const cuts = new Map<number, Deferred.Deferred<void, Error>>();
  const ended = new Set<number>();
  const abandoned = new Set<number>();
  const connect: Effect.Effect<WorkerConnection, DbUnavailable, Scope.Scope> =
    Effect.gen(function* () {
      const n = ++spawned;
      yield* Effect.addFinalizer(() => {
        const wait = abandoned.has(n) ? undefined : options.closeWait?.(n);
        return Effect.andThen(
          wait === undefined ? Effect.void : Effect.sleep(wait),
          Effect.sync(() => ended.add(n)),
        );
      });
      if (options.failStart?.(n)) {
        return yield* new DbUnavailable({
          message: `worker #${n} did not start`,
        });
      }
      if (options.hangStart?.(n)) return yield* Effect.never;
      const context = yield* Layer.build(
        layerRcRef(() => {
          const client = createClient(":memory:");
          createFixtureSchema(client.$client);
          client.$client.exec(
            `insert into libraries (libraryID, type, version, clientVersion) values (1, 'user', ${n}, 0)`,
          );
          return client;
        }),
      );
      const served = yield* makeInProcessClient().pipe(
        Effect.provideContext(context),
      );
      const mode = options.readMode?.(n);
      const answering: ZoteroReadsClient = mode
        ? {
            ...served,
            Changes: ((...args: Parameters<typeof served.Changes>) =>
              Stream.map(
                served.Changes(...args) as Stream.Stream<ChangeEvent, unknown>,
                (event) =>
                  event._tag === "changed" ||
                  (event._tag === "state" && event.state === "ready")
                    ? { ...event, readMode: mode }
                    : event,
              )) as typeof served.Changes,
          }
        : served;
      const cut = yield* Deferred.make<void, Error>();
      cuts.set(n, cut);
      let missed = 0;
      const client: ZoteroReadsClient = {
        ...answering,
        Changes: ((...args: Parameters<typeof answering.Changes>) =>
          Stream.interruptWhen(
            answering.Changes(...args) as Stream.Stream<ChangeEvent, unknown>,
            Deferred.await(cut),
          )) as typeof answering.Changes,
        Ping: ((...args: Parameters<typeof answering.Ping>) =>
          missed++ < (options.unanswered?.(n) ?? 0)
            ? Effect.never
            : answering.Ping(...args)) as typeof answering.Ping,
      };
      const died = yield* Deferred.make<DbUnavailable>();
      deaths.set(n, died);
      return {
        client,
        died: Deferred.await(died),
        abandon: Effect.sync(() => abandoned.add(n)),
      };
    });
  return {
    connect,
    spawned: () => spawned,
    cut: (n: number, how: "fails" | "ends") =>
      how === "fails"
        ? Deferred.fail(cuts.get(n)!, new Error(`worker #${n} port closed`))
        : Deferred.succeed(cuts.get(n)!, undefined),
    abandoned: (n: number) => abandoned.has(n),
    kill: (n: number) =>
      Deferred.succeed(
        deaths.get(n)!,
        new DbUnavailable({ message: `worker #${n} crashed` }),
      ),
    ended: (n: number) => ended.has(n),
  };
}

const workerSeen = (reads: Pick<ZoteroReadsClient, "Libraries">) =>
  Effect.map(
    reads.Libraries({}),
    (libraries) => libraries.find((l) => l.libraryID === 1)!.version,
  );

/** Pull change events until one tagged `tag` arrives. */
const until = Effect.fnUntraced(function* (
  pull: Effect.Effect<readonly ChangeEvent[], unknown>,
  tag: ChangeEvent["_tag"],
) {
  const seen: ChangeEvent[] = [];
  while (!seen.some((event) => event._tag === tag)) {
    seen.push(...(yield* Effect.orDie(pull)));
  }
  return seen;
});

describe("ZoteroReads worker adapter", () => {
  it("serves reads from the worker it spawned on creation", async () => {
    const workers = fakeWorkers();
    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        return yield* workerSeen(reads);
      }).pipe(Effect.scoped),
    );
    expect(seen).toBe(1);
    expect(workers.spawned()).toBe(1);
  });

  it("a worker error moves the client to degraded with a tagged error and ends that worker", async () => {
    const workers = fakeWorkers();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        yield* workerSeen(reads);
        const changes = yield* Stream.toPull(reads.Changes());
        yield* workers.kill(1);
        const events = yield* until(changes, "degraded");
        const read = yield* Effect.flip(reads.Libraries({}));
        return { events, read, ended: workers.ended(1) };
      }).pipe(Effect.scoped),
    );
    expect(result.events.at(-1)).toMatchObject({
      _tag: "degraded",
      error: { _tag: "DbUnavailable", message: "worker #1 crashed" },
    });
    expect(result.read).toMatchObject({ _tag: "RpcClientError" });
    expect(result.ended).toBe(true);
  });

  it("answers a stream read asked as a queue from the live worker, and fails it while no worker serves", async () => {
    const workers = fakeWorkers();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        const snapshots = yield* reads.Snapshot(undefined, { asQueue: true });
        const snapshot = yield* Queue.take(snapshots);
        const changes = yield* Stream.toPull(reads.Changes());
        yield* workers.kill(1);
        yield* until(changes, "degraded");
        const failed = yield* Effect.flip(
          reads.Snapshot(undefined, { asQueue: true }),
        );
        return { snapshot, failed };
      }).pipe(Effect.scoped),
    );
    expect(result.snapshot).toEqual(expect.any(String));
    expect(result.failed).toMatchObject({ _tag: "RpcClientError" });
  });

  it("Refresh after a worker death spawns a new worker that serves", async () => {
    const workers = fakeWorkers();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        yield* workerSeen(reads);
        const changes = yield* Stream.toPull(reads.Changes());
        yield* workers.kill(1);
        yield* until(changes, "degraded");

        yield* reads.Refresh();
        const recovered = yield* until(changes, "changed");
        return {
          recovered: recovered.at(-1),
          seen: yield* workerSeen(reads),
        };
      }).pipe(Effect.scoped),
    );
    expect(workers.spawned()).toBe(2);
    expect(result.recovered).toEqual({ _tag: "changed" });
    expect(result.seen).toBe(2);
  });

  it("passes on the Read Mode each worker's connection opened with", async () => {
    const workers = fakeWorkers({
      readMode: (n) => (n === 1 ? "copy" : "immutable"),
    });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        const changes = yield* Stream.toPull(reads.Changes());
        yield* workerSeen(reads);
        const opened = yield* until(changes, "changed");
        const seed = yield* Stream.runHead(reads.Changes());
        yield* workers.kill(1);
        yield* until(changes, "degraded");
        yield* reads.Refresh();
        const recovered = yield* until(changes, "changed");
        return { opened: opened.at(-1), seed, respawned: recovered.at(-1) };
      }).pipe(Effect.scoped),
    );
    expect(result.opened).toEqual({ _tag: "changed", readMode: "copy" });
    expect(Option.getOrThrow(result.seed)).toEqual({
      _tag: "state",
      state: "ready",
      error: null,
      readMode: "copy",
    });
    expect(result.respawned).toEqual({
      _tag: "changed",
      readMode: "immutable",
    });
  });

  it("a worker that stops answering moves the client to degraded, and Refresh spawns a new one", async () => {
    const workers = fakeWorkers({
      unanswered: (n) => (n === 1 ? Infinity : 0),
    });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        yield* workerSeen(reads);
        const seed = Effect.map(
          Stream.runHead(reads.Changes()),
          Option.getOrThrow,
        );
        // The probe asks 10 s after the connect and waits 15 s for the
        // answer, then asks once more and waits 5 s.
        yield* TestClock.adjust("10 seconds");
        yield* TestClock.adjust("15 seconds");
        yield* TestClock.adjust("4999 millis");
        const before = yield* seed;
        yield* TestClock.adjust("1 millis");
        // The death runs on its own fiber once the deadline passed.
        let after = yield* seed;
        const degraded = (event: ChangeEvent) =>
          event._tag === "state" && event.state === "degraded";
        for (let turn = 0; turn < 100 && !degraded(after); turn++) {
          yield* Effect.yieldNow;
          after = yield* seed;
        }
        const read = yield* Effect.flip(reads.Libraries({}));
        const ended = workers.ended(1);
        yield* reads.Refresh();
        return {
          before,
          after,
          read,
          ended,
          abandoned: workers.abandoned(1),
          seen: yield* workerSeen(reads),
        };
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
    );
    expect(result.before).toMatchObject({ _tag: "state", state: "ready" });
    expect(result.after).toMatchObject({
      _tag: "state",
      state: "degraded",
      error: {
        _tag: "DbUnavailable",
        message: "The database worker stopped responding",
      },
    });
    expect(result.read).toMatchObject({ _tag: "RpcClientError" });
    expect(result.ended).toBe(true);
    // A hung worker keeps its transport: it still gets the bounded close.
    expect(result.abandoned).toBe(false);
    expect(result.seen).toBe(2);
  });

  it.each([
    ["fails", "The database worker connection broke"],
    ["ends", "The database worker connection ended"],
  ] as const)(
    "a transport that %s with no error event lets Refresh respawn without the close wait",
    async (how, message) => {
      const workers = fakeWorkers({
        closeWait: (n) => (n === 1 ? "5 seconds" : undefined),
      });
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const reads = yield* makeWorkerReads(workers.connect);
          yield* workerSeen(reads);
          const changes = yield* Stream.toPull(reads.Changes());
          yield* workers.cut(1, how);
          // The death runs on its own fiber; let it start before Refresh.
          for (let turn = 0; turn < 100; turn++) yield* Effect.yieldNow;
          // The clock stands still: a respawn that waits out the close
          // never finishes.
          const refresh = yield* Effect.forkChild(reads.Refresh());
          for (let turn = 0; turn < 100 && !refresh.pollUnsafe(); turn++)
            yield* Effect.yieldNow;
          const exit = refresh.pollUnsafe();
          // Let a pending close run out, so the scope can end.
          if (!exit) yield* TestClock.adjust("5 seconds");
          const events = exit ? yield* until(changes, "changed") : [];
          return {
            exit,
            events,
            ended: workers.ended(1),
            abandoned: workers.abandoned(1),
            seen: exit ? yield* workerSeen(reads) : undefined,
          };
        }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
      );
      expect(result.exit).toMatchObject({ _tag: "Success" });
      expect(result.events).toContainEqual(
        expect.objectContaining({
          error: expect.objectContaining({
            message: expect.stringContaining(message),
          }),
        }),
      );
      expect(result.abandoned).toBe(true);
      expect(result.ended).toBe(true);
      expect(result.seen).toBe(2);
    },
  );

  it("a worker that misses one ping and answers the next stays connected", async () => {
    const workers = fakeWorkers({ unanswered: () => 1 });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        yield* workerSeen(reads);
        // The first ping runs out, as a timer that ran through system sleep.
        yield* TestClock.adjust("10 seconds");
        yield* TestClock.adjust("15 seconds");
        yield* TestClock.adjust("5 seconds");
        return yield* workerSeen(reads);
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
    );
    expect(result).toBe(1);
    expect(workers.spawned()).toBe(1);
  });

  it("a worker that keeps answering stays connected", async () => {
    const workers = fakeWorkers();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        yield* workerSeen(reads);
        // Ten minutes of probes, one probe interval at a time.
        for (let probe = 0; probe < 60; probe++)
          yield* TestClock.adjust("10 seconds");
        return yield* workerSeen(reads);
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
    );
    expect(result).toBe(1);
    expect(workers.spawned()).toBe(1);
  });

  it("a worker that does not start leaves the client degraded until Refresh succeeds", async () => {
    const workers = fakeWorkers({ failStart: (n) => n === 1 });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        const [seed] = yield* Effect.orDie(
          Stream.runHead(reads.Changes()).pipe(Effect.map((o) => [o])),
        );
        const before = yield* Effect.flip(reads.Libraries({}));
        yield* reads.Refresh();
        return { seed, before, after: yield* workerSeen(reads) };
      }).pipe(Effect.scoped),
    );
    expect(result.seed).toMatchObject({
      _tag: "Some",
      value: {
        _tag: "state",
        state: "degraded",
        error: { _tag: "DbUnavailable", message: "worker #1 did not start" },
      },
    });
    expect(result.before).toMatchObject({ _tag: "RpcClientError" });
    expect(result.after).toBe(2);
  });

  it("ends a worker whose start was interrupted", async () => {
    const workers = fakeWorkers({ hangStart: (n) => n === 2 });
    const ended = await Effect.runPromise(
      Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        yield* workerSeen(reads);
        const changes = yield* Stream.toPull(reads.Changes());
        yield* workers.kill(1);
        yield* until(changes, "degraded");

        // The caller gives up on the respawn while worker #2 is starting.
        yield* reads.Refresh().pipe(Effect.timeoutOption("10 millis"));
        return workers.ended(2);
      }).pipe(Effect.scoped),
    );
    expect(workers.spawned()).toBe(2);
    expect(ended).toBe(true);
  });

  it("moves ZoteroReadsService to degraded on a worker error, and refresh() recovers", async () => {
    const workers = fakeWorkers();
    await using service = new ZoteroReadsService({
      client: makeWorkerReads(workers.connect),
    });
    const { reads } = await service.ready;
    await Effect.runPromise(workerSeen(reads));

    const degraded = new Promise<DbUnavailable>((resolve) =>
      service.on("degraded", resolve),
    );
    await Effect.runPromise(workers.kill(1));
    await expect(degraded).resolves.toMatchObject({
      _tag: "DbUnavailable",
      message: "worker #1 crashed",
    });
    expect(service.state).toBe("degraded");

    await service.refresh();
    await vi.waitFor(() => expect(service.state).toBe("ready"));
    await expect(Effect.runPromise(workerSeen(reads))).resolves.toBe(2);
    expect(workers.ended(1)).toBe(true);
  });

  it("reports no degraded ZoteroReadsService when unload ends the worker", async () => {
    const workers = fakeWorkers();
    const service = new ZoteroReadsService({
      client: makeWorkerReads(workers.connect),
    });
    const { reads } = await service.ready;
    await Effect.runPromise(workerSeen(reads));
    await vi.waitFor(() => expect(service.state).toBe("ready"));
    const degraded: DbUnavailable[] = [];
    service.on("degraded", (error) => degraded.push(error));

    await service[Symbol.asyncDispose]();

    expect(workers.ended(1)).toBe(true);
    // A live worker gets its graceful close on unload.
    expect(workers.abandoned(1)).toBe(false);
    expect(degraded).toEqual([]);
    expect(service.state).toBe("ready");
  });

  it("ends the worker when the caller's scope closes", async () => {
    const workers = fakeWorkers();
    await Effect.runPromise(
      Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        yield* workerSeen(reads);
      }).pipe(Effect.scoped),
    );
    expect(workers.ended(1)).toBe(true);
  });
});

/**
 * A stand-in for the browser `Worker`: it signals ready at once, records what
 * the renderer posts, and raises its error event on `crash()`.
 */
class StandInWorker extends EventTarget {
  static spawned: StandInWorker[] = [];
  readonly posted: unknown[] = [];
  terminated = false;
  constructor() {
    super();
    StandInWorker.spawned.push(this);
    queueMicrotask(() =>
      this.dispatchEvent(new MessageEvent("message", { data: [0] })),
    );
  }
  postMessage(data: unknown): void {
    this.posted.push(data);
    // The close message: a live worker removes its snapshots and says so.
    if (Array.isArray(data) && data[0] === 1)
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent("message", { data: WORKER_CLOSED }),
        ),
      );
  }
  terminate(): void {
    this.terminated = true;
  }
  crash(): void {
    this.dispatchEvent(
      Object.assign(new Event("error"), { message: "worker crashed" }),
    );
  }
  /** The snapshot owner tag the renderer sent with this worker's spawn. */
  get snapshotOwner(): string | undefined {
    for (const data of this.posted) {
      const message = (data as [number, { _tag?: string; value?: unknown }])[1];
      if (message?._tag === "InitialMessage")
        return (message.value as { snapshotOwner: string }).snapshotOwner;
    }
    return undefined;
  }
}

const readsConfig = (databasePath: string): ReadsConfig => ({
  databasePath,
  readMode: "auto",
  autoRefresh: true,
  locale: null,
  chineseSegmenter: null,
  logLevel: null,
});

/** Open one connection in its own scope, once its worker got its spawn message. */
const openConnection = Effect.fnUntraced(function* (
  config: Effect.Effect<ReadsConfig>,
  reapClones: Parameters<typeof connectWorker>[2],
) {
  const scope = yield* Scope.make();
  const connection = yield* Scope.provide(
    connectWorker("", config, reapClones),
    scope,
  );
  const spawned = StandInWorker.spawned.length;
  const worker = yield* Effect.promise(() =>
    vi.waitFor(() => {
      const worker = StandInWorker.spawned[spawned];
      expect(worker?.snapshotOwner).toBeDefined();
      return worker!;
    }),
  );
  return { scope, connection, worker, owner: worker.snapshotOwner! };
});

describe("connectWorker read snapshot cleanup", () => {
  beforeEach(() => {
    StandInWorker.spawned = [];
    vi.stubGlobal("Worker", StandInWorker);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reaps a crashed worker's snapshots once it is terminated, under its tag and each database path it read", async () => {
    let terminatedAtReap: boolean | undefined;
    const reap = vi.fn(async () => {
      terminatedAtReap = StandInWorker.spawned[0]!.terminated;
    });
    let databasePath = join("zotero", "zotero.sqlite");
    const config = Effect.sync(() => readsConfig(databasePath));

    const owner = await Effect.runPromise(
      Effect.gen(function* () {
        const { scope, connection, worker, owner } = yield* openConnection(
          config,
          reap,
        );
        databasePath = join("moved", "zotero.sqlite");
        worker.crash();
        yield* connection.died;
        expect(reap).not.toHaveBeenCalled();
        yield* Scope.close(scope, Exit.void);
        return owner;
      }),
    );

    expect(owner).toMatch(/^[0-9a-f]+$/);
    expect(terminatedAtReap).toBe(true);
    expect(reap).toHaveBeenCalledExactlyOnceWith({
      owner,
      parents: [
        tmpdir(),
        join("zotero", ZOTERO_DB_READ_PARENT_DIRNAME),
        join("moved", ZOTERO_DB_READ_PARENT_DIRNAME),
      ],
    });
  });

  it("tags each connection apart, so a dead worker's reap spares the live one's snapshots", async () => {
    const reap = vi.fn(async (_options: { owner: string }) => {});
    const config = Effect.succeed(readsConfig("zotero.sqlite"));

    const [dead, live] = await Effect.runPromise(
      Effect.gen(function* () {
        const dead = yield* openConnection(config, reap);
        dead.worker.crash();
        yield* Scope.close(dead.scope, Exit.void);
        const live = yield* openConnection(config, reap);
        yield* Scope.close(live.scope, Exit.void);
        return [dead.owner, live.owner];
      }),
    );

    expect(dead).not.toBe(live);
    expect(reap.mock.calls.map(([options]) => options.owner)).toEqual([
      dead,
      live,
    ]);
  });

  it("closes without waiting on a reap that never settles", async () => {
    const reap = vi.fn(() => new Promise<void>(() => {}));
    const config = Effect.succeed(readsConfig("zotero.sqlite"));

    await Effect.runPromise(
      Effect.gen(function* () {
        const { scope, worker } = yield* openConnection(config, reap);
        worker.crash();
        yield* Scope.close(scope, Exit.void);
      }),
    );

    expect(reap).toHaveBeenCalledOnce();
  });
});
