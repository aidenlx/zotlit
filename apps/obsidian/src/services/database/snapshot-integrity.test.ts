import { TestClock } from "effect/testing";
import { afterEach, describe, expect, vi } from "vitest";

import { Deferred, Effect, Exit, Fiber } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { verifySnapshot } from "./snapshot-integrity";

class FakeWorker {
  static last: FakeWorker;
  static ready = Deferred.makeUnsafe<void>();
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror:
    | ((event: { message: string; preventDefault(): void }) => void)
    | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn(() => {
    Deferred.doneUnsafe(FakeWorker.ready, Exit.void);
  });
  constructor() {
    FakeWorker.last = this;
  }
}

function start() {
  FakeWorker.ready = Deferred.makeUnsafe<void>();
  vi.stubGlobal("Worker", FakeWorker);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:owned-test");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const result = verifySnapshot("/owned/snapshot.sqlite");
  return { ready: FakeWorker.ready, result, revoke };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("snapshot integrity worker lifecycle", () => {
  it.effect(
    "accepts only a complete ok result and releases the worker and URL",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { ready, result, revoke } = start();
          const fiber = yield* Effect.forkScoped(result, {
            startImmediately: true,
          });
          yield* Deferred.await(ready);
          const worker = FakeWorker.last;
          expect(worker.postMessage).toHaveBeenCalledWith(
            "/owned/snapshot.sqlite",
          );
          worker.onmessage!({ data: "ok" });
          yield* Fiber.join(fiber);
          expect(worker.terminate).toHaveBeenCalledOnce();
          expect(revoke).toHaveBeenCalledWith("blob:owned-test");
        }),
      ),
  );
  for (const data of ["corrupt", null, { integrity_check: "ok" }]) {
    it.effect(
      `rejects an invalid result ${JSON.stringify(data)} and releases resources`,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { ready, result, revoke } = start();
            const fiber = yield* Effect.forkScoped(result, {
              startImmediately: true,
            });
            yield* Deferred.await(ready);
            const worker = FakeWorker.last;
            worker.onmessage!({ data });
            const error = yield* Fiber.join(fiber).pipe(Effect.flip);
            expect(error.message).toBe(
              "SQLite rejected the database read snapshot",
            );
            expect(worker.terminate).toHaveBeenCalledOnce();
            expect(revoke).toHaveBeenCalledOnce();
          }),
        ),
    );
  }
  it.effect("propagates startup/query errors and releases resources", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { ready, result, revoke } = start();
        const fiber = yield* Effect.forkScoped(result, {
          startImmediately: true,
        });
        yield* Deferred.await(ready);
        const worker = FakeWorker.last;
        worker.onerror!({
          message: "SQLite unavailable",
          preventDefault: vi.fn(),
        });
        const error = yield* Fiber.join(fiber).pipe(Effect.flip);
        expect(error.message).toBe("SQLite unavailable");
        expect(worker.terminate).toHaveBeenCalledOnce();
        expect(revoke).toHaveBeenCalledOnce();
      }),
    ),
  );
  it.effect("rejects a reply decoding failure and releases resources", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { ready, result, revoke } = start();
        const fiber = yield* Effect.forkScoped(result, {
          startImmediately: true,
        });
        yield* Deferred.await(ready);
        const worker = FakeWorker.last;
        worker.onmessageerror!();
        const error = yield* Fiber.join(fiber).pipe(Effect.flip);
        expect(error.message).toBe(
          "Invalid database snapshot verification reply",
        );
        expect(worker.terminate).toHaveBeenCalledOnce();
        expect(revoke).toHaveBeenCalledOnce();
      }),
    ),
  );
  it.effect("terminates a validator that never replies", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { ready, result, revoke } = start();
        const fiber = yield* Effect.forkScoped(result, {
          startImmediately: true,
        });
        yield* Deferred.await(ready);
        const worker = FakeWorker.last;
        yield* TestClock.adjust("60 seconds");
        const error = yield* Fiber.join(fiber).pipe(Effect.flip);
        expect(error.message).toBe("Database snapshot verification timed out");
        expect(worker.terminate).toHaveBeenCalledOnce();
        expect(revoke).toHaveBeenCalledOnce();
      }),
    ),
  );
  it.effect(
    "terminates the worker and revokes the URL when posting its path fails",
    () =>
      Effect.gen(function* () {
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
        const error = yield* Effect.flip(
          verifySnapshot("/owned/snapshot.sqlite"),
        );
        expect(error.message).toBe("Cannot post path");
        expect(FakeWorker.last.terminate).toHaveBeenCalledOnce();
        expect(revoke).toHaveBeenCalledOnce();
      }),
  );
  it.effect("revokes the URL when Worker construction fails", () =>
    Effect.gen(function* () {
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
      const error = yield* Effect.flip(
        verifySnapshot("/owned/snapshot.sqlite"),
      );
      expect(error.message).toBe("Cannot create worker");
      expect(revoke).toHaveBeenCalledOnce();
    }),
  );
});
