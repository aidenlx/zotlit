import { afterEach, describe, expect, it, vi } from "vitest";

import { verifySnapshot } from "./snapshot-integrity";

class FakeWorker {
  static last: FakeWorker;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror:
    | ((event: { message: string; preventDefault(): void }) => void)
    | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeWorker.last = this;
  }
}

function start() {
  vi.stubGlobal("Worker", FakeWorker);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:owned-test");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const result = verifySnapshot("/owned/snapshot.sqlite");
  return { result, worker: FakeWorker.last, revoke };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("snapshot integrity worker lifecycle", () => {
  it("accepts only a complete ok result and releases the worker and URL", async () => {
    const { result, worker, revoke } = start();
    expect(worker.postMessage).toHaveBeenCalledWith("/owned/snapshot.sqlite");
    worker.onmessage!({ data: "ok" });
    await result;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:owned-test");
  });
  it.each(["corrupt", null, { integrity_check: "ok" }])(
    "rejects an invalid result %j and releases resources",
    async (data) => {
      const { result, worker, revoke } = start();
      const rejected = expect(result).rejects.toThrow(
        "SQLite rejected the database read snapshot",
      );
      worker.onmessage!({ data });
      await rejected;
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(revoke).toHaveBeenCalledOnce();
    },
  );
  it("propagates startup/query errors and releases resources", async () => {
    const { result, worker, revoke } = start();
    const rejected = expect(result).rejects.toThrow("SQLite unavailable");
    worker.onerror!({ message: "SQLite unavailable", preventDefault: vi.fn() });
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledOnce();
  });
  it("rejects a reply decoding failure and releases resources", async () => {
    const { result, worker, revoke } = start();
    const rejected = expect(result).rejects.toThrow(
      "Invalid database snapshot verification reply",
    );
    worker.onmessageerror!();
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledOnce();
  });
  it("terminates a validator that never replies", async () => {
    vi.useFakeTimers();
    const { result, worker, revoke } = start();
    const rejected = expect(result).rejects.toThrow(
      "Database snapshot verification timed out",
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledOnce();
  });
  it("terminates the worker and revokes the URL when posting its path fails", async () => {
    vi.stubGlobal(
      "Worker",
      class extends FakeWorker {
        postMessage = vi.fn(() => {
          throw Error("Cannot post path");
        });
      },
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:owned-test");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    await expect(verifySnapshot("/owned/snapshot.sqlite")).rejects.toThrow(
      "Cannot post path",
    );
    expect(FakeWorker.last.terminate).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledOnce();
  });
  it("revokes the URL when Worker construction fails", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw Error("Cannot create worker");
        }
      },
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:owned-test");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    await expect(verifySnapshot("/owned/snapshot.sqlite")).rejects.toThrow(
      "Cannot create worker",
    );
    expect(revoke).toHaveBeenCalledOnce();
  });
});
