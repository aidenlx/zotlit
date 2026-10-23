import { expect } from "vitest";

import { Effect } from "@/lib/effect";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { it } from "@/lib/effect-vitest";

import { queryClientsFixture, queryClientsOf } from "./__fixtures__";
import type { HeldReadChange } from "./service";

it.effect(
  "receives both settlements immediately after subscribing (#1705)",
  () =>
    Effect.gen(function* () {
      const queries = yield* queryClientsOf();
      yield* Effect.promise(async () => {
        await queries.read(["first"], () => Promise.resolve("old first"));
        await queries.read(["second"], () => Promise.resolve("old second"));
        const seen: HeldReadChange[] = [];
        const delivered = Promise.withResolvers<void>();
        const unsubscribe = queries.subscribe((change) => {
          seen.push(change);
          if (change.key[0] === "second") delivered.resolve();
        });
        queries.update<string>(["first"], () => "new first");
        queries.update<string>(["second"], () => "new second");
        await delivered.promise;
        unsubscribe();
        expect(seen.map((change) => [change.key, change.held?.value])).toEqual([
          [["first"], "new first"],
          [["second"], "new second"],
        ]);
      });
    }),
);

it.effect("settles pending plain reads when the runtime closes", () =>
  Effect.gen(function* () {
    const queries = yield* acquireAsyncDisposable(async () =>
      queryClientsFixture(),
    );
    yield* Effect.promise(async () => {
      const gate = Promise.withResolvers<string>();
      const started = Promise.withResolvers<void>();
      const read = () => {
        started.resolve();
        return gate.promise;
      };
      const asking = expect(queries.ask(["pending"], read)).resolves.toBeNull();
      const reading = expect(
        queries.read(["pending"], read),
      ).resolves.toBeNull();
      const composing = expect(
        queries.readFresh(["pending"], read),
      ).rejects.toMatchObject({ name: "AbortError" });
      await started.promise;
      await queries[Symbol.asyncDispose]();
      await Promise.all([asking, reading, composing]);
      gate.resolve("late");
      expect(queries.client.getQueryData(["pending"])).toBeUndefined();
    });
  }),
);

it.effect(
  "keeps released results for calls after runtime disposal (#1705)",
  () =>
    Effect.gen(function* () {
      const queries = yield* acquireAsyncDisposable(async () =>
        queryClientsFixture(),
      );
      yield* Effect.promise(async () => {
        await queries.read(["held"], () => Promise.resolve("old"));
        await queries[Symbol.asyncDispose]();
        const read = () => {
          throw new Error("A released read must not run");
        };
        await expect(queries.ask(["held"], read)).resolves.toBeNull();
        await expect(queries.read(["held"], read)).resolves.toBeNull();
        expect(queries.peek(["held"])).toBeNull();
        await expect(queries.readFresh(["held"], read)).rejects.toMatchObject({
          name: "AbortError",
        });
        queries.invalidate(["held"]);
        queries.update(["held"], read);
        expect(queries.keysUnder([])).toEqual([]);
        queries.watch([], { settled: read })();
        queries.subscribe(read)();
      });
    }),
);

it.effect(
  "keeps Promise errors and stops a plain subscription on unsubscribe",
  () =>
    Effect.gen(function* () {
      const queries = yield* queryClientsOf();
      yield* Effect.promise(async () => {
        await queries.read(["held"], () => Promise.resolve("old"));
        const seen: HeldReadChange[] = [];
        const delivered = Promise.withResolvers<void>();
        const unsubscribe = queries.subscribe((change) => {
          seen.push(change);
          delivered.resolve();
        });
        const inline: unknown[] = [];
        const stopWatch = queries.watch(["held"], {
          settled: (_key, held) => inline.push(held?.value),
        });
        queries.update<string>(["held"], () => "new");
        expect(inline).toEqual(["new"]);
        stopWatch();
        await delivered.promise;
        unsubscribe();
        queries.update<string>(["held"], () => "last");
        expect(seen.map((change) => change.held?.value)).toEqual(["new"]);
        const error = new Error("unreadable");
        await expect(
          queries.readFresh(["failure"], () => Promise.reject(error)),
        ).rejects.toBe(error);
      });
    }),
);
