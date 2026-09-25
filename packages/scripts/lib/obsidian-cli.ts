// Bounded Obsidian CLI invocation, so one unanswered call cannot stall a script.
//
// Calls speak the `obsidian` binary's socket protocol in-process instead of
// spawning the binary. The native client reads its reply in a thread blocked
// in `read()`, and on macOS that read can miss the end of the connection: the
// reply is already printed and Obsidian has closed its side, yet the process
// waits until SIGKILL. Measured with a mixed eval workload: the binary missed
// about 1 in 1,100 replies; this client missed none in 17,800.
//
// An Obsidian vault window can also disappear while the vault registry still
// reports it `open` — a crashed renderer stays in Obsidian's window map — and
// every call aimed at it then waits forever, while other vault windows keep
// answering. Only restarting Obsidian clears that. A bounded call turns such
// an endless wait into a diagnosis the caller can act on.

import { createConnection } from "node:net";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

/** Generous next to the slowest observed answer (a database refresh, ~5 s). */
export const OBSIDIAN_CALL_TIMEOUT_MS = 30_000;

/** The vault a CLI call targets, or `undefined` for the focused window. */
function targetVault(args: string[]): string | undefined {
  return args.find((arg) => arg.startsWith("vault="))?.slice("vault=".length);
}

function timeoutLabel(timeoutMs: number): string {
  return timeoutMs % 1_000 === 0
    ? `${timeoutMs / 1_000} seconds`
    : `${timeoutMs} milliseconds`;
}

/**
 * A vault window stopped answering the CLI. Recoverable only by restarting
 * Obsidian, so callers treat it as fatal rather than retrying.
 */
export class ObsidianUnreachableError extends Error {
  readonly vault: string | undefined;

  constructor(args: string[], timeoutMs: number) {
    const vault = targetVault(args);
    super(
      `${vault ? `Obsidian vault ${vault}` : "The focused Obsidian vault window"} did not answer within ${timeoutLabel(timeoutMs)}.\n\n` +
        "Known causes: the evaluated code awaits a promise that never settles\n" +
        "(requestAnimationFrame in a hidden window, for example); the window\n" +
        "reloaded during the call; or the window's renderer crashed while the\n" +
        "vault registry still reports it open, so every call to it waits forever.\n\n" +
        "Restart Obsidian if a quick call to the same vault, such as\n" +
        "`eval code=1`, also gets no answer, then rerun the command.",
    );
    this.name = "ObsidianUnreachableError";
    this.vault = vault;
  }
}

export function isObsidianUnreachable(
  error: unknown,
): error is ObsidianUnreachableError {
  return error instanceof ObsidianUnreachableError;
}

interface BoundedCallConfig {
  timeoutMs?: number;
}

interface CallOptions {
  /** Caller's own deadline; its abort surfaces as the caller's own failure. */
  signal?: AbortSignal;
}

/**
 * Wrap a CLI runner so every call answers or reports the vault unreachable.
 * The runner's own rejection passes through untouched — only this wrapper's
 * deadline produces {@link ObsidianUnreachableError}.
 */
export function createBoundedObsidianCall(
  run: (args: string[], signal: AbortSignal) => Promise<string>,
  { timeoutMs = OBSIDIAN_CALL_TIMEOUT_MS }: BoundedCallConfig = {},
): (args: string[], options?: CallOptions) => Promise<string> {
  return async (args, { signal }: CallOptions = {}) => {
    const controller = new AbortController();
    const abortCall = (): void => controller.abort();
    signal?.addEventListener("abort", abortCall);
    // Raced rather than awaited: a runner that ignores its abort signal is the
    // very failure this wrapper exists to contain, so the deadline settles the
    // call on its own and the abort is left to close the connection.
    const expiry = Promise.withResolvers<never>();
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      controller.abort();
      expiry.reject(new ObsidianUnreachableError(args, timeoutMs));
    }, timeoutMs);
    const call = run(args, controller.signal);
    // The loser of the race still settles; swallow it so an abort rejection
    // arriving after the deadline is not reported as unhandled.
    call.catch(() => undefined);
    try {
      return await Promise.race([call, expiry.promise]);
    } catch (error) {
      // A runner that rejects on abort would otherwise win the race and report
      // its own cancellation, burying why the call was cancelled.
      throw expired ? new ObsidianUnreachableError(args, timeoutMs) : error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortCall);
    }
  };
}

/**
 * Where Obsidian's main process listens for CLI calls — the path the
 * `obsidian` binary connects to (Obsidian 1.14 `main.js`).
 */
export function obsidianCliSocketPath(): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\obsidian-cli-${userInfo().username}`;
  }
  const base =
    (process.platform !== "darwin" && process.env.XDG_RUNTIME_DIR) || homedir();
  return join(base, ".obsidian-cli.sock");
}

/**
 * The request line the `obsidian` binary sends. Escaped to ASCII: Obsidian
 * decodes each received chunk on its own, so a multi-byte character split
 * across two chunks would reach the window as U+FFFD.
 */
function requestLine(argv: string[]): string {
  const json = JSON.stringify({ argv, tty: false, cwd: process.cwd() });
  return `${json.replaceAll(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  )}\n`;
}

/**
 * The bounded CLI call every caller shares — scripts and the End-to-end Run
 * suite alike, so the transport cannot drift between two copies.
 *
 * Obsidian writes the reply and then ends the connection, so the end of the
 * stream is the whole answer. The output matches what the `obsidian` binary
 * prints, trimmed. With Obsidian not running, the call rejects with the
 * socket's own `ENOENT` / `ECONNREFUSED`.
 *
 * @param socketPath injectable so the deadline is provable against a server
 *   that never ends the connection — the failure this call contains.
 */
export function createObsidianCall({
  socketPath = obsidianCliSocketPath(),
  timeoutMs = OBSIDIAN_CALL_TIMEOUT_MS,
}: { socketPath?: string; timeoutMs?: number } = {}): (
  args: string[],
  options?: CallOptions,
) => Promise<string> {
  return createBoundedObsidianCall(
    (args, signal) =>
      new Promise<string>((resolve, reject) => {
        const socket = createConnection(socketPath);
        const chunks: Buffer[] = [];
        signal.addEventListener(
          "abort",
          () => socket.destroy(new Error("Obsidian CLI call aborted")),
          { once: true },
        );
        socket.setNoDelay(true);
        socket.on("connect", () => socket.write(requestLine(args)));
        socket.on("data", (chunk: Buffer) => chunks.push(chunk));
        socket.on("end", () =>
          resolve(Buffer.concat(chunks).toString("utf8").trim()),
        );
        socket.on("error", reject);
        socket.on("close", () =>
          reject(
            new Error("Obsidian closed the CLI connection without a reply"),
          ),
        );
      }),
    { timeoutMs },
  );
}
