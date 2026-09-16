import type { QueryKey } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";

import type { Held } from "./service";
import { QueryClientService } from "./service";
import { testClock } from "./test-clock";

const KEY: QueryKey = ["read", "a"];
const PREFIX: QueryKey = ["read"];

/** One service on a clock the test moves, which is what the cooldown reads. */
function openQueries(): QueryClientService & { passCooldown: () => void } {
  const clock = testClock();
  return Object.assign(new QueryClientService({ now: clock.now }), {
    passCooldown: clock.passCooldown,
  });
}

describe("QueryClientService", () => {
  it("joins one first read and reports its commit", async () => {
    await using queries = openQueries();
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
    expect(queries.peek(KEY)).toMatchObject({ value: "A", status: "fresh" });
    expect(read).toHaveBeenCalledOnce();
    expect(events).toEqual(["changed:a", "settled:a"]);
  });

  it("names every key under a prefix that holds a read", async () => {
    await using queries = openQueries();
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

  it("serves the held value while one fresh read replaces it", async () => {
    await using queries = openQueries();
    await queries.ask(KEY, () => Promise.resolve("old"));
    queries.invalidate(KEY);
    const gate = Promise.withResolvers<string>();

    const reading = queries.ask(KEY, () => gate.promise);
    const stale = queries.peek<string>(KEY);
    expect(stale).toMatchObject({ value: "old", status: "revalidating" });

    gate.resolve("new");
    expect(await stale?.settled).toBe("new");
    expect(await reading).toBe("new");
    expect(queries.peek(KEY)).toMatchObject({ value: "new", status: "fresh" });
  });

  it("discards an unsettled first read cancelled before its commit", async () => {
    await using queries = openQueries();
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
    expect(queries.peek(KEY)).toMatchObject({ value: "new", status: "fresh" });
  });

  it("answers an ask whose first read was cancelled with the read that replaced it", async () => {
    await using queries = openQueries();
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

  it("answers the reader that started a cancelled revalidation with its replacement", async () => {
    await using queries = openQueries();
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
    expect(queries.peek(KEY)).toMatchObject({ value: "v3", status: "fresh" });
  });

  it("ends the failure cooldown when an invalidation says the inputs moved", async () => {
    await using queries = openQueries();
    const failing = vi.fn(() => Promise.reject(new Error("unreadable")));
    expect(await queries.ask(KEY, failing)).toBeNull();

    queries.invalidate(KEY);

    // Inside the cooldown window, but the drop is what rearms the key.
    expect(await queries.ask(KEY, () => Promise.resolve("new"))).toBe("new");
    expect(queries.peek(KEY)).toMatchObject({ value: "new", status: "fresh" });
  });

  it("answers a read the client released with nothing, reading once", async () => {
    const queries = openQueries();
    const gate = Promise.withResolvers<string>();
    const read = vi.fn(() => gate.promise);

    const reading = queries.read(KEY, read);
    await queries[Symbol.asyncDispose]();
    gate.resolve("released");

    // Disposal cancels the read silently: nothing asks the released client again.
    expect(await reading).toBeNull();
    expect(read).toHaveBeenCalledOnce();
  });

  it("keeps a failed replacement as the held value and re-reads after the cooldown", async () => {
    await using queries = openQueries();
    await queries.ask(KEY, () => Promise.resolve("old"));
    queries.invalidate(KEY);
    const failing = vi.fn(() => Promise.reject(new Error("unreadable")));

    expect(await queries.ask(KEY, failing)).toBeNull();
    expect(queries.peek(KEY)).toMatchObject({ value: "old", status: "failed" });
    // A read answers the caller with what the key still holds.
    expect(await queries.read(KEY, failing)).toBe("old");

    // Inside the cooldown the held value answers and nothing is read again.
    expect(await queries.ask(KEY, failing)).toBe("old");
    expect(failing).toHaveBeenCalledOnce();

    queries.passCooldown();
    expect(await queries.ask(KEY, () => Promise.resolve("new"))).toBe("new");
    expect(queries.peek(KEY)).toMatchObject({ value: "new", status: "fresh" });
  });

  it("keeps a failed first read pending and reads again after the cooldown", async () => {
    await using queries = openQueries();
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

    queries.passCooldown();
    expect(await queries.ask(KEY, () => Promise.resolve("new"))).toBe("new");
    expect(queries.peek(KEY)).toMatchObject({ value: "new", status: "fresh" });
    expect(settlements).toEqual([
      null,
      expect.objectContaining({ value: "new", status: "fresh" }),
    ]);
  });

  it("keeps the identity of an equal value and reports the settlement alone", async () => {
    await using queries = openQueries();
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
    await queries.ask(KEY, () => Promise.resolve({ text: "same" }));

    expect(queries.peek(KEY)?.value).toBe(first);
    expect(events).toEqual(["settled"]);
  });

  it("marks every held value stale under one prefix and releases them on disposal", async () => {
    const queries = openQueries();
    const other: QueryKey = ["read", "b"];
    await queries.ask(KEY, () => Promise.resolve("A"));
    await queries.ask(other, () => Promise.resolve("B"));

    queries.invalidate(PREFIX);
    const read = vi.fn(() => Promise.resolve("fresh A"));
    expect(await queries.ask(KEY, read)).toBe("fresh A");
    expect(await queries.ask(other, () => Promise.resolve("fresh B"))).toBe(
      "fresh B",
    );
    expect(read).toHaveBeenCalledOnce();

    await queries[Symbol.asyncDispose]();
    expect(queries.peek(KEY)).toBeNull();
    expect(queries.peek(other)).toBeNull();
  });
});
