import { expect } from "vitest";

import { Deferred, Effect, Queue, Stream } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { readsFixture } from "./__fixtures__";
import { layerRcRef } from "./connection";
import { inProcessClient, memoryOpener } from "./test-utils";

const seed = (n: number) =>
  `insert into libraries (libraryID, type, version) values (1, 'user', ${n});`;

it.effect(
  "the adapter returns a disposable snapshot lease and a refresh Promise",
  () =>
    Effect.gen(function* () {
      const { open } = memoryOpener(seed);
      const { plain } = yield* readsFixture(inProcessClient(layerRcRef(open)));
      const lease = yield* Effect.acquireRelease(
        Effect.promise(() => plain.acquireRead()),
        (lease) => Effect.promise(() => lease[Symbol.asyncDispose]()),
      );
      const refreshing = plain.refresh();
      expect(refreshing).toBeInstanceOf(Promise);
      yield* Effect.promise(() => refreshing);
      expect((yield* lease.reads.Libraries({}))[0]!.version).toBe(1);
      expect((yield* plain.reads.Libraries({}))[0]!.version).toBe(2);
    }),
);

it.effect("settles pending adapter calls when the runtime closes", () =>
  Effect.gen(function* () {
    const { open } = memoryOpener(seed);
    const refreshing = yield* Deferred.make<void>();
    const borrowing = yield* Deferred.make<void>();
    const { plain, runtime } = yield* readsFixture(
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
    const refresh = plain.refresh();
    const lease = plain.acquireRead();
    const released = expect(lease).rejects.toMatchObject({
      _tag: "DbUnavailable",
    });
    yield* Deferred.await(refreshing);
    yield* Deferred.await(borrowing);
    yield* runtime.disposeEffect;
    yield* Effect.promise(() => refresh);
    yield* Effect.promise(() => released);
  }),
);

// #1705: both state and discrete-event subscriptions must attach synchronously.
it.effect(
  "delivers both immediate refresh requests and their state changes",
  () =>
    Effect.gen(function* () {
      const { open } = memoryOpener(seed);
      const { plain } = yield* readsFixture(inProcessClient(layerRcRef(open)));
      const states = yield* Queue.unbounded<string>();
      const requests: string[] = [];
      const stop = plain.subscribe((next) =>
        Queue.offerUnsafe(states, next.state),
      );
      const stopEvent = plain.on("refresh-requested", () =>
        requests.push("refresh"),
      );
      const first = plain.refresh();
      const second = plain.refresh();
      yield* Effect.promise(() => Promise.all([first, second]));
      expect(yield* Queue.take(states)).toBe("ready");
      expect(yield* Queue.take(states)).toBe("ready");
      expect(requests).toEqual(["refresh", "refresh"]);
      stop();
      stop();
      stopEvent();
      yield* Effect.promise(() => plain.refresh());
      expect(requests).toHaveLength(2);
      expect(Queue.sizeUnsafe(states)).toBe(0);
    }),
);

it.effect(
  "keeps the last state and safe methods after whole-runtime disposal",
  () =>
    Effect.gen(function* () {
      const { open } = memoryOpener(seed);
      const { plain, runtime } = yield* readsFixture(
        inProcessClient(layerRcRef(open)),
      );
      yield* runtime.disposeEffect;
      expect(plain.state).toBe("ready");
      expect(plain.error).toBeNull();
      expect(plain.moved).toBe(false);
      expect(plain.activeReadMode).toBeNull();
      plain.notifyExternalChange();
      yield* Effect.promise(() => plain.refresh());
      yield* Effect.promise(() =>
        expect(plain.acquireRead()).rejects.toMatchObject({
          _tag: "DbUnavailable",
        }),
      );
      const received: unknown[] = [];
      plain.subscribe((state) => received.push(state))();
      plain.on("changed", () => received.push("changed"))();
      expect(received).toEqual([]);
    }),
);
