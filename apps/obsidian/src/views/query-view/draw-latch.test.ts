import { describe, expect, it } from "vitest";

import { DrawLatch } from "./draw-latch";

/** Whether `promise` has settled once the queued microtasks ran. */
async function settled(promise: Promise<void>): Promise<boolean> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  return done;
}

describe("DrawLatch", () => {
  it("settles at once when the value drawn last is the current one", async () => {
    const current = ["a"];
    const latch = new DrawLatch(() => current);
    latch.drew(current);
    expect(await settled(latch.drawn())).toBe(true);
  });

  it("waits until the current value is drawn, and settles every wait together", async () => {
    let current = ["a"];
    const latch = new DrawLatch(() => current);
    latch.drew(current);
    current = ["b"];
    const first = latch.drawn();
    const second = latch.drawn();
    expect(await settled(first)).toBe(false);
    latch.drew(current);
    expect([await settled(first), await settled(second)]).toEqual([true, true]);
  });

  it("keeps waiting when an earlier value is drawn", async () => {
    const earlier = ["a"];
    const current = ["b"];
    const latch = new DrawLatch(() => current);
    const wait = latch.drawn();
    latch.drew(earlier);
    expect(await settled(wait)).toBe(false);
  });

  it("settles every wait on release, and again on a second release", async () => {
    const latch = new DrawLatch(() => ["a"]);
    const wait = latch.drawn();
    latch.release();
    latch.release();
    expect(await settled(wait)).toBe(true);
  });
});
