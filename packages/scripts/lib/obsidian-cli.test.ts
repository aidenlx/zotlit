import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBoundedObsidianCall,
  createObsidianCall,
  isObsidianUnreachable,
  ObsidianUnreachableError,
} from "./obsidian-cli.ts";

describe("bounded Obsidian CLI call", () => {
  afterEach(() => vi.useRealTimers());

  it("passes the answer through and forwards the arguments", async () => {
    const received: string[][] = [];
    const call = createBoundedObsidianCall(async (args) => {
      received.push(args);
      return "=> ready";
    });

    await expect(call(["vault=research", "eval", "code=1"])).resolves.toBe(
      "=> ready",
    );
    expect(received).toEqual([["vault=research", "eval", "code=1"]]);
  });

  it("names the unreachable vault when a call never answers", async () => {
    vi.useFakeTimers();
    const call = createBoundedObsidianCall(async () => new Promise(() => {}), {
      timeoutMs: 10,
    });

    await Promise.all([
      expect(call(["vault=research-id", "eval", "code=1"])).rejects.toThrow(
        /vault research-id did not answer within 10 milliseconds[\s\S]*Restart Obsidian/,
      ),
      vi.advanceTimersByTimeAsync(10),
    ]);
  });

  it("names the focused window when the call targets no vault", async () => {
    vi.useFakeTimers();
    const call = createBoundedObsidianCall(async () => new Promise(() => {}), {
      timeoutMs: 10,
    });

    await Promise.all([
      expect(call(["eval", "code=1"])).rejects.toThrow(
        "The focused Obsidian vault window did not answer within 10 milliseconds.",
      ),
      vi.advanceTimersByTimeAsync(10),
    ]);
  });

  it("aborts the underlying call, so no CLI process outlives the timeout", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const call = createBoundedObsidianCall(
      (_args, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
      { timeoutMs: 10 },
    );

    await Promise.all([
      expect(call(["vault=research-id", "eval", "code=1"])).rejects.toThrow(
        /did not answer/,
      ),
      vi.advanceTimersByTimeAsync(10),
    ]);
    expect(aborted).toBe(true);
  });

  it("marks only its own timeout as unreachable", async () => {
    vi.useFakeTimers();
    const call = createBoundedObsidianCall(async () => new Promise(() => {}), {
      timeoutMs: 10,
    });

    const [error] = await Promise.all([
      call(["vault=research-id", "eval", "code=1"]).catch(
        (reason: unknown) => reason,
      ),
      vi.advanceTimersByTimeAsync(10),
    ]);
    expect(isObsidianUnreachable(error)).toBe(true);
    expect(isObsidianUnreachable(new Error("command not found"))).toBe(false);
  });

  it("reports a caller's abort as its own failure, not an unreachable vault", async () => {
    const controller = new AbortController();
    const call = createBoundedObsidianCall(
      (_args, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new Error("probe cancelled")),
          );
        }),
    );

    const pending = call(["vault=research-id", "eval", "code=1"], {
      signal: controller.signal,
    }).catch((reason: unknown) => reason);
    controller.abort();

    const error = await pending;
    expect(isObsidianUnreachable(error)).toBe(false);
    expect((error as Error).message).toBe("probe cancelled");
  });

  it("leaves no timer behind once a call answers", async () => {
    vi.useFakeTimers();
    const call = createBoundedObsidianCall(async () => "=> ready", {
      timeoutMs: 10,
    });

    await expect(call(["vault=research-id", "eval", "code=1"])).resolves.toBe(
      "=> ready",
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Obsidian CLI child reaping", () => {
  function alive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  }

  // The defect this guards: a CLI waiting on a window that never answers
  // outlives SIGTERM and keeps its pipes, so `execFile` never settles and the
  // caller waits forever. Seen in the End-to-end Run as a 60 s Vitest timeout
  // on a different test each run, and as orphans surviving for hours.
  it("settles and reaps a child that ignores SIGTERM", async () => {
    const pidFile = join(await mkdtemp(join(tmpdir(), "zt-cli-")), "pid");
    // Stands in for the real CLI: reports its pid, ignores SIGTERM, never answers.
    const deaf = [
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));` +
        "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
    ];
    const call = createObsidianCall({
      command: process.execPath,
      timeoutMs: 300,
    });

    await expect(call(deaf)).rejects.toThrow(ObsidianUnreachableError);

    const pid = Number(await readFile(pidFile, "utf8"));
    expect(Number.isInteger(pid)).toBe(true);
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5000 });
  });
});
