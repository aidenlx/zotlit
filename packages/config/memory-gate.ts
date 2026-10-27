// The Memory Gate: admit a heavy run only while the machine has memory to spare.
//
// The gate admits runs in arrival order while the OS says memory may grow.
// Runs may take the machine a little past physical memory, as far as
// compression and paging keep up:
//
// - macOS: the kernel's pressure level is normal. Swap and compressed idle
//   pages linger long after memory frees up, so their size is no guide.
// - Windows: the commit charge is at most 1.25x physical memory.
// - Linux: used memory plus used swap is at most 1.25x physical memory.
//
// It admits once per top-level invocation: the caller marks what it starts
// with MEMORY_GATE_ADMITTED_ENV, and a nested run that sees the mark skips the
// gate. The gate holds nothing after it admits. Ported from vattention/vatt-repo
// `scripts/memory-gate.ts`.

import { regex } from "arkregex";
import { Clock, Config, Effect, Schema } from "effect";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The per-user state directory of desktop admission. */
export const DESKTOP_DIR_ENV = "ZOTLIT_DESKTOP_DIR";
/** `off` skips the gate. */
export const MEMORY_GATE_ENV = "ZOTLIT_MEMORY_GATE";
/** Set on what the gate admitted; a nested run that sees it skips the gate. */
export const MEMORY_GATE_ADMITTED_ENV = "ZOTLIT_MEMORY_GATE_ADMITTED";

/** Overrides the Admission Deadline, as a duration. */
export const DESKTOP_WAIT_ENV = "ZOTLIT_DESKTOP_WAIT";
/** The Admission Deadline passed: blocked at admission, not a failure. */
export const EXIT_ADMISSION_BLOCKED = 75;
/** The default Admission Deadline, inside an agent's 10 min tool timeout. */
export const ADMISSION_DEADLINE_MS = 9 * 60_000;

const MAX_COMMIT = 1.25;
/** A start lock this old belongs to a run killed while it held the lock. */
const STALE_LOCK_MS = 10_000;
const LAST_START = "last-start";
const MEMORY_QUEUE = "memory-queue";

interface MemoryWaiter {
  token: string;
  pid: number;
  deadline: number;
  path?: string;
}

/**
 * Desktop admission state, shared per user by every clone on the machine. A
 * fixed path: turbo's strict env mode and the shell may disagree on TMPDIR.
 */
export function desktopStateDir(): string {
  const override = process.env[DESKTOP_DIR_ENV];
  if (override) return override;
  return defaultDesktopStateDir();
}

function defaultDesktopStateDir(): string {
  return process.platform === "win32"
    ? join(tmpdir(), "zotlit-desktop")
    : `/tmp/zotlit-desktop-${process.getuid?.()}`;
}

const UNIT_MS = { ms: 1, s: 1000, m: 60_000, min: 60_000, h: 3_600_000 };
const DURATION = regex("^(?<count>\\d+(?:\\.\\d+)?)(?<unit>ms|s|min|m|h)$");

/**
 * @param text a duration such as `300ms`, `90s`, `20m`, or `2h`.
 * @returns the duration in milliseconds.
 * @throws {Error} when the text is not a duration.
 */
export function parseDuration(text: string): number {
  const match = DURATION.exec(text.trim());
  if (!match) {
    throw new Error(
      `"${text}" is not a duration; write it as 300ms, 90s, 20m, or 2h.`,
    );
  }
  const { count, unit } = match.groups;
  return Math.round(Number(count) * UNIT_MS[unit]);
}

/** The Admission Deadline wait: DESKTOP_WAIT_ENV, else ADMISSION_DEADLINE_MS. */
export function admissionWaitMs(): number {
  const wait = process.env[DESKTOP_WAIT_ENV];
  return wait ? parseDuration(wait) : ADMISSION_DEADLINE_MS;
}

/** @returns why memory cannot take another run, or undefined when it can. */
export function macosVerdict(level: number): string | undefined {
  if (level === 1) return undefined;
  return `macOS memory pressure is ${level === 2 ? "warning" : level === 4 ? "critical" : `level ${level}`}`;
}

function commitVerdict(committed: number, physical: number) {
  const ratio = committed / physical;
  return ratio <= MAX_COMMIT
    ? undefined
    : `memory committed at ${ratio.toFixed(2)}x physical, above ${MAX_COMMIT}x`;
}

/** @param os `Win32_OperatingSystem` sizes, in KiB. */
export function windowsVerdict(os: {
  TotalVisibleMemorySize: number;
  TotalVirtualMemorySize: number;
  FreeVirtualMemory: number;
}): string | undefined {
  return commitVerdict(
    os.TotalVirtualMemorySize - os.FreeVirtualMemory,
    os.TotalVisibleMemorySize,
  );
}

/** @param meminfo the text of `/proc/meminfo`. */
export function linuxVerdict(meminfo: string): string | undefined {
  // Lines such as `MemTotal:       16303928 kB`.
  const sizes = new Map(
    meminfo.split("\n").map((line) => {
      const [name = "", size = ""] = line.split(":");
      return [name, Number.parseInt(size.trim(), 10)] as const;
    }),
  );
  const kib = (name: string) => sizes.get(name) || 0;
  const total = kib("MemTotal");
  return commitVerdict(
    total - kib("MemAvailable") + kib("SwapTotal") - kib("SwapFree"),
    total,
  );
}

class MemoryGateIoError extends Schema.TaggedError<
  MemoryGateIoError,
  { readonly brand: unique symbol }
>()("MemoryGateIoError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

function io<A>(operation: string, body: () => A) {
  return Effect.try({
    try: body,
    catch: (cause) => new MemoryGateIoError({ operation, cause }),
  });
}

function run(command: string, args: string[]) {
  return Effect.callback<string, MemoryGateIoError>((resume, signal) => {
    execFile(command, args, { encoding: "utf8", signal }, (cause, stdout) => {
      resume(
        cause
          ? Effect.fail(new MemoryGateIoError({ operation: command, cause }))
          : Effect.succeed(stdout),
      );
    });
  });
}

const memoryVerdict = Effect.fnUntraced(function* () {
  if (process.platform === "darwin")
    return macosVerdict(
      Number(
        yield* run("sysctl", ["-n", "kern.memorystatus_vm_pressure_level"]),
      ),
    );
  if (process.platform === "win32") {
    // -NoProfile: a profile's own output would precede the JSON.
    const output = yield* run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,TotalVirtualMemorySize,FreeVirtualMemory | ConvertTo-Json",
    ]);
    return yield* io("read Windows memory", () =>
      windowsVerdict(JSON.parse(output)),
    );
  }
  return yield* io("read Linux memory", () =>
    linuxVerdict(readFileSync("/proc/meminfo", "utf8")),
  );
});

/** When the gate last admitted a run, from any clone on the machine. */
export function lastGateStart(
  dir: string = desktopStateDir(),
): Temporal.Instant | undefined {
  try {
    return Temporal.Instant.from(
      readFileSync(join(dir, LAST_START), "utf8").trim(),
    );
  } catch {
    return undefined;
  }
}

/** Runs under the start lock, so ticket allocation and ordering are atomic. */
function queueVerdict(dir: string, waiter: MemoryWaiter, now: number) {
  const queue = join(dir, MEMORY_QUEUE);
  mkdirSync(queue, { recursive: true });
  if (!waiter.path) {
    const sequence = join(dir, `${MEMORY_QUEUE}.seq`);
    const last =
      Number(readFileSync(sequence, { encoding: "utf8", flag: "a+" })) || 0;
    const seq = last + 1;
    writeFileSync(`${sequence}.tmp`, String(seq));
    renameSync(`${sequence}.tmp`, sequence);
    waiter.path = join(queue, `${seq}-${waiter.token}.json`);
    const draft = `${waiter.path}.tmp`;
    writeFileSync(draft, JSON.stringify(waiter));
    renameSync(draft, waiter.path);
  }
  const tickets = readdirSync(queue)
    .filter((name) => name.endsWith(".json"))
    .toSorted((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]));
  for (const name of tickets) {
    const path = join(queue, name);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      // A waiter can reach its deadline and remove its ticket during this scan.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const ticket = JSON.parse(text) as MemoryWaiter;
    if (ticket.token === waiter.token) break;
    let alive = true;
    try {
      process.kill(ticket.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
    }
    if (!alive || now >= ticket.deadline) {
      rmSync(path, { force: true });
      continue;
    }
    return `waiting behind pid ${ticket.pid} at the Memory Gate`;
  }
  return undefined;
}

/** Record this start if the gate is open; one caller at a time. */
const tryStart = Effect.fnUntraced(function* (
  dir: string,
  waiter: MemoryWaiter,
) {
  const lock = join(dir, `${LAST_START}.lock`);
  const now = yield* Clock.currentTimeMillis;
  return yield* Effect.acquireUseRelease(
    io("claim start lock", () => {
      try {
        mkdirSync(lock);
        return true;
      } catch {
        // A run killed while holding the lock leaves it behind.
        const changed = statSync(lock, { throwIfNoEntry: false })?.mtimeMs;
        if (changed !== undefined && now - changed > STALE_LOCK_MS)
          rmSync(lock, { recursive: true, force: true });
        return false;
      }
    }),
    Effect.fnUntraced(function* (claimed) {
      if (!claimed) return "another run is starting";
      const queued = yield* io("read memory queue", () =>
        queueVerdict(dir, waiter, now),
      );
      if (queued) return queued;
      const verdict = yield* memoryVerdict();
      if (verdict) return verdict;
      const started = yield* Clock.currentTimeMillis;
      yield* io("record admitted start", () => {
        writeFileSync(
          join(dir, LAST_START),
          Temporal.Instant.fromEpochMilliseconds(started).toString(),
        );
        rmSync(waiter.path!, { force: true });
      });
      return undefined;
    }),
    (claimed) =>
      Effect.sync(() => {
        if (claimed) rmSync(lock, { recursive: true, force: true });
      }),
  );
});

/** The gate stayed shut until the Admission Deadline. */
export class MemoryGateClosedError extends Error {
  readonly _tag = "MemoryGateClosedError";
  readonly reason: string;
  constructor(reason: string) {
    super(`Memory Gate: still closed at the Admission Deadline: ${reason}.`);
    this.reason = reason;
  }
}

export interface MemoryGateOptions {
  /** @default desktopStateDir() */
  dir?: string;
  /** Epoch milliseconds after which the wait gives up. @default now + admissionWaitMs() */
  deadline?: number;
  /** @default 100 */
  pollMs?: number;
  log?: (message: string) => void;
}

/**
 * Wait until the gate admits this run. It returns at once when the gate is off
 * or an enclosing run was admitted; the caller marks what it starts with
 * MEMORY_GATE_ADMITTED_ENV.
 *
 * @returns an Effect that succeeds with true on admission, false when skipped,
 * and reports typed failures for deadlines, configuration, and OS I/O.
 */
export const passMemoryGate = Effect.fnUntraced(function* (
  options: MemoryGateOptions = {},
) {
  const gate = yield* Config.String(MEMORY_GATE_ENV).pipe(
    Config.withDefault(""),
  );
  if (gate === "off") return false;
  const admitted = yield* Config.String(MEMORY_GATE_ADMITTED_ENV).pipe(
    Config.withDefault(""),
  );
  if (admitted) return false;
  const configuredDir = yield* Config.String(DESKTOP_DIR_ENV).pipe(
    Config.withDefault(""),
  );
  const dir = options.dir ?? (configuredDir || defaultDesktopStateDir());
  const log = options.log ?? ((message: string) => console.error(message));
  const waitText = yield* Config.String(DESKTOP_WAIT_ENV).pipe(
    Config.withDefault(""),
  );
  const deadline =
    options.deadline ??
    (yield* Clock.currentTimeMillis) +
      (waitText ? parseDuration(waitText) : ADMISSION_DEADLINE_MS);
  return yield* Effect.acquireUseRelease(
    io("create memory waiter", () => {
      mkdirSync(dir, { recursive: true });
      const waiter: MemoryWaiter = {
        token: randomUUID(),
        pid: process.pid,
        deadline,
      };
      return waiter;
    }),
    Effect.fnUntraced(function* (waiter) {
      let reported: string | undefined;
      let wait: string | undefined;
      for (;;) {
        if ((yield* Clock.currentTimeMillis) >= deadline)
          return yield* Effect.fail(
            new MemoryGateClosedError(wait ?? "Admission Deadline passed"),
          );
        wait = yield* tryStart(dir, waiter);
        if (!wait) return true;
        // Report each kind of wait once, not every poll.
        const kind = wait.replace(/[\d.]+x physical/, "");
        if (kind !== reported) log(`Memory Gate: waiting: ${wait}`);
        reported = kind;
        yield* Effect.sleep(options.pollMs ?? 100);
      }
    }),
    (waiter) =>
      Effect.sync(() => {
        if (waiter.path) rmSync(waiter.path, { force: true });
      }),
  );
});

/**
 * {@link passMemoryGate} for a top-level run: at the Admission Deadline it
 * prints why and exits with EXIT_ADMISSION_BLOCKED.
 */
export const passMemoryGateOrExit = (options: MemoryGateOptions = {}) =>
  passMemoryGate(options).pipe(
    Effect.catchTag("MemoryGateClosedError", (error) =>
      Effect.sync(() => {
        console.error(
          `${error.message}\nReport this as blocked by the Memory Gate, not as a test failure. Exit ${EXIT_ADMISSION_BLOCKED}.`,
        );
        process.exit(EXIT_ADMISSION_BLOCKED);
      }),
    ),
  );
