import { expect, it, vi } from "vitest";

import { createCompanionRefresh } from "./companion-refresh";

function fakeClock(): Disposable {
  vi.useFakeTimers();
  return { [Symbol.dispose]: () => vi.useRealTimers() };
}

it("retries absent startup status at 1, 2, 4, and 8 seconds, then stops", async () => {
  using _clock = fakeClock();
  const readInstalled = vi.fn(async () => false);
  using refresh = createCompanionRefresh({ readInstalled, publish: vi.fn() });
  await refresh.refresh();
  expect(readInstalled).toHaveBeenCalledTimes(1);
  for (const [index, seconds] of [1, 2, 4, 8].entries()) {
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(seconds * 1000);
    expect(readInstalled).toHaveBeenCalledTimes(index + 2);
  }
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60000);
  expect(readInstalled).toHaveBeenCalledTimes(5);
});

it("ends startup retries on success while keeping later event refreshes available", async () => {
  using _clock = fakeClock();
  const readInstalled = vi.fn(async () => true).mockResolvedValueOnce(false);
  const publish = vi.fn();
  using refresh = createCompanionRefresh({ readInstalled, publish });
  await refresh.refresh();
  await refresh.refresh();
  expect(publish).toHaveBeenLastCalledWith(true);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60000);
  expect(readInstalled).toHaveBeenCalledTimes(2);

  readInstalled.mockResolvedValue(false);
  await refresh.refresh();
  expect(publish).toHaveBeenLastCalledWith(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("shares one pending retry across event refreshes", async () => {
  using _clock = fakeClock();
  const readInstalled = vi.fn(async () => false);
  using refresh = createCompanionRefresh({ readInstalled, publish: vi.fn() });
  await refresh.refresh();
  await refresh.refresh();
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(readInstalled).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(1);
});

it.each([false, true])(
  "ignores an older response after a newer read reports %s",
  async (installed) => {
    using _clock = fakeClock();
    const old = Promise.withResolvers<boolean>();
    const readInstalled = vi
      .fn(async () => installed)
      .mockReturnValueOnce(old.promise);
    const publish = vi.fn();
    using refresh = createCompanionRefresh({ readInstalled, publish });
    const pending = refresh.refresh();
    await refresh.refresh();
    old.resolve(!installed);
    await pending;
    expect(publish).toHaveBeenCalledExactlyOnceWith(installed);
    expect(vi.getTimerCount()).toBe(installed ? 0 : 1);
  },
);

it("cancels a pending retry on disposal", async () => {
  using _clock = fakeClock();
  const readInstalled = vi.fn(async () => false);
  const refresh = createCompanionRefresh({ readInstalled, publish: vi.fn() });
  await refresh.refresh();
  refresh[Symbol.dispose]();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60000);
  await refresh.refresh();
  expect(readInstalled).toHaveBeenCalledTimes(1);
});

it("does not publish a read that completes after disposal", async () => {
  using _clock = fakeClock();
  const read = Promise.withResolvers<boolean>();
  const publish = vi.fn();
  const refresh = createCompanionRefresh({
    readInstalled: () => read.promise,
    publish,
  });
  const pending = refresh.refresh();
  refresh[Symbol.dispose]();
  read.resolve(false);
  await pending;
  expect(publish).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
