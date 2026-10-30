// Effect admission owns its clock, cancellation, and resource cleanup.
import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, Queue } from "effect";
import { TestClock } from "effect/testing";
import { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  MEMORY_GATE_ADMITTED_ENV,
  MEMORY_GATE_ENV,
  MemoryGateClosedError,
  passMemoryGate,
} from "@zotlit/config/memory-gate";

const probe = vi.hoisted(() =>
  vi.fn<typeof import("node:child_process").execFile>(),
);
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: probe,
}));

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
let dir: string;
function pressure(level: number) {
  probe.mockImplementation((...args) => {
    const callback = args[3];
    queueMicrotask(() => callback?.(null, String(level), ""));
    return new ChildProcess();
  });
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "memory-gate-effect-"));
  vi.stubEnv(MEMORY_GATE_ENV, "");
  vi.stubEnv(MEMORY_GATE_ADMITTED_ENV, "");
  Object.defineProperty(process, "platform", { value: "darwin" });
  pressure(2);
});
afterEach(() => {
  vi.unstubAllEnvs();
  Object.defineProperty(process, "platform", platform);
  rmSync(dir, { recursive: true, force: true });
});

it.effect("expires at the Admission Deadline on the Effect clock", () =>
  Effect.gen(function* () {
    const logs = yield* Queue.unbounded<string>();
    const fiber = yield* Effect.forkChild(
      Effect.exit(
        passMemoryGate({
          dir,
          deadline: 1000,
          log: (message) => {
            Queue.offerUnsafe(logs, message);
          },
        }),
      ),
    );
    expect(yield* Queue.take(logs)).toContain(
      "macOS memory pressure is warning",
    );
    yield* TestClock.adjust(1000);
    expect(yield* Fiber.join(fiber)).toEqual(
      Exit.fail(new MemoryGateClosedError("macOS memory pressure is warning")),
    );
    pressure(1);
    expect(yield* passMemoryGate({ dir })).toBe(true);
  }),
);

it.effect(
  "interrupting a waiting fiber removes its ticket before the next run",
  () =>
    Effect.gen(function* () {
      const logs = yield* Queue.unbounded<string>();
      const fiber = yield* Effect.forkChild(
        passMemoryGate({
          dir,
          deadline: 1000,
          log: (message) => {
            Queue.offerUnsafe(logs, message);
          },
        }),
      );
      yield* Queue.take(logs);
      yield* Fiber.interrupt(fiber);
      pressure(1);
      expect(yield* passMemoryGate({ dir, deadline: 1000 })).toBe(true);
    }),
);

it.effect(
  "interrupting a pressure probe aborts it and releases the start lock",
  () =>
    Effect.gen(function* () {
      const probes = yield* Queue.unbounded<void>();
      let aborted = false;
      probe.mockImplementation((_command, _args, options) => {
        options?.signal?.addEventListener("abort", () => {
          aborted = true;
        });
        Queue.offerUnsafe(probes, undefined);
        return new ChildProcess();
      });
      const fiber = yield* Effect.forkChild(
        passMemoryGate({ dir, deadline: 1000 }),
      );
      yield* Queue.take(probes);
      yield* Fiber.interrupt(fiber);
      expect(aborted).toBe(true);
      pressure(1);
      expect(yield* passMemoryGate({ dir, deadline: 1000 })).toBe(true);
    }),
);

it.effect(
  "reports a typed probe failure and releases admission resources",
  () =>
    Effect.gen(function* () {
      probe.mockImplementation((...args) => {
        const callback = args[3];
        queueMicrotask(() =>
          callback?.(
            Object.assign(new Error("probe failed"), { cmd: "sysctl" }),
            "",
            "",
          ),
        );
        return new ChildProcess();
      });
      const operation = yield* passMemoryGate({ dir, deadline: 1000 }).pipe(
        Effect.catchTag("MemoryGateIoError", (error) =>
          Effect.succeed(error.operation),
        ),
      );
      expect(operation).toBe("sysctl");
      pressure(1);
      expect(yield* passMemoryGate({ dir, deadline: 1000 })).toBe(true);
    }),
);
