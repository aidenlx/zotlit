import { TestClock } from "effect/testing";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import { ZOTERO_DB_READ_PARENT_DIRNAME } from "@/lib/constants";
// The worker adapter's lifetime: degraded on a worker death, a new worker on Refresh, termination on scope end.
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Option,
  Queue,
  References,
  Scope,
  Stream,
} from "@/lib/effect";
import type { Duration } from "@/lib/effect";
import { LogCategory } from "@/lib/effect-log";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { subscribe } from "@/lib/effect-stream";
import { it } from "@/lib/effect-vitest";
import type { EffectiveReadMode } from "@/services/database/read-source";

import { readsFixture } from "./__fixtures__";
import { layerRcRef } from "./connection";
import { makeInProcessClient } from "./in-process";
import type { ZoteroReadsClient } from "./in-process";
import { DbUnavailable } from "./rpc";
import type { ChangeEvent, ReadsConfig } from "./rpc";
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
  it.effect("serves reads from the worker it spawned on creation", () =>
    Effect.gen(function* () {
      const workers = fakeWorkers();
      const seen = yield* Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        return yield* workerSeen(reads);
      }).pipe(Effect.scoped);
      expect(seen).toBe(1);
      expect(workers.spawned()).toBe(1);
    }),
  );

  it.effect(
    "a worker error moves the client to degraded with a tagged error and ends that worker",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers();
        const result = yield* Effect.gen(function* () {
          const reads = yield* makeWorkerReads(workers.connect);
          yield* workerSeen(reads);
          const changes = yield* Stream.toPull(reads.Changes());
          yield* workers.kill(1);
          const events = yield* until(changes, "degraded");
          const read = yield* Effect.flip(reads.Libraries({}));
          return { events, read, ended: workers.ended(1) };
        }).pipe(Effect.scoped);
        expect(result.events.at(-1)).toMatchObject({
          _tag: "degraded",
          error: { _tag: "DbUnavailable", message: "worker #1 crashed" },
        });
        expect(result.read).toMatchObject({ _tag: "RpcClientError" });
        expect(result.ended).toBe(true);
      }),
  );

  it.effect(
    "answers a stream read asked as a queue from the live worker, and fails it while no worker serves",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers();
        const result = yield* Effect.gen(function* () {
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
        }).pipe(Effect.scoped);
        expect(result.snapshot).toEqual(expect.any(String));
        expect(result.failed).toMatchObject({ _tag: "RpcClientError" });
      }),
  );

  it.effect(
    "Refresh after a worker death spawns a new worker that serves",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers();
        const result = yield* Effect.gen(function* () {
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
        }).pipe(Effect.scoped);
        expect(workers.spawned()).toBe(2);
        expect(result.recovered).toEqual({ _tag: "changed" });
        expect(result.seen).toBe(2);
      }),
  );

  it.effect(
    "Configure after a worker death reconnects before applying the source",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers();
        const seen = yield* Effect.scoped(
          Effect.gen(function* () {
            const reads = yield* makeWorkerReads(workers.connect);
            yield* workerSeen(reads);
            const changes = yield* Stream.toPull(reads.Changes());
            yield* workers.kill(1);
            yield* until(changes, "degraded");
            yield* reads.Configure({
              databasePath: "/new/zotero.sqlite",
              readMode: "copy",
              autoRefresh: false,
              locale: null,
              chineseSegmenter: null,
              logLevel: null,
            });
            yield* reads.Refresh();
            return yield* workerSeen(reads);
          }),
        );
        expect(seen).toBe(2);
      }),
  );

  it.effect(
    "rejects an old Snapshot after another worker opens a Snapshot",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers();
        const { plain: service } = yield* readsFixture(
          makeWorkerReads(workers.connect),
        );
        const oldLease = yield* acquireAsyncDisposable(
          async () => await service.acquireRead(),
        );
        expect(yield* workerSeen(oldLease.reads)).toBe(1);

        const degraded = Promise.withResolvers<void>();
        const off = subscribe(service.runtime, service["degraded"], () =>
          degraded.resolve(),
        );
        yield* workers.kill(1);
        yield* Effect.promise(() => degraded.promise);
        off();
        yield* Effect.promise(() => service.refresh());

        const newLease = yield* acquireAsyncDisposable(
          async () => await service.acquireRead(),
        );
        expect(yield* workerSeen(newLease.reads)).toBe(2);
        expect(yield* Effect.flip(workerSeen(oldLease.reads))).toMatchObject({
          _tag: "SnapshotExpired",
        });
      }),
  );

  it.effect(
    "passes on the Read Mode each worker's connection opened with",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers({
          readMode: (n) => (n === 1 ? "copy" : "immutable"),
        });
        const result = yield* Effect.gen(function* () {
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
        }).pipe(Effect.scoped);
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
      }),
  );

  it.effect(
    "a worker that stops answering moves the client to degraded, and Refresh spawns a new one",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers({
          unanswered: (n) => (n === 1 ? Infinity : 0),
        });
        const result = yield* Effect.gen(function* () {
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
        }).pipe(Effect.scoped);
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
      }),
  );

  it.effect.each([
    ["fails", "The database worker connection broke"],
    ["ends", "The database worker connection ended"],
  ] as const)(
    "a transport that %s with no error event lets Refresh respawn without the close wait",
    ([how, message]) =>
      Effect.gen(function* () {
        const workers = fakeWorkers({
          closeWait: (n) => (n === 1 ? "5 seconds" : undefined),
        });
        const result = yield* Effect.gen(function* () {
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
        }).pipe(Effect.scoped);
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
      }),
  );

  it.effect(
    "a worker that misses one ping and answers the next stays connected",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers({ unanswered: () => 1 });
        const result = yield* Effect.gen(function* () {
          const reads = yield* makeWorkerReads(workers.connect);
          yield* workerSeen(reads);
          // The first ping runs out, as a timer that ran through system sleep.
          yield* TestClock.adjust("10 seconds");
          yield* TestClock.adjust("15 seconds");
          yield* TestClock.adjust("5 seconds");
          return yield* workerSeen(reads);
        }).pipe(Effect.scoped);
        expect(result).toBe(1);
        expect(workers.spawned()).toBe(1);
      }),
  );

  it.effect("a worker that keeps answering stays connected", () =>
    Effect.gen(function* () {
      const workers = fakeWorkers();
      const result = yield* Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        yield* workerSeen(reads);
        // Ten minutes of probes, one probe interval at a time.
        for (let probe = 0; probe < 60; probe++)
          yield* TestClock.adjust("10 seconds");
        return yield* workerSeen(reads);
      }).pipe(Effect.scoped);
      expect(result).toBe(1);
      expect(workers.spawned()).toBe(1);
    }),
  );

  it.effect(
    "a worker that does not start leaves the client degraded until Refresh succeeds",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers({ failStart: (n) => n === 1 });
        const result = yield* Effect.gen(function* () {
          const reads = yield* makeWorkerReads(workers.connect);
          const [seed] = yield* Effect.orDie(
            Stream.runHead(reads.Changes()).pipe(Effect.map((o) => [o])),
          );
          const before = yield* Effect.flip(reads.Libraries({}));
          yield* reads.Refresh();
          return { seed, before, after: yield* workerSeen(reads) };
        }).pipe(Effect.scoped);
        expect(result.seed).toMatchObject({
          _tag: "Some",
          value: {
            _tag: "state",
            state: "degraded",
            error: {
              _tag: "DbUnavailable",
              message: "worker #1 did not start",
            },
          },
        });
        expect(result.before).toMatchObject({ _tag: "RpcClientError" });
        expect(result.after).toBe(2);
      }),
  );

  it.effect("bounds a hung startup, releases it, and recovers on Refresh", () =>
    Effect.gen(function* () {
      const workers = fakeWorkers({ hangStart: (n) => n === 1 });
      const result = yield* Effect.gen(function* () {
        const starting = yield* Effect.forkChild(
          makeWorkerReads(workers.connect),
        );
        yield* TestClock.adjust("15 seconds");
        const exit = yield* Fiber.await(starting);
        if (Exit.isFailure(exit)) return { exit };
        const reads = exit.value;
        const seed = yield* Stream.runHead(reads.Changes());
        const ended = workers.ended(1);
        yield* reads.Refresh();
        return { exit, seed, ended, seen: yield* workerSeen(reads) };
      }).pipe(Effect.scoped);
      expect(result.exit).toMatchObject({ _tag: "Success" });
      expect(result.seed).toMatchObject({
        value: { state: "degraded", error: { _tag: "DbUnavailable" } },
      });
      expect(result.ended).toBe(true);
      expect(result.seen).toBe(2);
    }),
  );

  it.effect(
    "service unload finishes when the initial worker never connects",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers({ hangStart: () => true });
        const opening = yield* Effect.forkChild(
          readsFixture(makeWorkerReads(workers.connect)),
        );
        yield* TestClock.adjust("15 seconds");
        const { plain, runtime } = yield* Fiber.join(opening);
        yield* runtime.disposeEffect;
        yield* runtime.disposeEffect;
        expect(workers.ended(1)).toBe(true);
        expect(plain.state).toBe("degraded");
      }),
  );

  it.effect("ends a worker whose start was interrupted", () =>
    Effect.gen(function* () {
      const workers = fakeWorkers({ hangStart: (n) => n === 2 });
      const ended = yield* Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        yield* workerSeen(reads);
        const changes = yield* Stream.toPull(reads.Changes());
        yield* workers.kill(1);
        yield* until(changes, "degraded");

        // The caller gives up on the respawn while worker #2 is starting.
        const refreshing = yield* reads
          .Refresh()
          .pipe(Effect.timeoutOption("10 millis"), Effect.forkChild);
        yield* TestClock.adjust("10 millis");
        yield* Fiber.join(refreshing);
        return workers.ended(2);
      }).pipe(Effect.scoped);
      expect(workers.spawned()).toBe(2);
      expect(ended).toBe(true);
    }),
  );

  it.effect(
    "moves ZoteroReadsService to degraded on a worker error, and refresh() recovers",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers();
        const { plain: service } = yield* readsFixture(
          makeWorkerReads(workers.connect),
        );
        const { reads } = service;
        yield* workerSeen(reads);

        const degraded = new Promise<DbUnavailable>((resolve) =>
          subscribe(service.runtime, service["degraded"], resolve),
        );
        yield* workers.kill(1);
        yield* Effect.promise(() =>
          expect(degraded).resolves.toMatchObject({
            _tag: "DbUnavailable",
            message: "worker #1 crashed",
          }),
        );
        expect(service.state).toBe("degraded");

        yield* Effect.promise(() => service.refresh());
        yield* Effect.promise(() =>
          vi.waitFor(() => expect(service.state).toBe("ready")),
        );
        expect(yield* workerSeen(reads)).toBe(2);
        expect(workers.ended(1)).toBe(true);
      }),
  );

  it.effect(
    "reports no degraded ZoteroReadsService when unload ends the worker",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers();
        const { plain: service, runtime } = yield* readsFixture(
          makeWorkerReads(workers.connect),
        );
        const { reads } = service;
        yield* workerSeen(reads);
        yield* Effect.promise(() =>
          vi.waitFor(() => expect(service.state).toBe("ready")),
        );
        const degraded: DbUnavailable[] = [];
        subscribe(service.runtime, service["degraded"], (error) =>
          degraded.push(error),
        );

        yield* runtime.disposeEffect;

        expect(workers.ended(1)).toBe(true);
        // A live worker gets its graceful close on unload.
        expect(workers.abandoned(1)).toBe(false);
        expect(degraded).toEqual([]);
        expect(service.state).toBe("ready");
      }),
  );

  it.effect(
    "unload interrupts a hung recovery and repeated unload stays safe",
    () =>
      Effect.gen(function* () {
        const recoveryStarted = Promise.withResolvers<void>();
        const workers = fakeWorkers({
          hangStart: (n) => {
            if (n !== 2) return false;
            recoveryStarted.resolve();
            return true;
          },
        });
        yield* Effect.gen(function* () {
          const scope = yield* Scope.make();
          const reads = yield* Scope.provide(
            makeWorkerReads(workers.connect),
            scope,
          );
          yield* workerSeen(reads);
          const changes = yield* Stream.toPull(reads.Changes());
          yield* workers.kill(1);
          yield* until(changes, "degraded");
          const recovery = yield* Effect.forkChild(reads.Refresh());
          yield* Effect.promise(() => recoveryStarted.promise);
          yield* Scope.close(scope, Exit.void);
          yield* Scope.close(scope, Exit.void);
          const exit = yield* Fiber.await(recovery);
          expect(exit).toMatchObject({ _tag: "Failure" });
          expect(workers.ended(2)).toBe(true);
        }).pipe(Effect.scoped);
      }),
  );

  it.effect(
    "rejects recovery after disposal without starting another worker",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers();
        const result = yield* Effect.gen(function* () {
          const scope = yield* Scope.make();
          const reads = yield* Scope.provide(
            makeWorkerReads(workers.connect),
            scope,
          );
          yield* workerSeen(reads);
          const changes = yield* Stream.toPull(reads.Changes());
          yield* workers.kill(1);
          yield* until(changes, "degraded");
          yield* Scope.close(scope, Exit.void);
          const refreshed = yield* Effect.exit(reads.Refresh());
          yield* Scope.close(scope, Exit.void);
          return refreshed;
        }).pipe(Effect.scoped);
        expect(result).toMatchObject({ _tag: "Failure" });
        expect(workers.spawned()).toBe(1);
      }),
  );

  it.effect("ends the worker when the caller's scope closes", () =>
    Effect.gen(function* () {
      const workers = fakeWorkers();
      yield* Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        yield* workerSeen(reads);
      }).pipe(Effect.scoped);
      expect(workers.ended(1)).toBe(true);
    }),
  );
});

/**
 * A stand-in for the browser `Worker`: it signals ready at once, records what
 * the renderer posts, and raises its error event on `crash()`.
 */
class StandInWorker extends EventTarget {
  static spawned: StandInWorker[] = [];
  /** Whether a worker answers the close message, as a live one does. */
  static answersClose = true;
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
    if (StandInWorker.answersClose && Array.isArray(data) && data[0] === 1)
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
  reapClones: NonNullable<Parameters<typeof connectWorker>[2]>["reapClones"],
) {
  const scope = yield* Scope.make();
  const connection = yield* Scope.provide(
    connectWorker("", config, { reapClones }),
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

describe("connectWorker close", () => {
  const warnings: Array<{
    readonly message: unknown;
    readonly category: readonly string[];
    readonly annotations: Readonly<Record<string, unknown>>;
  }> = [];
  const captureWarnings = Logger.make(({ logLevel, message, fiber }) => {
    if (logLevel !== "Warn") return;
    warnings.push({
      message,
      category: fiber.getRef(LogCategory),
      annotations: fiber.getRef(References.CurrentLogAnnotations),
    });
  });
  beforeEach(() => {
    StandInWorker.spawned = [];
    StandInWorker.answersClose = true;
    vi.stubGlobal("Worker", StandInWorker);
    warnings.length = 0;
  });
  afterEach(() => {
    StandInWorker.answersClose = true;
    vi.unstubAllGlobals();
  });

  /** Close the connection's scope while the clock stands still. */
  const closeOnStillClock = Effect.fnUntraced(function* () {
    const { scope, worker } = yield* openConnection(
      Effect.succeed(readsConfig("zotero.sqlite")),
      () => Effect.void,
    );
    const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void));
    for (let turn = 0; turn < 100 && !closing.pollUnsafe(); turn++)
      yield* Effect.yieldNow;
    return { closing, worker };
  });

  it.effect(
    "terminates a worker once it answers the close message, without waiting or warning",
    () =>
      Effect.gen(function* () {
        const result = yield* Effect.gen(function* () {
          const { closing, worker } = yield* closeOnStillClock();
          return { closed: closing.pollUnsafe() !== undefined, worker };
        }).pipe(Effect.provide(Logger.layer([captureWarnings])));
        expect(result.closed).toBe(true);
        expect(result.worker.terminated).toBe(true);
        expect(warnings).toEqual([]);
      }),
  );

  it.effect(
    "terminates a worker that never answers the close message after the close timeout, and warns",
    () =>
      Effect.gen(function* () {
        StandInWorker.answersClose = false;
        const result = yield* Effect.gen(function* () {
          const { closing, worker } = yield* closeOnStillClock();
          const terminatedBefore = worker.terminated;
          yield* TestClock.adjust("5 seconds");
          yield* Fiber.join(closing);
          return { terminatedBefore, terminated: worker.terminated };
        }).pipe(Effect.provide(Logger.layer([captureWarnings])));
        expect(result).toEqual({ terminatedBefore: false, terminated: true });
        expect(warnings).toEqual([
          expect.objectContaining({
            message: [
              "Database worker did not confirm its close in time; terminating it",
            ],
            category: ["zotero-reads"],
            annotations: { timeout: "5s" },
          }),
        ]);
      }),
  );
});

describe("connectWorker read snapshot cleanup", () => {
  beforeEach(() => {
    StandInWorker.spawned = [];
    vi.stubGlobal("Worker", StandInWorker);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.effect(
    "reaps a crashed worker's snapshots once it is terminated, under its tag and each database path it read",
    () =>
      Effect.gen(function* () {
        let terminatedAtReap: boolean | undefined;
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const completed = yield* Deferred.make<void>();
        const reap = vi.fn(() =>
          Effect.gen(function* () {
            terminatedAtReap = StandInWorker.spawned[0]!.terminated;
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
            yield* Deferred.succeed(completed, undefined);
          }),
        );
        let databasePath = join("zotero", "zotero.sqlite");
        const config = Effect.sync(() => readsConfig(databasePath));

        const owner = yield* Effect.gen(function* () {
          const { scope, connection, worker, owner } = yield* openConnection(
            config,
            reap,
          );
          databasePath = join("moved", "zotero.sqlite");
          worker.crash();
          yield* connection.died;
          expect(reap).not.toHaveBeenCalled();
          yield* Scope.close(scope, Exit.void);
          yield* Deferred.await(started);
          return owner;
        });

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
        expect(Deferred.isDoneUnsafe(completed)).toBe(false);
        const settling = yield* Effect.forkChild(
          Deferred.await(completed).pipe(Effect.timeoutOption("1 second")),
        );
        yield* Deferred.succeed(release, undefined);
        yield* TestClock.adjust("1 second");
        expect(Option.isSome(yield* Fiber.join(settling))).toBe(true);
      }),
  );

  it.effect(
    "tags each connection apart, so a dead worker's reap spares the live one's snapshots",
    () =>
      Effect.gen(function* () {
        const reap = vi.fn((_options: { owner: string }) => Effect.void);
        const config = Effect.succeed(readsConfig("zotero.sqlite"));

        const [dead, live] = yield* Effect.gen(function* () {
          const dead = yield* openConnection(config, reap);
          dead.worker.crash();
          yield* Scope.close(dead.scope, Exit.void);
          const live = yield* openConnection(config, reap);
          yield* Scope.close(live.scope, Exit.void);
          return [dead.owner, live.owner];
        });

        expect(dead).not.toBe(live);
        expect(reap.mock.calls.map(([options]) => options.owner)).toEqual([
          dead,
          live,
        ]);
      }),
  );

  it.effect("closes without waiting on a reap that never settles", () =>
    Effect.gen(function* () {
      const reap = vi.fn(() => Effect.never);
      const config = Effect.succeed(readsConfig("zotero.sqlite"));

      yield* Effect.gen(function* () {
        const { scope, worker } = yield* openConnection(config, reap);
        worker.crash();
        yield* Scope.close(scope, Exit.void);
      });

      expect(reap).toHaveBeenCalledOnce();
    }),
  );
});
