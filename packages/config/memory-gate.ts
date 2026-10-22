// The Memory Gate: admit a heavy run only while the machine has memory to spare.
//
// The gate admits a run when the OS says memory may grow and no gated run has
// started in the last 30 s, so a fresh run's memory shows before the next one
// is let in. Runs may take the machine a little past physical memory, as far
// as compression and paging keep up:
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
import { execFile } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

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

const SETTLE_MS = 30_000;
const MAX_COMMIT = 1.25;
/** A start lock this old belongs to a run killed while it held the lock. */
const STALE_LOCK_MS = 10_000;
const LAST_START = "last-start";

/**
 * Desktop admission state, shared per user by every clone on the machine. A
 * fixed path: turbo's strict env mode and the shell may disagree on TMPDIR.
 */
export function desktopStateDir(): string {
  const override = process.env[DESKTOP_DIR_ENV];
  if (override) return override;
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

async function memoryVerdict(): Promise<string | undefined> {
  const run = async (command: string, args: string[]) =>
    (await promisify(execFile)(command, args, { encoding: "utf8" })).stdout;
  if (process.platform === "darwin")
    return macosVerdict(
      Number(
        await run("sysctl", ["-n", "kern.memorystatus_vm_pressure_level"]),
      ),
    );
  if (process.platform === "win32")
    // -NoProfile: a profile's own output would precede the JSON.
    return windowsVerdict(
      JSON.parse(
        await run("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,TotalVirtualMemorySize,FreeVirtualMemory | ConvertTo-Json",
        ]),
      ),
    );
  return linuxVerdict(readFileSync("/proc/meminfo", "utf8"));
}

function epochMs(): number {
  return Temporal.Now.instant().epochMilliseconds;
}

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

/** Record this start if the gate is open; one caller at a time. */
async function tryStart(dir: string): Promise<string | undefined> {
  const lock = join(dir, `${LAST_START}.lock`);
  try {
    mkdirSync(lock);
  } catch {
    // A run killed while holding the lock leaves it behind.
    const changed = statSync(lock, { throwIfNoEntry: false })?.mtimeMs;
    if (changed !== undefined && epochMs() - changed > STALE_LOCK_MS)
      rmSync(lock, { recursive: true, force: true });
    return "another run is starting";
  }
  try {
    const previous = lastGateStart(dir);
    if (previous && epochMs() - previous.epochMilliseconds < SETTLE_MS)
      return `another run started under ${SETTLE_MS / 1000} s ago`;
    const verdict = await memoryVerdict();
    if (verdict) return verdict;
    writeFileSync(join(dir, LAST_START), Temporal.Now.instant().toString());
    return undefined;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** The gate stayed shut until the Admission Deadline. */
export class MemoryGateClosedError extends Error {
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
  /** @default 1000 */
  pollMs?: number;
  log?: (message: string) => void;
}

/**
 * Wait until the gate admits this run. It returns at once when the gate is off
 * or an enclosing run was admitted; the caller marks what it starts with
 * MEMORY_GATE_ADMITTED_ENV.
 *
 * @returns whether the gate admitted this run (false when it was skipped).
 * @throws {MemoryGateClosedError} when `deadline` passes first.
 */
export async function passMemoryGate(
  options: MemoryGateOptions = {},
): Promise<boolean> {
  if (process.env[MEMORY_GATE_ENV] === "off") return false;
  if (process.env[MEMORY_GATE_ADMITTED_ENV]) return false;
  const dir = options.dir ?? desktopStateDir();
  const log = options.log ?? ((message: string) => console.error(message));
  const deadline = options.deadline ?? epochMs() + admissionWaitMs();
  mkdirSync(dir, { recursive: true });
  let reported: string | undefined;
  for (let wait = await tryStart(dir); wait; wait = await tryStart(dir)) {
    if (epochMs() >= deadline) throw new MemoryGateClosedError(wait);
    // Report each kind of wait once, not every poll.
    const kind = wait.replace(/[\d.]+x physical/, "");
    if (kind !== reported) log(`Memory Gate: waiting: ${wait}`);
    reported = kind;
    await delay(options.pollMs ?? 1000);
  }
  return true;
}

/**
 * {@link passMemoryGate} for a top-level run: at the Admission Deadline it
 * prints why and exits with EXIT_ADMISSION_BLOCKED.
 */
export async function passMemoryGateOrExit(
  options: MemoryGateOptions = {},
): Promise<boolean> {
  try {
    return await passMemoryGate(options);
  } catch (error) {
    if (!(error instanceof MemoryGateClosedError)) throw error;
    console.error(
      `${error.message}\nReport this as blocked by the Memory Gate, not as a test failure. Exit ${EXIT_ADMISSION_BLOCKED}.`,
    );
    process.exit(EXIT_ADMISSION_BLOCKED);
  }
}
