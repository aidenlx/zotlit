import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, Queue, Stream } from "effect";
import { expect } from "vitest";

import { subscribe } from "@/lib/effect-stream";

import { readsFixture } from "./__fixtures__";
import { layerRcRef } from "./connection";
import { DbUnavailable } from "./rpc";
import type { ChangeEvent } from "./rpc";
import { inProcessClient, memoryOpener } from "./test-utils";

const versioned = (open: number) => `
  insert into libraries (libraryID, type, version, clientVersion)
    values (1, 'user', ${open}, 0);
`;

it.effect("answers single reads through the unbound interface", () =>
  Effect.gen(function* () {
    const { open } = memoryOpener(versioned);
    const { service, plain } = yield* readsFixture(
      inProcessClient(layerRcRef(open)),
    );
    expect(yield* service.reads.Libraries({})).toMatchObject([
      { libraryID: 1, type: "user" },
    ]);
    yield* Stream.runHead(
      Stream.filter(service.changes, (state) => state.state === "ready"),
    );
    expect(plain.state).toBe("ready");
    expect(plain.error).toBeNull();
  }),
);

it.effect(
  "a snapshot holds one connection across a refresh and releases it on scope close",
  () =>
    Effect.gen(function* () {
      const { open, log } = memoryOpener(versioned);
      const { service } = yield* readsFixture(
        inProcessClient(layerRcRef(open)),
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const reads = yield* service.snapshot;
          yield* service.refresh;
          expect((yield* reads.Libraries({}))[0]!.version).toBe(1);
          expect((yield* service.reads.Libraries({}))[0]!.version).toBe(2);
          expect(log).toEqual(["open #1", "open #2"]);
        }),
      );
      // A round trip fences the server's processing of the released Snapshot.
      yield* service.reads.Libraries({});
      expect(log).toContain("close #1");
    }),
);

it.effect(
  "a failed refresh preserves the serving connection and publishes its error",
  () =>
    Effect.gen(function* () {
      const { open } = memoryOpener((n) => (n === 2 ? null : versioned(n)));
      const { service } = yield* readsFixture(
        inProcessClient(layerRcRef(open)),
      );
      yield* Stream.runHead(
        Stream.filter(service.changes, (state) => state.state === "ready"),
      );
      const failure = yield* Stream.runHead(
        Stream.filter(
          service.events,
          (event) => event._tag === "refresh-failed",
        ),
      ).pipe(Effect.forkChild({ startImmediately: true }));
      expect(Exit.isFailure(yield* Effect.exit(service.refresh))).toBe(true);
      expect(yield* Fiber.join(failure)).toMatchObject({
        value: { _tag: "refresh-failed", error: { _tag: "DbUnavailable" } },
      });
      expect((yield* service.current).state).toBe("ready");
      expect((yield* service.current).error).toBeInstanceOf(DbUnavailable);
      expect((yield* service.reads.Libraries({}))[0]!.version).toBe(1);
    }),
);

it.effect(
  "an unreadable source publishes degraded state and fails a snapshot",
  () =>
    Effect.gen(function* () {
      const { open } = memoryOpener(() => null);
      const { service, plain } = yield* readsFixture(
        inProcessClient(layerRcRef(open)),
      );
      yield* Stream.runHead(
        Stream.filter(service.changes, (state) => state.state === "degraded"),
      );
      expect(plain.state).toBe("degraded");
      expect(plain.error).toBeInstanceOf(DbUnavailable);
      expect(plain.error?.message).toBe("source #1 is not readable");
      expect(
        Exit.isFailure(yield* Effect.exit(Effect.scoped(service.snapshot))),
      ).toBe(true);
    }),
);

it.effect("degrades when the change stream is lost", () =>
  Effect.gen(function* () {
    const { open } = memoryOpener(versioned);
    const { plain } = yield* readsFixture(
      Effect.map(inProcessClient(layerRcRef(open)), (client) => ({
        ...client,
        Changes: ((...args: Parameters<typeof client.Changes>) =>
          Stream.take(
            client.Changes(...args) as Stream.Stream<ChangeEvent>,
            1,
          )) as typeof client.Changes,
      })),
    );
    expect(plain.state).toBe("degraded");
    expect(plain.error).toBeInstanceOf(DbUnavailable);
  }),
);

it.effect("reports the Read Mode of each serving connection", () =>
  Effect.gen(function* () {
    const { open } = memoryOpener(versioned);
    let mode: "copy" | "immutable" = "copy";
    const { service, plain } = yield* readsFixture(
      Effect.map(inProcessClient(layerRcRef(open)), (client) => ({
        ...client,
        Changes: ((...args: Parameters<typeof client.Changes>) =>
          Stream.map(
            client.Changes(...args) as Stream.Stream<ChangeEvent>,
            (event) =>
              event._tag === "changed" ||
              (event._tag === "state" && event.state === "ready")
                ? { ...event, readMode: mode }
                : event,
          )) as typeof client.Changes,
      })),
    );
    yield* Stream.runHead(
      Stream.filter(service.changes, (state) => state.state === "ready"),
    );
    expect(plain.activeReadMode).toBe("copy");
    const changes = yield* Queue.unbounded<string | null>();
    subscribe(plain.runtime, Stream.drop(plain.changes, 1), (next) =>
      Queue.offerUnsafe(changes, next.activeReadMode),
    );
    mode = "immutable";
    yield* service.refresh;
    expect(yield* Queue.take(changes)).toBe("immutable");
  }),
);

it.effect(
  "closes the connection and change streams when the runtime is disposed",
  () =>
    Effect.gen(function* () {
      const { open, log } = memoryOpener(versioned);
      const { service, runtime } = yield* readsFixture(
        inProcessClient(layerRcRef(open)),
      );
      yield* Stream.runHead(
        Stream.filter(service.changes, (state) => state.state === "ready"),
      );
      const listening = yield* Stream.runDrain(service.changes).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* runtime.disposeEffect;
      yield* Fiber.join(listening);
      expect(log).toEqual(["open #1", "close #1"]);
    }),
);
