// The worker adapter's lifetime: degraded on a worker death, a new worker on Refresh, termination on scope end.
import { Deferred, Effect, Layer, Stream } from "effect";
import type { Scope } from "effect";
import { describe, expect, it } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import { layerRcRef } from "./connection";
import { makeInProcessClient } from "./in-process";
import type { ZoteroReadsClient } from "./in-process";
import { DbUnavailable } from "./rpc";
import type { ChangeEvent } from "./rpc";
import { makeWorkerReads } from "./worker-host";
import type { WorkerConnection } from "./worker-host";

/**
 * Stand-in workers: each connection serves the handler layer in process over
 * a fresh `:memory:` database whose library 1 reports the worker's number.
 * `kill(n)` raises worker #n's error event; `ended(n)` tells whether its
 * scope (the real adapter terminates the worker there) has closed.
 */
function fakeWorkers(options: { failStart?: (n: number) => boolean } = {}) {
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
      const client = yield* makeInProcessClient().pipe(
        Effect.provideContext(context),
      );
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

const workerSeen = (reads: ZoteroReadsClient) =>
  Effect.map(
    reads.Libraries({}),
    (libraries) => libraries.find((l) => l.libraryID === 1)!.version,
  );

/** Pull change events until one tagged `tag` arrives. */
const until = (
  pull: Effect.Effect<readonly ChangeEvent[], unknown>,
  tag: ChangeEvent["_tag"],
) =>
  Effect.gen(function* () {
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
