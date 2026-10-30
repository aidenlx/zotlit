// Runs use available memory and wait in arrival order while pressure is high.
import { regex } from "arkregex";
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

const children: ReturnType<typeof spawn>[] = [];
let dir: string;
let journal: string;
let lastStart: string;
let pressure: string;
let probes: string;
beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "memory-gate-"));
  dir = join(root, "state");
  await mkdir(dir);
  journal = join(root, "journal");
  lastStart = join(dir, "last-start");
  pressure = join(root, "pressure");
  probes = join(root, "probes");
  await writeFile(pressure, "1");
});
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit");
      child.kill("SIGKILL");
      await exit;
    }
  }
  await rm(join(dir, ".."), { recursive: true, force: true });
});

/** Start the gate around a command that appends `ran` to the journal. */
function gated(env: NodeJS.ProcessEnv = {}, body?: string) {
  const command =
    body ??
    `require("node:fs").appendFileSync(${JSON.stringify(journal)}, "ran\\n")`;
  const child = spawn(
    process.execPath,
    [
      "--import",
      new URL("./__fixtures__/memory-pressure.ts", import.meta.url).href,
      SCRIPT,
      "--",
      process.execPath,
      "-e",
      command,
    ],
    {
      env: {
        ...process.env,
        [DESKTOP_DIR_ENV]: dir,
        ZOTLIT_TEST_PRESSURE: pressure,
        ZOTLIT_TEST_PROBES: probes,
        [MEMORY_GATE_ENV]: "",
        [MEMORY_GATE_ADMITTED_ENV]: "",
        ...env,
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  children.push(child);
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

it("starts consecutive runs while pressure is normal, even after a recent start", async () => {
  await writeFile(lastStart, now());
  const first = gated({ [DESKTOP_WAIT_ENV]: "1s" });
  expect(await first.exit).toBe(0);
  const second = gated({ [DESKTOP_WAIT_ENV]: "1s" });
  expect(await second.exit).toBe(0);
  expect(await ran()).toBe("ran\nran\n");
});

it("expires a lock left by a killed run", async () => {
  const lock = join(dir, "last-start.lock");
  await mkdir(lock);
  await utimes(lock, 0, 0);
  const waiting = gated();
  expect(await waiting.exit).toBe(0);
  expect(await ran()).toBe("ran\n");
});

it("gives up under memory pressure with exit 75 and runs nothing", async () => {
  await writeFile(pressure, "2");
  const blocked = gated({ [DESKTOP_WAIT_ENV]: "1s" });
  expect(await blocked.until(regex("blocked by the Memory Gate"))).toContain(
    "still closed at the Admission Deadline: macOS memory pressure is warning",
  );
  expect(await blocked.exit).toBe(EXIT_ADMISSION_BLOCKED);
  expect(await ran()).toBe("");
  await writeFile(pressure, "1");
  expect(await gated().exit).toBe(0);
});

it("admits the oldest waiter before a newer run", async () => {
  await writeFile(pressure, "2");
  const older = gated(
    {},
    `require("node:fs").appendFileSync(${JSON.stringify(journal)}, "older\\n")`,
  );
  await older.until(regex("macOS memory pressure"));
  const newer = gated();
  expect(await newer.until(regex("waiting behind pid"))).toContain(
    "waiting behind pid",
  );
  await writeFile(pressure, "1");
  expect(await older.exit).toBe(0);
  expect(await newer.exit).toBe(0);
  expect(await readFile(probes, "utf8")).toBe(
    `${older.child.pid}\n${newer.child.pid}\n`,
  );
  expect((await ran()).trim().split("\n").sort()).toEqual(["older", "ran"]);
});

it("removes a killed waiter so the next run can start", async () => {
  await writeFile(pressure, "2");
  const killed = gated();
  await killed.until(regex("macOS memory pressure"));
  killed.child.kill("SIGKILL");
  await killed.exit;
  await writeFile(pressure, "1");
  const next = gated({ [DESKTOP_WAIT_ENV]: "2s" });
  expect(await next.exit).toBe(0);
  expect(await ran()).toBe("ran\n");
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

it("documents itself under --help and rejects a missing command with exit 2", async () => {
  const cli = async (...args: string[]) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, [DESKTOP_DIR_ENV]: dir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += String(chunk)));
    child.stderr.on("data", (chunk: Buffer) => (output += String(chunk)));
    const [code] = await once(child, "exit");
    return { code: code as number | null, output };
  };
  const help = await cli("--help");
  expect(help.code).toBe(0);
  expect(help.output).toContain(`${MEMORY_GATE_ENV}=off`);
  expect(help.output).toContain(String(EXIT_ADMISSION_BLOCKED));
  const missing = await cli();
  expect(missing.code).toBe(2);
  expect(missing.output).toContain("-- <command>");
});
