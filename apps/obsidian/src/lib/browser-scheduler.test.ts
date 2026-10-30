import { afterEach, expect, it, vi } from "vitest";

import { browserScheduler } from "./browser-scheduler";

class FakeChannel {
  static last: FakeChannel;
  port1 = { onmessage: null as (() => void) | null, close: vi.fn() };
  port2 = { postMessage: vi.fn(), close: vi.fn() };
  constructor() {
    FakeChannel.last = this;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("runs a dispatched callback after closing its host task ports", () => {
  vi.stubGlobal("MessageChannel", FakeChannel);
  const task = vi.fn(() => {
    expect(FakeChannel.last.port1.close).toHaveBeenCalledOnce();
    expect(FakeChannel.last.port2.close).toHaveBeenCalledOnce();
  });
  browserScheduler.setImmediate(task);
  expect(task).not.toHaveBeenCalled();
  FakeChannel.last.port1.onmessage!();
  expect(task).toHaveBeenCalledOnce();
});

it("cancels a pending host callback and closes both ports", () => {
  vi.stubGlobal("MessageChannel", FakeChannel);
  const task = vi.fn();
  browserScheduler.setImmediate(task)();
  expect(FakeChannel.last.port1.onmessage).toBeNull();
  expect(FakeChannel.last.port1.close).toHaveBeenCalledOnce();
  expect(FakeChannel.last.port2.close).toHaveBeenCalledOnce();
  expect(task).not.toHaveBeenCalled();
});

it("flush executes pending work once and cancels its scheduled host task", () => {
  vi.stubGlobal("MessageChannel", FakeChannel);
  const dispatcher = browserScheduler.makeDispatcher();
  const task = vi.fn();
  dispatcher.scheduleTask(task, 0);
  dispatcher.flush();
  expect(task).toHaveBeenCalledOnce();
  expect(FakeChannel.last.port1.onmessage).toBeNull();
});
