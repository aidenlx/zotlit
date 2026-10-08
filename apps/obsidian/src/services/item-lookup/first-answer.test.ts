import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FirstAnswerGate, LOADING_REVEAL_MS } from "./first-answer";

function setup() {
  const calls: string[] = [];
  const gate = new FirstAnswerGate({
    hide: () => calls.push("hide"),
    reveal: () => calls.push("reveal"),
    showLoading: () => calls.push("loading"),
  });
  return { calls, gate };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("FirstAnswerGate", () => {
  it("shows the modal with its rows when the answer comes before the limit", async () => {
    const { calls, gate } = setup();
    gate.open();
    const answer = Promise.withResolvers<string[]>();
    const tracked = gate.track(answer.promise);
    await vi.advanceTimersByTimeAsync(LOADING_REVEAL_MS - 1);
    expect(calls).toEqual(["hide"]);

    answer.resolve(["a"]);
    await expect(tracked).resolves.toEqual(["a"]);
    expect(calls).toEqual(["hide", "reveal"]);

    await vi.advanceTimersByTimeAsync(LOADING_REVEAL_MS);
    expect(calls).toEqual(["hide", "reveal"]);
  });

  it("shows the loading row at the limit when the answer is slow", async () => {
    const { calls, gate } = setup();
    gate.open();
    const answer = Promise.withResolvers<string[]>();
    const tracked = gate.track(answer.promise);
    await vi.advanceTimersByTimeAsync(LOADING_REVEAL_MS);
    expect(calls).toEqual(["hide", "loading", "reveal"]);

    answer.resolve(["a"]);
    await expect(tracked).resolves.toEqual(["a"]);
    expect(calls).toEqual(["hide", "loading", "reveal"]);
  });

  it("keeps the loading row while the reader types, until any answer settles", async () => {
    const { calls, gate } = setup();
    gate.open();
    const first = Promise.withResolvers<string[]>();
    void gate.track(first.promise);
    const second = Promise.withResolvers<string[]>();
    const tracked = gate.track(second.promise);
    await vi.advanceTimersByTimeAsync(LOADING_REVEAL_MS);
    const third = Promise.withResolvers<string[]>();
    void gate.track(third.promise);
    expect(calls).toEqual(["hide", "loading", "reveal"]);

    second.resolve(["b"]);
    await expect(tracked).resolves.toEqual(["b"]);
    first.resolve(["a"]);
    third.resolve(["c"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["hide", "loading", "reveal"]);
  });

  it("shows the modal at once for a synchronous answer", async () => {
    const { calls, gate } = setup();
    gate.open();
    expect(gate.track(["a"])).toEqual(["a"]);
    expect(calls).toEqual(["hide", "reveal"]);

    await vi.advanceTimersByTimeAsync(LOADING_REVEAL_MS);
    expect(calls).toEqual(["hide", "reveal"]);
  });

  it("shows the modal when the answer fails, and keeps the failure", async () => {
    const { calls, gate } = setup();
    gate.open();
    const failure = new Error("boom");
    const tracked = gate.track(Promise.reject(failure));
    await expect(tracked).rejects.toBe(failure);
    expect(calls).toEqual(["hide", "reveal"]);
  });

  it("shows no loading row after the modal closes", async () => {
    const { calls, gate } = setup();
    gate.open();
    void gate.track(new Promise<string[]>(() => {}));
    gate.close();
    await vi.advanceTimersByTimeAsync(LOADING_REVEAL_MS);
    expect(calls).toEqual(["hide"]);
  });

  it("leaves the modal as it is for answers after the first", async () => {
    const { calls, gate } = setup();
    gate.open();
    await gate.track(Promise.resolve(["a"]));
    await gate.track(Promise.resolve(["b"]));
    expect(gate.track(["c"])).toEqual(["c"]);
    expect(calls).toEqual(["hide", "reveal"]);
  });

  it("waits for the first answer again on each open", async () => {
    const { calls, gate } = setup();
    gate.open();
    await gate.track(Promise.resolve(["a"]));
    gate.close();

    gate.open();
    void gate.track(new Promise<string[]>(() => {}));
    await vi.advanceTimersByTimeAsync(LOADING_REVEAL_MS);
    expect(calls).toEqual(["hide", "reveal", "hide", "loading", "reveal"]);
  });
});
