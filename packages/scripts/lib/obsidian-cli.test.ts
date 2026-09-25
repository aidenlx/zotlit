import { mkdtemp, rm } from "node:fs/promises";
import type { Socket } from "node:net";
import { createServer } from "node:net";
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

describe("Obsidian CLI socket call", () => {
  /** A stand-in for Obsidian's CLI server; `reply` answers each request line. */
  async function fakeObsidian(
    reply: (request: string, socket: Socket) => void,
  ) {
    const dir = await mkdtemp(join(tmpdir(), "zt-cli-"));
    const socketPath = join(dir, "cli.sock");
    const requests: string[] = [];
    const closed = Promise.withResolvers<void>();
    const server = createServer((socket) => {
      let received = "";
      socket.on("data", (chunk) => {
        received += chunk.toString("latin1");
        if (!received.includes("\n")) return;
        requests.push(received);
        reply(received, socket);
      });
      socket.on("close", () => closed.resolve());
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    return {
      socketPath,
      requests,
      clientClosed: closed.promise,
      async [Symbol.asyncDispose]() {
        server.close();
        await rm(dir, { recursive: true, force: true });
      },
    };
  }

  it("sends the binary's request line and answers with the whole reply", async () => {
    await using obsidian = await fakeObsidian((_request, socket) => {
      socket.write("Received CLI command\n");
      socket.end("=> 中文\n");
    });
    const call = createObsidianCall({ socketPath: obsidian.socketPath });

    await expect(
      call(["vault=research-id", "eval", "code='中文'"]),
    ).resolves.toBe("Received CLI command\n=> 中文");

    const [request] = obsidian.requests;
    // ASCII only: Obsidian decodes each chunk on its own.
    expect(request).toMatch(/^[ -~]*\n$/);
    expect(JSON.parse(request!)).toMatchObject({
      argv: ["vault=research-id", "eval", "code='中文'"],
      tty: false,
    });
  });

  // A window that never finishes its reply must neither hold the caller nor
  // leave the connection open once the deadline has passed.
  it("names the vault unreachable and closes a connection that never ends", async () => {
    await using obsidian = await fakeObsidian((_request, socket) => {
      socket.write("=> partial");
    });
    const call = createObsidianCall({
      socketPath: obsidian.socketPath,
      timeoutMs: 300,
    });

    await expect(call(["vault=research-id", "eval", "code=1"])).rejects.toThrow(
      ObsidianUnreachableError,
    );
    await obsidian.clientClosed;
  });

  it("reports a stopped Obsidian as the socket's own error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zt-cli-"));
    await using _dir = {
      [Symbol.asyncDispose]: () => rm(dir, { recursive: true, force: true }),
    };
    const call = createObsidianCall({ socketPath: join(dir, "missing.sock") });

    const error = await call(["eval", "code=1"]).catch(
      (reason: unknown) => reason,
    );
    expect(isObsidianUnreachable(error)).toBe(false);
    expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
  });
});
