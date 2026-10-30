import { it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Queue, Stream } from "effect";
import { expect } from "vitest";

import { subscribe } from "@/lib/effect-stream";
import * as readsEvents from "@/services/zotero-reads/events";

import { readsFixture } from "./__fixtures__";
import { layerRcRef } from "./connection";
import { DbUnavailable } from "./rpc";
import { inProcessClient, memoryOpener } from "./test-utils";

const seed = (n: number) =>
  `insert into libraries (libraryID, type, version) values (1, 'user', ${n});`;

it.effect(
  "a disposable lease keeps its connection across a native refresh",
  () =>
    Effect.gen(function* () {
      const { open } = memoryOpener(seed);
      const { service } = yield* readsFixture(
        inProcessClient(layerRcRef(open)),
      );
      const lease = yield* Effect.acquireDisposable(
        Effect.promise(() => service.acquireRead()),
      );
      yield* service.refresh;
      expect((yield* lease.reads.Libraries({}))[0]!.version).toBe(1);
      expect((yield* service.reads.Libraries({}))[0]!.version).toBe(2);
    }),
);

it.effect(
  "interrupts pending native refreshes and rejects leases when the runtime closes",
  () =>
    Effect.gen(function* () {
      const { open } = memoryOpener(seed);
      const refreshing = yield* Deferred.make<void>();
      const borrowing = yield* Deferred.make<void>();
      const { service, runtime } = yield* readsFixture(
        Effect.map(inProcessClient(layerRcRef(open)), (client) => ({
          ...client,
          Refresh: (() =>
            Deferred.succeed(refreshing, undefined).pipe(
              Effect.andThen(Effect.never),
            )) as typeof client.Refresh,
          Snapshot: (() =>
            Stream.unwrap(
              Deferred.succeed(borrowing, undefined).pipe(
                Effect.andThen(Effect.never),
              ),
            )) as typeof client.Snapshot,
        })),
      );
      const refresh = service.bridge.runPromiseExit(service.refresh);
      const lease = service.acquireRead();
      const released = expect(lease).rejects.toMatchObject({
        _tag: "DbUnavailable",
      });
      yield* Deferred.await(refreshing);
      yield* Deferred.await(borrowing);
      yield* runtime.disposeEffect;
      const exit = yield* Effect.promise(() => refresh);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
        true,
      );
      yield* Effect.promise(() => released);
    }),
);

// #1705: both state and discrete-event subscriptions must attach synchronously.
it.effect("keeps throwing state and event listeners subscribed (#1705)", () =>
  Effect.gen(function* () {
    const { open } = memoryOpener(seed);
    const { service } = yield* readsFixture(inProcessClient(layerRcRef(open)));
    const states = yield* Queue.unbounded<string>();
    const requests: string[] = [];
    let changes = 0;
    const stop = subscribe(
      service.runtime,
      Stream.drop(service.changes, 1),
      (next) => {
        Queue.offerUnsafe(states, next.state);
        if (++changes === 1) throw new Error("state listener failed");
      },
    );
    const stopEvent = subscribe(
      service.runtime,
      readsEvents.refreshRequested(service),
      () => {
        requests.push("refresh");
        if (requests.length === 1) throw new Error("event listener failed");
      },
    );
    const first = service.bridge.runPromise(service.refresh);
    const second = service.bridge.runPromise(service.refresh);
    yield* Effect.promise(() => Promise.all([first, second]));
    expect(yield* Queue.take(states)).toBe("ready");
    expect(yield* Queue.take(states)).toBe("ready");
    expect(requests).toEqual(["refresh", "refresh"]);
    stop();
    stop();
    stopEvent();
    yield* Effect.promise(() => service.bridge.runPromise(service.refresh));
    expect(requests).toHaveLength(2);
    expect(Queue.sizeUnsafe(states)).toBe(0);
  }),
);

it.effect(
  "keeps the last state and leaves closed native operations inert",
  () =>
    Effect.gen(function* () {
      const { open, log } = memoryOpener(seed);
      const { service, runtime } = yield* readsFixture(
        inProcessClient(layerRcRef(open)),
      );
      yield* Stream.runHead(
        Stream.filter(service.changes, (state) => state.state === "ready"),
      );
      yield* runtime.disposeEffect;
      expect(yield* service.current).toMatchObject({
        state: "ready",
        error: null,
        moved: false,
      });
      for (const operation of [service.notifyExternalChange, service.refresh]) {
        expect(yield* Effect.exit(operation)).toEqual(Exit.void);
      }
      yield* Effect.promise(() =>
        expect(service.acquireRead()).rejects.toBeInstanceOf(DbUnavailable),
      );
      const received: unknown[] = [];
      subscribe(service.runtime, Stream.drop(service.changes, 1), (state) =>
        received.push(state),
      )();
      subscribe(service.runtime, readsEvents.changed(service), () =>
        received.push("changed"),
      )();
      expect(received).toEqual([]);
      expect(log).toEqual(["open #1", "close #1"]);
    }),
);
