// The worker adapter's lifetime: degraded on a worker death, a new worker on Refresh, termination on scope end.
import { Deferred, Effect, Layer, Option, Stream } from "effect";
import type { Scope } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it, vi } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import type { EffectiveReadMode } from "@/services/database/read-source";

import { layerRcRef } from "./connection";
import { makeInProcessClient } from "./in-process";
import type { ZoteroReadsClient } from "./in-process";
import { DbUnavailable } from "./rpc";
import type { ChangeEvent } from "./rpc";
import { ZoteroReadsService } from "./service";
import { makeWorkerReads } from "./worker-host";
import type { WorkerConnection } from "./worker-host";

/**
 * Stand-in workers: each connection serves the handler layer in process over
 * a fresh `:memory:` database whose library 1 reports the worker's number.
 * `kill(n)` raises worker #n's error event; `ended(n)` tells whether its
 * scope (the real adapter terminates the worker there) has closed.
 */
function fakeWorkers(
  options: {
    failStart?: (n: number) => boolean;
    hangStart?: (n: number) => boolean;
    /** The Read Mode worker #n's connections open with. */
    readMode?: (n: number) => EffectiveReadMode;
    /** Worker #n stops answering, as a worker stuck in a loop would. */
    unresponsive?: (n: number) => boolean;
  } = {},
) {
  let spawned = 0;
  const deaths = new Map<number, Deferred.Deferred<DbUnavailable>>();
  const ended = new Set<number>();
  const connect: Effect.Effect<WorkerConnection, DbUnavailable, Scope.Scope> =
    Effect.gen(function* () {
      const n = ++spawned;
      yield* Effect.addFinalizer(() => Effect.sync(() => ended.add(n)));
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
      const client: ZoteroReadsClient = options.unresponsive?.(n)
        ? { ...answering, Ping: () => Effect.never }
        : answering;
      const died = yield* Deferred.make<DbUnavailable>();
      deaths.set(n, died);
      return { client, died: Deferred.await(died) };
    });
  return {
    connect,
    spawned: () => spawned,
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
    const workers = fakeWorkers({ unresponsive: (n) => n === 1 });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        yield* workerSeen(reads);
        // Step the clock, so each wait the probe starts also runs out.
        for (let step = 0; step < 6; step++)
          yield* TestClock.adjust("10 seconds");
        const seed = yield* Stream.runHead(reads.Changes());
        const read = yield* Effect.flip(reads.Libraries({}));
        const ended = workers.ended(1);
        yield* reads.Refresh();
        return { seed, read, ended, seen: yield* workerSeen(reads) };
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
    );
    expect(Option.getOrThrow(result.seed)).toMatchObject({
      _tag: "state",
      state: "degraded",
      error: {
        _tag: "DbUnavailable",
        message: "The database worker stopped responding",
      },
    });
    expect(result.read).toMatchObject({ _tag: "RpcClientError" });
    expect(result.ended).toBe(true);
    expect(result.seen).toBe(2);
  });

  it("a worker that keeps answering stays connected", async () => {
    const workers = fakeWorkers();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        yield* workerSeen(reads);
        for (let minute = 0; minute < 10; minute++)
          yield* TestClock.adjust("1 minute");
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
