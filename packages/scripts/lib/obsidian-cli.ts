// Bounded Obsidian CLI invocation, so one unanswered call cannot stall a script.
//
// An Obsidian vault window can disappear while the vault registry still reports
// it `open`. Obsidian's main process then refuses to reopen that vault, and
// every CLI call aimed at it waits forever — `eval` and plugin commands alike,
// while other vault windows keep answering. Nothing the CLI offers revives the
// window; only restarting Obsidian clears the stale flag. A bounded call turns
// that endless wait into a diagnosis the caller can act on, and aborts the CLI
// process instead of stranding it.

import { execFile } from "node:child_process";

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
        "Its window is gone while the vault registry still reports it open, so\n" +
        "Obsidian refuses to reopen it and every call to it waits forever.\n\n" +
        "Restart Obsidian, then rerun the command.",
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
    // call on its own and the abort is left to reap the CLI process.
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
 * The bounded CLI call every caller shares — scripts and the End-to-end Run
 * suite alike, so the reaping behaviour cannot drift between two copies.
 *
 * @param command the executable, injectable so the reaping is provable
 *   against a child that ignores SIGTERM — the failure this call contains.
 */
export function createObsidianCall({
  command = "obsidian",
  timeoutMs = OBSIDIAN_CALL_TIMEOUT_MS,
}: { command?: string; timeoutMs?: number } = {}): (
  args: string[],
  options?: CallOptions,
) => Promise<string> {
  return createBoundedObsidianCall(
    (args, signal) =>
      new Promise<string>((resolve, reject) => {
        const child = execFile(
          command,
          args,
          {
            // `timeout` paired with SIGKILL is what settles this promise. A
            // CLI waiting on a window that never answers sits in
            // `pthread_join` and outlives SIGTERM, which keeps its pipes — so
            // `execFile` never fires its callback and the caller waits for
            // ever. Measured against a child that ignores SIGTERM: the
            // default leaves the call pending and the child running, while
            // SIGKILL settles in ~300 ms and reaps it.
            timeout: timeoutMs,
            killSignal: "SIGKILL",
            windowsHide: true,
          },
          (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve(`${stdout}${stderr}`.trim());
          },
        );
        // Node applies `killSignal` to `timeout` but not to an abort, so a
        // caller's own cancellation needs the signal sent by hand.
        signal.addEventListener("abort", () => child.kill("SIGKILL"), {
          once: true,
        });
      }),
    { timeoutMs },
  );
}
