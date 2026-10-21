// A run waits for the OS to report room and for the previous run to settle.
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  DESKTOP_DIR_ENV,
  DESKTOP_WAIT_ENV,
  EXIT_ADMISSION_BLOCKED,
  linuxVerdict,
  macosVerdict,
  MEMORY_GATE_ADMITTED_ENV,
  MEMORY_GATE_ENV,
  windowsVerdict,
} from "@zotlit/config/memory-gate";

const SCRIPT = new URL("../scripts/memory-gate.ts", import.meta.url).pathname;
const GiB = 1024 * 1024;

let dir: string;
let journal: string;
let lastStart: string;
beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "memory-gate-"));
  dir = join(root, "state");
  await mkdir(dir);
  journal = join(root, "journal");
  lastStart = join(dir, "last-start");
});
afterEach(async () => {
  await rm(join(dir, ".."), { recursive: true, force: true });
});

/** Start the gate around a command that appends `ran` to the journal. */
function gated(env: NodeJS.ProcessEnv = {}, body?: string) {
  const command =
    body ??
    `require("node:fs").appendFileSync(${JSON.stringify(journal)}, "ran\\n")`;
  const child = spawn(
    process.execPath,
    [SCRIPT, "--", process.execPath, "-e", command],
    {
      env: {
        ...process.env,
        [DESKTOP_DIR_ENV]: dir,
        [MEMORY_GATE_ENV]: "",
        [MEMORY_GATE_ADMITTED_ENV]: "",
        ...env,
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let stderr = "";
  const exit = once(child, "exit").then(([code]) => code as number | null);
  /** Resolve once stderr matches, or with all of it at exit. */
  const until = (pattern: RegExp) =>
    new Promise<string>((resolve) => {
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += String(chunk);
        if (pattern.test(stderr)) resolve(stderr);
      });
      void exit.then(() => resolve(stderr));
    });
  return { child, until, exit };
}

async function ran(): Promise<string> {
  return await readFile(journal, "utf8").catch(() => "");
}

const now = () => Temporal.Now.instant().toString();

it("waits while another gated run started under 30 s ago", async () => {
  await writeFile(lastStart, now());
  const waiting = gated();
  expect(await waiting.until(/waiting/)).toMatch(
    /waiting: another run started under 30 s ago/,
  );
  waiting.child.kill();
  await waiting.exit;
  expect(await ran()).toBe("");
});

it("expires a lock left by a killed run", async () => {
  const lock = join(dir, "last-start.lock");
  await mkdir(lock);
  await utimes(lock, 0, 0);
  await writeFile(lastStart, now());
  const waiting = gated();
  // Past the lock, the next check is the settle time.
  expect(await waiting.until(/started under/)).toMatch(
    /started under 30 s ago/,
  );
  waiting.child.kill();
  await waiting.exit;
});

it("gives up at the Admission Deadline with exit 75 and runs nothing", async () => {
  await writeFile(lastStart, now());
  const blocked = gated({ [DESKTOP_WAIT_ENV]: "1s" });
  expect(await blocked.until(/blocked by the Memory Gate/)).toMatch(
    /still closed at the Admission Deadline: another run started under 30 s ago/,
  );
  expect(await blocked.exit).toBe(EXIT_ADMISSION_BLOCKED);
  expect(await ran()).toBe("");
});

it("runs at once with the gate off, with the command's exit code", async () => {
  await writeFile(lastStart, now());
  const ungated = gated({ [MEMORY_GATE_ENV]: "off" });
  expect(await ungated.exit).toBe(0);
  expect(await ran()).toBe("ran\n");
  const failing = gated({ [MEMORY_GATE_ENV]: "off" }, "process.exit(3)");
  expect(await failing.exit).toBe(3);
});

it("is skipped under a run it already admitted", async () => {
  await writeFile(lastStart, now());
  const nested = gated({ [MEMORY_GATE_ADMITTED_ENV]: "1" });
  expect(await nested.exit).toBe(0);
  expect(await ran()).toBe("ran\n");
});

it("opens on each OS's reading up to its limit", () => {
  expect(macosVerdict(1)).toBeUndefined();
  expect(macosVerdict(2)).toBe("macOS memory pressure is warning");
  expect(macosVerdict(4)).toBe("macOS memory pressure is critical");

  // 16 GiB physical; Windows reports KiB.
  const windows = (committedGiB: number) => ({
    TotalVisibleMemorySize: 16 * GiB,
    TotalVirtualMemorySize: 40 * GiB,
    FreeVirtualMemory: (40 - committedGiB) * GiB,
  });
  expect(windowsVerdict(windows(20))).toBeUndefined();
  expect(windowsVerdict(windows(24))).toBe(
    "memory committed at 1.50x physical, above 1.25x",
  );

  const meminfo = (availableGiB: number, swapUsedGiB: number) =>
    [
      `MemTotal:       ${16 * GiB} kB`,
      `MemFree:          123456 kB`,
      `MemAvailable:   ${availableGiB * GiB} kB`,
      `SwapTotal:      ${8 * GiB} kB`,
      `SwapFree:       ${(8 - swapUsedGiB) * GiB} kB`,
    ].join("\n");
  expect(linuxVerdict(meminfo(2, 4))).toBeUndefined();
  expect(linuxVerdict(meminfo(0, 8))).toBe(
    "memory committed at 1.50x physical, above 1.25x",
  );
});
