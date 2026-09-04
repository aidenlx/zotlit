import { describe, expect, it, vi } from "vitest";

import { HeldReads } from "./held-reads";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("HeldReads", () => {
  it("holds one first read and reports its commit", async () => {
    const reads = new HeldReads<string>({ limit: 2 });
    const gate = deferred<string | null>();
    const read = vi.fn(() => gate.promise);
    const events: string[] = [];
    reads.on("changed", (key) => events.push(`changed:${key}`));
    reads.on("settled", (key) => events.push(`settled:${key}`));

    const first = reads.read("a", read);
    const joined = reads.read("a", read);
    expect(reads.peek("a")).toBeNull();
    gate.resolve("A");

    const held = await first;
    expect(await joined).toBe(held);
    expect(held).toMatchObject({ value: "A", status: "fresh" });
    expect(read).toHaveBeenCalledOnce();
    expect(events).toEqual(["changed:a", "settled:a"]);
  });

  it("serves a held value while one fresh read replaces it", async () => {
    const reads = new HeldReads<string>({ limit: 2 });
    await reads.read("a", async () => "old");
    reads.invalidate("a");
    const gate = deferred<string | null>();

    const reading = reads.read("a", () => gate.promise);
    const stale = reads.peek("a");
    expect(stale).toMatchObject({ value: "old", status: "revalidating" });
    expect(await reading).toBe(stale);

    gate.resolve("new");
    await stale?.settled;
    expect(reads.peek("a")).toMatchObject({
      value: "new",
      status: "fresh",
    });
  });

  it("discards an unsettled record invalidated before its commit", async () => {
    const reads = new HeldReads<string>({ limit: 2 });
    const first = deferred<string | null>();
    const superseded = reads.read("a", () => first.promise);

    reads.invalidate("a");
    first.resolve("old");

    expect(await superseded).toBeNull();
    expect(reads.peek("a")).toBeNull();
    await expect(reads.read("a", async () => "new")).resolves.toMatchObject({
      value: "new",
    });
  });

  it("re-arms a read invalidated while it revalidates", async () => {
    const reads = new HeldReads<string>({ limit: 2 });
    await reads.read("a", async () => "v1");
    reads.invalidate("a");
    const second = deferred<string | null>();
    await reads.read("a", () => second.promise);

    reads.invalidate("a");
    second.resolve("v2");
    await reads.peek("a")?.settled;
    const third = deferred<string | null>();
    await reads.read("a", () => third.promise);

    expect(reads.peek("a")).toMatchObject({
      value: "v2",
      status: "revalidating",
    });
    third.resolve("v3");
    await reads.peek("a")?.settled;
    expect(reads.peek("a")?.value).toBe("v3");
  });

  it("keeps a failed stale value until invalidation re-arms it", async () => {
    const reads = new HeldReads<string>({ limit: 2 });
    await reads.read("a", async () => "old");
    reads.invalidate("a");
    const failed = vi.fn(async () => null);

    const stale = await reads.read("a", failed);
    await stale?.settled;
    expect(reads.peek("a")).toMatchObject({
      value: "old",
      status: "failed",
    });
    await reads.read("a", failed);
    expect(failed).toHaveBeenCalledOnce();

    reads.invalidate("a");
    await reads.read("a", async () => "new");
    await reads.peek("a")?.settled;
    expect(reads.peek("a")?.value).toBe("new");
  });

  it("keeps a failed first read pending until invalidation re-arms it", async () => {
    const reads = new HeldReads<string>({ limit: 2 });
    const failed = vi.fn(async () => null);

    await expect(reads.read("a", failed)).resolves.toBeNull();
    await expect(reads.read("a", failed)).resolves.toBeNull();
    expect(failed).toHaveBeenCalledOnce();

    reads.invalidate("a");
    await expect(reads.read("a", async () => "new")).resolves.toMatchObject({
      value: "new",
    });
  });

  it("keeps equal value identity and still reports settlement", async () => {
    const reads = new HeldReads<{ text: string }>({
      limit: 2,
      same: (prev, next) => prev.text === next.text,
    });
    const first = await reads.read("a", async () => ({ text: "same" }));
    const events: string[] = [];
    reads.on("changed", () => events.push("changed"));
    reads.on("settled", () => events.push("settled"));

    reads.invalidate("a");
    const carried = await reads.read("a", async () => ({ text: "same" }));
    await carried?.settled;

    expect(reads.peek("a")).toBe(first);
    expect(events).toEqual(["changed", "settled"]);
  });

  it("refreshes recency on peek", async () => {
    const reads = new HeldReads<string>({ limit: 2 });
    await reads.read("a", async () => "A");
    await reads.read("b", async () => "B");
    reads.peek("a");
    await reads.read("c", async () => "C");

    expect(reads.peek("a")?.value).toBe("A");
    expect(reads.peek("b")).toBeNull();
    expect(reads.peek("c")?.value).toBe("C");
  });

  it("marks all held values stale and clears them on disposal", async () => {
    const reads = new HeldReads<string>({ limit: 2 });
    await reads.read("a", async () => "A");
    await reads.read("b", async () => "B");
    let invalidated = 0;
    reads.on("invalidated", () => invalidated++);

    reads.invalidate();
    expect(invalidated).toBe(1);
    await reads.read("a", async () => "fresh A");
    reads[Symbol.dispose]();

    expect(reads.peek("a")).toBeNull();
    expect(reads.peek("b")).toBeNull();
  });
});
