import { it } from "@effect/vitest";
import type { QueryKey } from "@tanstack/query-core";
import { Effect } from "effect";
import { describe, expect, vi } from "vitest";

import { queryClientsOf } from "./__fixtures__";
import type { Held } from "./service";

const KEY: QueryKey = ["read", "a"];
const PREFIX: QueryKey = ["read"];

describe("QueryClients", () => {
  it.effect("joins one first read and reports its commit", () =>
    Effect.gen(function* () {
      const queries = yield* queryClientsOf();
      yield* Effect.promise(async () => {
        const gate = Promise.withResolvers<string>();
        const read = vi.fn(() => gate.promise);
        const events: string[] = [];
        queries.watch(PREFIX, {
          changed: (key) => events.push(`changed:${String(key[1])}`),
          settled: (key) => events.push(`settled:${String(key[1])}`),
        });

        const first = queries.ask(KEY, read);
        const joined = queries.ask(KEY, read);
        expect(queries.peek(KEY)).toBeNull();
        gate.resolve("A");

        expect(await first).toBe("A");
        expect(await joined).toBe("A");
        expect(queries.peek(KEY)).toMatchObject({
          value: "A",
          status: "fresh",
        });
        expect(read).toHaveBeenCalledOnce();
        expect(events).toEqual(["changed:a", "settled:a"]);
      });
    }),
  );

  it.effect("names every key under a prefix that holds a read", () =>
    Effect.gen(function* () {
      const queries = yield* queryClientsOf();
      yield* Effect.promise(async () => {
        await queries.ask(KEY, () => Promise.resolve("A"));
        await queries.ask(["read", "b"], () => Promise.resolve("B"));
        await queries.ask(["other", "c"], () => Promise.resolve("C"));

        expect(
          queries
            .keysUnder(PREFIX)
            .toSorted((a, b) => a.join().localeCompare(b.join())),
        ).toEqual([
          ["read", "a"],
          ["read", "b"],
        ]);
        expect(queries.keysUnder(["nothing"])).toEqual([]);
      });
    }),
  );

  it.effect("serves the held value while one fresh read replaces it", () =>
    Effect.gen(function* () {
      const queries = yield* queryClientsOf();
      yield* Effect.promise(async () => {
        await queries.ask(KEY, () => Promise.resolve("old"));
        queries.invalidate(KEY);
        const gate = Promise.withResolvers<string>();

        const reading = queries.ask(KEY, () => gate.promise);
        const stale = queries.peek<string>(KEY);
        expect(stale).toMatchObject({ value: "old", status: "revalidating" });

        gate.resolve("new");
        expect(await stale?.settled).toBe("new");
        expect(await reading).toBe("new");
        expect(queries.peek(KEY)).toMatchObject({
          value: "new",
          status: "fresh",
        });
      });
    }),
  );

  it.effect(
    "discards an unsettled first read cancelled before its commit",
    () =>
      Effect.gen(function* () {
        const queries = yield* queryClientsOf();
        yield* Effect.promise(async () => {
          const first = Promise.withResolvers<string>();
          const read = vi
            .fn<() => Promise<string>>()
            .mockReturnValueOnce(first.promise)
            .mockReturnValue(Promise.resolve("new"));
          const superseded = queries.read(KEY, read);

          queries.invalidate(KEY);
          first.resolve("old");

          // The ask the cancellation arms reads what the invalidation asked for.
          expect(await superseded).toBe("new");
          expect(read).toHaveBeenCalledTimes(2);
          expect(queries.peek(KEY)).toMatchObject({
            value: "new",
            status: "fresh",
          });
        });
      }),
  );

  it.effect(
    "answers an ask whose first read was cancelled with the read that replaced it",
    () =>
      Effect.gen(function* () {
        const queries = yield* queryClientsOf();
        yield* Effect.promise(async () => {
          const first = Promise.withResolvers<string>();
          const read = vi
            .fn<() => Promise<string>>()
            .mockReturnValueOnce(first.promise)
            .mockReturnValue(Promise.resolve("new"));
          const superseded = queries.ask(KEY, read);

          queries.invalidate(KEY);
          first.resolve("old");

          // A cancellation is no answer: it never reaches the asker as a failure.
          expect(await superseded).toBe("new");
          expect(read).toHaveBeenCalledTimes(2);
        });
      }),
  );

  it.effect(
    "answers the reader that started a cancelled revalidation with its replacement",
    () =>
      Effect.gen(function* () {
        const queries = yield* queryClientsOf();
        yield* Effect.promise(async () => {
          await queries.ask(KEY, () => Promise.resolve("v1"));
          queries.invalidate(KEY);
          const superseded = Promise.withResolvers<string>();
          const read = vi
            .fn<() => Promise<string>>()
            .mockReturnValueOnce(superseded.promise)
            .mockReturnValue(Promise.resolve("v3"));
          const asking = queries.ask(KEY, read);

          queries.invalidate(KEY);
          superseded.resolve("v2");

          // The reader that started the cancelled read is answered like any joiner:
          // never with the value the invalidation reverted to.
          expect(await asking).toBe("v3");
          expect(read).toHaveBeenCalledTimes(2);
          expect(queries.peek(KEY)).toMatchObject({
            value: "v3",
            status: "fresh",
          });
        });
      }),
  );

  it.effect(
    "ends the failure cooldown when an invalidation says the inputs moved",
    () =>
      Effect.gen(function* () {
        const queries = yield* queryClientsOf();
        yield* Effect.promise(async () => {
          const failing = vi.fn(() => Promise.reject(new Error("unreadable")));
          expect(await queries.ask(KEY, failing)).toBeNull();

          queries.invalidate(KEY);

          // Inside the cooldown window, but the drop is what rearms the key.
          expect(await queries.ask(KEY, () => Promise.resolve("new"))).toBe(
            "new",
          );
          expect(queries.peek(KEY)).toMatchObject({
            value: "new",
            status: "fresh",
          });
        });
      }),
  );

  it.effect(
    "answers a read the client released with nothing, reading once",
    () =>
      Effect.gen(function* () {
        const queries = yield* queryClientsOf();
        yield* Effect.promise(async () => {
          const gate = Promise.withResolvers<string>();
          const read = vi.fn(() => gate.promise);

          const reading = queries.read(KEY, read);
          await queries[Symbol.asyncDispose]();
          gate.resolve("released");

          // Disposal cancels the read silently: nothing asks the released client again.
          expect(await reading).toBeNull();
          expect(read).toHaveBeenCalledOnce();
        });
      }),
  );

  it.effect(
    "keeps a failed replacement as the held value and re-reads after the cooldown",
    () =>
      Effect.gen(function* () {
        const queries = yield* queryClientsOf();
        yield* Effect.promise(async () => {
          await queries.ask(KEY, () => Promise.resolve("old"));
          queries.invalidate(KEY);
          const failing = vi.fn(() => Promise.reject(new Error("unreadable")));

          expect(await queries.ask(KEY, failing)).toBeNull();
          expect(queries.peek(KEY)).toMatchObject({
            value: "old",
            status: "failed",
          });
          // A read answers the caller with what the key still holds.
          expect(await queries.read(KEY, failing)).toBe("old");

          // Inside the cooldown the held value answers and nothing is read again.
          expect(await queries.ask(KEY, failing)).toBe("old");
          expect(failing).toHaveBeenCalledOnce();

          await queries.passCooldown();
          expect(await queries.ask(KEY, () => Promise.resolve("new"))).toBe(
            "new",
          );
          expect(queries.peek(KEY)).toMatchObject({
            value: "new",
            status: "fresh",
          });
        });
      }),
  );

  it.effect.each(["remove", "dispose"] as const)(
    "keeps a cancelled read released after %s",
    (release) =>
      Effect.gen(function* () {
        const queries = yield* queryClientsOf();
        yield* Effect.promise(async () => {
          const gate = Promise.withResolvers<string>();
          const read = vi.fn(() => gate.promise);
          const reading = queries.read(KEY, read);

          queries.invalidate(KEY);
          if (release === "dispose") await queries[Symbol.asyncDispose]();
          else queries.client.removeQueries({ queryKey: KEY });
          gate.resolve("released");

          expect(await reading).toBeNull();
          expect(read).toHaveBeenCalledOnce();
          expect(queries.peek(KEY)).toBeNull();
        });
      }),
  );

  it.effect(
    "keeps a released reader separate from a new query with the same key",
    () =>
      Effect.gen(function* () {
        const queries = yield* queryClientsOf();
        yield* Effect.promise(async () => {
          const gate = Promise.withResolvers<string>();
          const reading = queries.read(KEY, () => gate.promise);
          queries.invalidate(KEY);
          queries.client.removeQueries({ queryKey: KEY });
          const replacement = queries.read(KEY, () =>
            Promise.resolve("new file"),
          );
          gate.resolve("deleted file");

          expect(await reading).toBeNull();
          expect(await replacement).toBe("new file");
          expect(queries.peek(KEY)?.value).toBe("new file");
        });
      }),
  );

  it.effect(
    "keeps a failed first read pending and reads again after the cooldown",
    () =>
      Effect.gen(function* () {
        const queries = yield* queryClientsOf();
        yield* Effect.promise(async () => {
          const failing = vi.fn(() => Promise.reject(new Error("unreadable")));
          const settlements: (Held<string> | null)[] = [];
          queries.watch<string>(PREFIX, {
            settled: (_key, held) => settlements.push(held),
          });

          expect(await queries.ask(KEY, failing)).toBeNull();
          expect(queries.peek(KEY)).toBeNull();
          expect(settlements).toEqual([null]);

          expect(await queries.ask(KEY, failing)).toBeNull();
          expect(failing).toHaveBeenCalledOnce();

          await queries.passCooldown();
          expect(await queries.ask(KEY, () => Promise.resolve("new"))).toBe(
            "new",
          );
          expect(queries.peek(KEY)).toMatchObject({
            value: "new",
            status: "fresh",
          });
          expect(settlements).toEqual([
            null,
            expect.objectContaining({ value: "new", status: "fresh" }),
          ]);
        });
      }),
  );

  it.effect(
    "shares one failed attempt between display and composing reads",
    () =>
      Effect.gen(function* () {
        const queries = yield* queryClientsOf();
        yield* Effect.promise(async () => {
          await queries.ask(KEY, () => Promise.resolve("old"));
          queries.invalidate(KEY);
          const error = new Error("unreadable");
          const gate = Promise.withResolvers<string>();
          const read = vi.fn(() => gate.promise);
          const composed = queries.readFresh(KEY, read);
          const rejected = expect(composed).rejects.toBe(error);
          const displayed = queries.read(KEY, read);
          gate.reject(error);

          await rejected;
          expect(await displayed).toBe("old");
          await expect(queries.readFresh(KEY, read)).rejects.toBe(error);
          expect(read).toHaveBeenCalledOnce();
          await queries.passCooldown();
          expect(
            await queries.readFresh(KEY, () => Promise.resolve("new")),
          ).toBe("new");
        });
      }),
  );

  it.effect(
    "aborts a composing caller without cancelling the shared read",
    () =>
      Effect.gen(function* () {
        const queries = yield* queryClientsOf();
        yield* Effect.promise(async () => {
          const controller = new AbortController();
          const gate = Promise.withResolvers<string>();
          const read = vi.fn(() => gate.promise);
          const rejected = expect(
            queries.readFresh(KEY, read, controller.signal),
          ).rejects.toMatchObject({ name: "AbortError" });
          const displayed = queries.read(KEY, read);
          controller.abort();
          await rejected;
          gate.resolve("shared");
          expect(await displayed).toBe("shared");
          expect(read).toHaveBeenCalledOnce();
        });
      }),
  );

  it.effect("rejects a composing read when its query is released", () =>
    Effect.gen(function* () {
      const queries = yield* queryClientsOf();
      yield* Effect.promise(async () => {
        const gate = Promise.withResolvers<string>();
        const rejected = expect(
          queries.readFresh(KEY, () => gate.promise),
        ).rejects.toMatchObject({ name: "AbortError" });
        queries.invalidate(KEY);
        queries.client.removeQueries({ queryKey: KEY });
        gate.resolve("released");
        await rejected;
        expect(queries.peek(KEY)).toBeNull();
      });
    }),
  );

  it.effect(
    "keeps the identity of an equal value and reports the settlement alone",
    () =>
      Effect.gen(function* () {
        const queries = yield* queryClientsOf();
        yield* Effect.promise(async () => {
          queries.client.setQueryDefaults(PREFIX, {
            structuralSharing: (held, next) =>
              (held as { text: string } | undefined)?.text ===
              (next as { text: string }).text
                ? held
                : next,
          });
          const first = await queries.ask(KEY, () =>
            Promise.resolve({ text: "same" }),
          );
          const events: string[] = [];
          queries.watch(PREFIX, {
            changed: () => events.push("changed"),
            settled: () => events.push("settled"),
          });

          queries.invalidate(KEY);
          const refreshed = await queries.ask(KEY, () =>
            Promise.resolve({ text: "same" }),
          );

          expect(refreshed).toBe(first);
          expect(queries.peek(KEY)?.value).toBe(first);
          expect(events).toEqual(["settled"]);
        });
      }),
  );

  it.effect(
    "marks every held value stale under one prefix and releases them on disposal",
    () =>
      Effect.gen(function* () {
        const queries = yield* queryClientsOf();
        yield* Effect.promise(async () => {
          const other: QueryKey = ["read", "b"];
          await queries.ask(KEY, () => Promise.resolve("A"));
          await queries.ask(other, () => Promise.resolve("B"));

          queries.invalidate(PREFIX);
          const read = vi.fn(() => Promise.resolve("fresh A"));
          expect(await queries.ask(KEY, read)).toBe("fresh A");
          expect(
            await queries.ask(other, () => Promise.resolve("fresh B")),
          ).toBe("fresh B");
          expect(read).toHaveBeenCalledOnce();

          await queries[Symbol.asyncDispose]();
          expect(queries.peek(KEY)).toBeNull();
          expect(queries.peek(other)).toBeNull();
        });
      }),
  );
});
