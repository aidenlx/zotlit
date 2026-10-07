import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";

const { fork } = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock("@/lib/require", () => ({
  requireElectronRemote: () => ({
    require: () => ({ utilityProcess: { fork } }),
  }),
}));

import { queryProcessRuntime } from "./process";

// Electron may finish spawning between fork() and registration of its remote
// listener. Cancellation must work both before and after the readiness message.
it.each([false, true])(
  "stops a child after a missed spawn event (ready: %s)",
  async (ready) => {
    const child = Object.assign(new EventEmitter(), {
      pid: undefined as number | undefined,
      kill: vi.fn(),
    });
    fork.mockReturnValue(child);
    await using runtime = await queryProcessRuntime("");
    const worker = runtime.create();
    child.pid = 12345;
    if (ready) child.emit("message", JSON.stringify({ type: "ready" }));
    const signal = vi.spyOn(process, "kill").mockReturnValue(true);
    try {
      const stopped = worker.terminate();
      try {
        expect(signal).toHaveBeenCalledWith(12345, "SIGKILL");
        expect(child.kill).not.toHaveBeenCalled();
      } finally {
        child.emit("exit", 0);
        await stopped;
      }
    } finally {
      signal.mockRestore();
    }
  },
);
