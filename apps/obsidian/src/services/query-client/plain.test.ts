import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { expect } from "vitest";

import { subscribe } from "@/lib/effect-stream";

import { queryClientsFixture, queryClientsOf } from "./__fixtures__";
import type { HeldReadChange } from "./service";

it.effect(
  "keeps a throwing listener subscribed for both immediate settlements (#1705)",
  () =>
    Effect.gen(function* () {
      const queries = yield* queryClientsOf();
      yield* Effect.promise(async () => {
        const seen: HeldReadChange[] = [];
        const delivered = Promise.withResolvers<void>();
        const unsubscribe = subscribe(
          queries.runtime,
          queries.changes,
          (change) => {
            seen.push(change);
            if (seen.length === 1) throw new Error("listener failed");
            if (change.key[0] === "second") delivered.resolve();
          },
        );
        const reads = Promise.all([
          queries.bridge.runPromise(
            queries.read(["first"], () => Promise.resolve("new first")),
          ),
          queries.bridge.runPromise(
            queries.read(["second"], () => Promise.resolve("new second")),
          ),
        ]);
        await reads;
        await delivered.promise;
        unsubscribe();
        expect(seen.map((change) => [change.key, change.held?.value])).toEqual([
          [["first"], "new first"],
          [["second"], "new second"],
        ]);
      });
    }),
);

it.effect("interrupts pending native reads when the runtime closes", () =>
  Effect.gen(function* () {
    const queries = yield* Effect.acquireDisposable(
      Effect.tryPromise(async () => queryClientsFixture()),
    );
    yield* Effect.promise(async () => {
      const gate = Promise.withResolvers<string>();
      const started = Promise.withResolvers<void>();
      const read = () => {
        started.resolve();
        return gate.promise;
      };
      const asking = queries.bridge.runPromiseExit(
        queries.ask(["pending"], read),
      );
      const reading = queries.bridge.runPromiseExit(
        queries.read(["pending"], read),
      );
      const composing = queries.bridge.runPromiseExit(
        queries.readFresh(["pending"], read),
      );
      await started.promise;
      await queries[Symbol.asyncDispose]();
      for (const exit of await Promise.all([asking, reading, composing]))
        expect(Exit.hasInterrupts(exit)).toBe(true);
      gate.resolve("late");
      expect(queries.client.getQueryData(["pending"])).toBeUndefined();
    });
  }),
);

it.effect(
  "keeps released results for calls after runtime disposal (#1705)",
  () =>
    Effect.gen(function* () {
      const queries = yield* Effect.acquireDisposable(
        Effect.tryPromise(async () => queryClientsFixture()),
      );
      yield* Effect.promise(async () => {
        await queries.bridge.runPromise(
          queries.read(["held"], () => Promise.resolve("old")),
        );
        await queries[Symbol.asyncDispose]();
        const read = () => {
          throw new Error("A released read must not run");
        };
        await expect(
          queries.bridge.runPromise(queries.ask(["held"], read)),
        ).resolves.toBeNull();
        await expect(
          queries.bridge.runPromise(queries.read(["held"], read)),
        ).resolves.toBeNull();
        expect(queries.bridge.runSync(queries.peek(["held"]))).toBeNull();
        await expect(
          queries.bridge.runPromise(queries.readFresh(["held"], read)),
        ).rejects.toMatchObject({
          name: "AbortError",
        });
        queries.bridge.runSync(queries.invalidate(["held"]));
        queries.bridge.runSync(queries.update(["held"], read));
        expect(queries.bridge.runSync(queries.keysUnder([]))).toEqual([]);
        queries.bridge.runSync(queries.watch([], { settled: read }))();
        subscribe(queries.runtime, queries.changes, read)();
      });
    }),
);

it.effect(
  "keeps Promise errors and stops a plain subscription on unsubscribe",
  () =>
    Effect.gen(function* () {
      const queries = yield* queryClientsOf();
      yield* Effect.promise(async () => {
        await queries.bridge.runPromise(
          queries.read(["held"], () => Promise.resolve("old")),
        );
        const seen: HeldReadChange[] = [];
        const delivered = Promise.withResolvers<void>();
        const unsubscribe = subscribe(
          queries.runtime,
          queries.changes,
          (change) => {
            seen.push(change);
            delivered.resolve();
          },
        );
        const inline: unknown[] = [];
        const stopWatch = queries.bridge.runSync(
          queries.watch(["held"], {
            settled: (_key, held) => inline.push(held?.value),
          }),
        );
        queries.bridge.runSync(queries.update<string>(["held"], () => "new"));
        expect(inline).toEqual(["new"]);
        stopWatch();
        await delivered.promise;
        unsubscribe();
        queries.bridge.runSync(queries.update<string>(["held"], () => "last"));
        expect(seen.map((change) => change.held?.value)).toEqual(["new"]);
        const error = new Error("unreadable");
        await expect(
          queries.bridge.runPromise(
            queries.readFresh(["failure"], () => Promise.reject(error)),
          ),
        ).rejects.toBe(error);
      });
    }),
);
