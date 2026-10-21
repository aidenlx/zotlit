import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DESKTOP_DIR_ENV,
  MEMORY_GATE_ADMITTED_ENV,
  MEMORY_GATE_ENV,
} from "@zotlit/config/memory-gate";

import {
  acquireDesktopSlot,
  DESKTOP_SLOT_ENV,
  DesktopSlotBlockedError,
  EXIT_ADMISSION_BLOCKED,
  EXIT_LEASE_ENDED,
  extendDesktopSlot,
  readDesktopSlotStatus,
} from "./desktop-slot.ts";

const MINUTE = 60_000;
const ENV_KEYS = [
  DESKTOP_DIR_ENV,
  DESKTOP_SLOT_ENV,
  MEMORY_GATE_ENV,
  MEMORY_GATE_ADMITTED_ENV,
];
const saved = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "desktop-slot-"));
  process.env[DESKTOP_DIR_ENV] = dir;
  // The Memory Gate has its own tests; here it would add a 30 s settle.
  process.env[MEMORY_GATE_ENV] = "off";
  delete process.env[DESKTOP_SLOT_ENV];
  delete process.env[MEMORY_GATE_ADMITTED_ENV];
});
afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  await rm(dir, { recursive: true, force: true });
});

/** Options for an in-process holder that must not end the test run. */
const IN_TEST = {
  leaseMs: 30 * MINUTE,
  pollMs: 10,
  onLeaseEnd: () => {},
  log: () => {},
};

const MODULE = new URL("./desktop-slot.ts", import.meta.url).href;

/** Run `body` in a child Node process with `slot` bound to the slot module. */
function child(
  body: string,
  env: NodeJS.ProcessEnv = {},
  detached = false,
): ChildProcess {
  const code = `const slot = await import(${JSON.stringify(MODULE)});\n${body}`;
  return spawn(process.execPath, ["--input-type=module", "-e", code], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached,
  });
}

/**
 * Resolve when the child prints a line that matches. The stream stays open:
 * the child may print more.
 */
async function printed(
  process: ChildProcess,
  line: string | RegExp,
): Promise<void> {
  const matches = (each: string) =>
    typeof line === "string" ? each === line : line.test(each);
  let output = "";
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      output += String(chunk);
      if (!output.split("\n").some(matches)) return;
      process.stdout!.off("data", onData);
      process.stdout!.resume();
      resolve();
    };
    process.stdout!.on("data", onData);
    process.stdout!.once("end", () =>
      reject(new Error(`exited before printing ${String(line)}: ${output}`)),
    );
  });
}

async function exists(file: string): Promise<boolean> {
  return await stat(file).then(
    () => true,
    () => false,
  );
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Resolve once `pid` is gone; its new parent reaps it a moment after it dies. */
async function gone(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 100 && isAlive(pid); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !isAlive(pid);
}

/** The pid of a process that has exited. */
async function deadPid(): Promise<number> {
  const gone = spawn(process.execPath, ["-e", ""]);
  await once(gone, "exit");
  return gone.pid!;
}

/** A child that holds the slot until a signal ends it. */
const HOLD = `await slot.acquireDesktopSlot({ command: "holder", leaseMs: 30 * 60_000, pollMs: 10 });
console.log("held");
setInterval(() => {}, 1000);`;

/** A child that waits in the Desktop Queue, printing what it waits for. */
function waiter(name: string, pollMs: number, trace: string): ChildProcess {
  return child(
    `const { appendFileSync } = await import("node:fs");
const held = await slot.acquireDesktopSlot({ command: ${JSON.stringify(name)}, leaseMs: 60_000, pollMs: ${pollMs}, log: (message) => console.log(message) });
appendFileSync(${JSON.stringify(trace)}, ${JSON.stringify(name)} + "\\n");
held.release();`,
    // Not a child of an in-process holder: it waits in the queue.
    { [DESKTOP_SLOT_ENV]: "" },
  );
}

const OWNER = () => join(dir, "slot", "owner.json");

describe("a free slot", () => {
  it("is taken at once, records its holder and Lease, and is gone after release", async () => {
    const slot = await acquireDesktopSlot({
      ...IN_TEST,
      command: "pnpm e2e",
      worktree: "/work/tree",
    });
    const { holder } = await readDesktopSlotStatus();
    expect(holder).toMatchObject({
      pid: process.pid,
      command: "pnpm e2e",
      worktree: "/work/tree",
      lease: 30 * MINUTE,
    });
    expect(
      Temporal.Instant.from(holder!.leaseEndsAt)
        .since(Temporal.Instant.from(holder!.admittedAt))
        .total("minutes"),
    ).toBe(30);
    expect(process.env[DESKTOP_SLOT_ENV]).toBe(holder!.token);
    slot.release();
    expect((await readDesktopSlotStatus()).holder).toBeUndefined();
    expect(process.env[DESKTOP_SLOT_ENV]).toBeUndefined();
  });
});

describe("the Desktop Queue", () => {
  it("passes the slot on in enqueue order, not poll order", async () => {
    const holder = await acquireDesktopSlot(IN_TEST);
    const trace = join(dir, "trace");
    await writeFile(trace, "");
    // Each joins once the one before it is queued. The first in line polls
    // slowest, yet it still goes first.
    const waiters: ChildProcess[] = [];
    for (const [name, pollMs] of [
      ["first", 200],
      ["second", 20],
      ["third", 5],
    ] as const) {
      const each = waiter(name, pollMs, trace);
      waiters.push(each);
      await printed(each, new RegExp(`position ${waiters.length} of`));
    }
    holder.release();
    const codes = await Promise.all(
      waiters.map(async (each) => (await once(each, "exit"))[0]),
    );
    expect(codes).toEqual([0, 0, 0]);
    expect(await readFile(trace, "utf8")).toBe("first\nsecond\nthird\n");
  });

  it("reaps the ticket of a dead waiter", async () => {
    const holder = child(HOLD);
    await printed(holder, "held");
    const doomed = waiter("doomed", 10, join(dir, "trace"));
    await printed(doomed, /position 1 of/);
    doomed.kill("SIGKILL");
    await once(doomed, "exit");

    const waiting = acquireDesktopSlot(IN_TEST);
    holder.kill("SIGTERM");
    const slot = await waiting;
    expect(slot.reused).toBe(false);
    expect((await readDesktopSlotStatus()).waiters).toEqual([]);
    slot.release();
  });

  it("gives up at the Admission Deadline, naming the holder and the waiters ahead", async () => {
    const holder = child(HOLD);
    await printed(holder, "held");
    const ahead = waiter("ahead", 10, join(dir, "trace"));
    await printed(ahead, /position 1 of/);

    const error = await acquireDesktopSlot({ ...IN_TEST, waitMs: 200 }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(DesktopSlotBlockedError);
    const message = (error as Error).message;
    expect(message).toContain(`pid ${holder.pid} (holder)`);
    expect(message).toContain(`pid ${ahead.pid} (ahead)`);
    const { waiters } = await readDesktopSlotStatus();
    expect(waiters.map((ticket) => ticket.pid)).toEqual([ahead.pid]);

    ahead.kill("SIGTERM");
    holder.kill("SIGTERM");
    await Promise.all([once(ahead, "exit"), once(holder, "exit")]);
  });
});

describe("a dead holder", () => {
  it("is taken over", async () => {
    await mkdir(join(dir, "slot"));
    const pid = await deadPid();
    await writeFile(
      OWNER(),
      JSON.stringify({ token: "old", pid, command: "crashed", worktree: "/w" }),
    );
    const messages: string[] = [];
    const slot = await acquireDesktopSlot({
      ...IN_TEST,
      log: (message) => messages.push(message),
    });
    expect(slot.owner.pid).toBe(process.pid);
    expect(messages.join("\n")).toContain(`pid ${pid} (crashed) is gone`);
    slot.release();
  });

  it("includes a holder whose pid now belongs to a new process, which is never signalled", async () => {
    await mkdir(join(dir, "slot"));
    const ended = Temporal.Now.instant().subtract({ hours: 3 }).toString();
    await writeFile(
      OWNER(),
      JSON.stringify({
        token: "old",
        pid: process.pid,
        processStart: "Thu Jan  1 00:00:00 1970",
        command: "crashed",
        worktree: "/w",
        admittedAt: ended,
        lease: MINUTE,
        leaseEndsAt: ended,
      }),
    );
    const messages: string[] = [];
    const slot = await acquireDesktopSlot({
      ...IN_TEST,
      log: (message) => messages.push(message),
    });
    expect(slot.reused).toBe(false);
    expect(messages.join("\n")).toContain(
      `pid ${process.pid} (crashed) is gone`,
    );
    slot.release();
  });

  it("includes a claim that died before it wrote its record", async () => {
    await mkdir(join(dir, "slot"));
    const old = Temporal.Now.instant().epochMilliseconds / 1000 - 60;
    await utimes(join(dir, "slot"), old, old);
    const slot = await acquireDesktopSlot(IN_TEST);
    expect(slot.owner.pid).toBe(process.pid);
    slot.release();
  });
});

describe("the Lease", () => {
  it("ends an in-process holder with exit 76 and frees the slot", async () => {
    const holder = child(
      `await slot.acquireDesktopSlot({ leaseMs: 200, log: (message) => console.log(message) });
setInterval(() => {}, 1000);`,
    );
    await printed(holder, /Lease .* ended/);
    const [code] = await once(holder, "exit");
    expect(code).toBe(EXIT_LEASE_ENDED);
    expect(await exists(OWNER())).toBe(false);
  });

  it("is overdue past its grace, so the head waiter evicts the holder and takes the slot", async () => {
    const holder = child(HOLD, {}, true);
    const exited = once(holder, "exit");
    await printed(holder, "held");
    const messages: string[] = [];
    const slot = await acquireDesktopSlot({
      ...IN_TEST,
      // The holder's 30 min Lease and its 2 min grace have passed.
      now: () => Temporal.Now.instant().add({ minutes: 33 }).epochMilliseconds,
      log: (message) => messages.push(message),
    });
    const [, signal] = await exited;
    expect(signal).toBe("SIGTERM");
    expect(messages.join("\n")).toContain(`evicting pid ${holder.pid}`);
    slot.release();
  });

  it("extends while no one waits, and is refused while someone does", async () => {
    const slot = await acquireDesktopSlot(IN_TEST);
    const extended = await extendDesktopSlot({
      token: slot.owner.token,
      byMs: 45 * MINUTE,
    });
    const left = Temporal.Instant.from(extended.leaseEndsAt)
      .since(Temporal.Now.instant())
      .total("minutes");
    expect(left).toBeGreaterThan(44);
    expect(left).toBeLessThanOrEqual(45);

    const queued = waiter("queued", 10, join(dir, "trace"));
    await printed(queued, /position 1 of/);
    await expect(
      extendDesktopSlot({ token: slot.owner.token, byMs: MINUTE }),
    ).rejects.toThrow(`pid ${queued.pid} (queued)`);
    slot.release();
    expect((await once(queued, "exit"))[0]).toBe(0);
  });
});

describe("a child of the holder", () => {
  it("reuses the slot at once and leaves it held", async () => {
    const slot = await acquireDesktopSlot(IN_TEST);
    const nested = child(
      `const inner = await slot.acquireDesktopSlot({ leaseMs: 60_000, pollMs: 10, log: () => {} });
console.log(inner.reused ? "reused" : "own");
inner.release();`,
    );
    await printed(nested, "reused");
    await once(nested, "exit");
    expect(await exists(OWNER())).toBe(true);
    slot.release();
  });

  it("joins the queue once the holder's Lease has ended", async () => {
    const slot = await acquireDesktopSlot(IN_TEST);
    const error = await acquireDesktopSlot({
      ...IN_TEST,
      waitMs: 100,
      // Past the Lease, inside the grace that keeps the holder from eviction.
      now: () => Temporal.Now.instant().add({ minutes: 31 }).epochMilliseconds,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(DesktopSlotBlockedError);
    expect(await exists(OWNER())).toBe(true);
    slot.release();
  });

  it("acquires normally when the inherited token is not the holder's", async () => {
    process.env[DESKTOP_SLOT_ENV] = "stale";
    const slot = await acquireDesktopSlot(IN_TEST);
    expect(slot.reused).toBe(false);
    slot.release();
  });
});

describe("the desktop-slot command", () => {
  const SCRIPT = new URL("../scripts/desktop-slot.ts", import.meta.url)
    .pathname;

  async function cli(...args: string[]) {
    const run = spawn(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, [DESKTOP_SLOT_ENV]: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    run.stdout.on("data", (chunk) => (stdout += String(chunk)));
    run.stderr.on("data", (chunk) => (stderr += String(chunk)));
    const [code] = await once(run, "exit");
    return { code, stdout, stderr };
  }

  it("holds the slot while the command runs and passes its exit code through", async () => {
    const { code, stdout } = await cli(
      "run",
      "--for",
      "1m",
      "--",
      process.execPath,
      "-e",
      `const { existsSync } = require("node:fs");
console.log(existsSync(process.argv[1]) ? "held" : "free", process.env.${DESKTOP_SLOT_ENV} ? "token" : "none");
process.exit(7);`,
      OWNER(),
    );
    expect(code).toBe(7);
    expect(stdout.trim()).toBe("held token");
    expect(await exists(OWNER())).toBe(false);
  });

  it("exits with 128 plus the signal number when a signal ends the command", async () => {
    const { code } = await cli(
      "run",
      "--for",
      "1m",
      "--",
      process.execPath,
      "-e",
      'process.kill(process.pid, "SIGTERM")',
    );
    expect(code).toBe(143);
  });

  it.each([[[]], [["--for", "61m"]]])(
    "rejects a manual hold without a Lease up to 60 min (%j)",
    async (lease) => {
      const { code, stderr } = await cli("run", ...lease, "--", "true");
      expect(code).toBe(2);
      expect(stderr).toContain("--for");
    },
  );

  it("exits 75 at the Admission Deadline and names the holder", async () => {
    const holder = child(HOLD);
    await printed(holder, "held");
    const { code, stderr } = await cli(
      "run",
      "--for",
      "1m",
      "--wait",
      "200ms",
      "--",
      "true",
    );
    expect(code).toBe(EXIT_ADMISSION_BLOCKED);
    expect(stderr).toContain(`pid ${holder.pid} (holder)`);
    expect((await readDesktopSlotStatus()).waiters).toEqual([]);
    holder.kill("SIGTERM");
    await once(holder, "exit");
  });

  it("ends the command's whole process group at the Lease and exits 76", async () => {
    const pidFile = join(dir, "grandchild");
    const { code } = await cli(
      "run",
      "--for",
      "1s",
      "--",
      "sh",
      "-c",
      `sleep 60 & echo $! > ${pidFile}; wait`,
    );
    expect(code).toBe(EXIT_LEASE_ENDED);
    const grandchild = Number(await readFile(pidFile, "utf8"));
    expect(await gone(grandchild)).toBe(true);
    expect(await exists(OWNER())).toBe(false);
  });
});
