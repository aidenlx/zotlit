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
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireDesktopLock, DESKTOP_LOCK_ENV } from "./desktop-lock.ts";

let dir: string;
let path: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "desktop-lock-"));
  path = join(dir, "zotlit-desktop.lock");
  delete process.env[DESKTOP_LOCK_ENV];
});
afterEach(async () => {
  delete process.env[DESKTOP_LOCK_ENV];
  await rm(dir, { recursive: true, force: true });
});

describe("a free lock", () => {
  it("is taken at once, records its owner, and is gone after release", async () => {
    const lock = await acquireDesktopLock({
      path,
      command: "pnpm e2e",
      worktree: "/work/tree",
    });
    const owner = JSON.parse(await readFile(join(path, "owner.json"), "utf8"));
    expect(owner).toMatchObject({
      pid: process.pid,
      command: "pnpm e2e",
      worktree: "/work/tree",
    });
    expect(() => Temporal.Instant.from(owner.startedAt)).not.toThrow();
    expect(process.env[DESKTOP_LOCK_ENV]).toBe(owner.token);
    lock.release();
    await expect(readFile(join(path, "owner.json"))).rejects.toThrow("ENOENT");
    expect(process.env[DESKTOP_LOCK_ENV]).toBeUndefined();
  });
});

const MODULE = new URL("./desktop-lock.ts", import.meta.url).href;

/** Run `body` in a child Node process with `lock` bound to the lock module. */
function child(body: string, env: NodeJS.ProcessEnv = {}): ChildProcess {
  const code = `const lock = await import(${JSON.stringify(MODULE)});\n${body}`;
  return spawn(process.execPath, ["--input-type=module", "-e", code], {
    env: { ...process.env, LOCK_PATH: path, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Resolve when the child prints `line`. */
async function printed(process: ChildProcess, line: string): Promise<void> {
  let output = "";
  for await (const chunk of process.stdout!) {
    output += String(chunk);
    if (output.split("\n").includes(line)) return;
  }
  throw new Error(`exited before printing ${line}: ${output}`);
}

async function exists(file: string): Promise<boolean> {
  return await stat(file).then(
    () => true,
    () => false,
  );
}

/** The pid of a process that has exited. */
async function deadPid(): Promise<number> {
  const gone = spawn(process.execPath, ["-e", ""]);
  await once(gone, "exit");
  return gone.pid!;
}

const HOLD = `await lock.acquireDesktopLock({ path: process.env.LOCK_PATH, command: "holder", pollMs: 10 });
console.log("held");
setInterval(() => {}, 1000);`;

describe("a live holder", () => {
  it("makes a waiter wait, names it once, and lets go on SIGTERM", async () => {
    const holder = child(HOLD);
    await printed(holder, "held");
    const messages: string[] = [];
    let acquired = false;
    const waiting = acquireDesktopLock({
      path,
      pollMs: 10,
      log: (message) => messages.push(message),
    }).then((lock) => {
      acquired = true;
      return lock;
    });
    await delay(300);
    expect(acquired).toBe(false);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(`pid ${holder.pid} (holder)`);

    holder.kill("SIGTERM");
    const [, signal] = await once(holder, "exit");
    expect(signal).toBe("SIGTERM");
    const lock = await waiting;
    expect(lock.owner.pid).toBe(process.pid);
    expect(messages).toHaveLength(1);
    lock.release();
  });

  it("is named again after the reminder interval", async () => {
    const holder = child(HOLD);
    await printed(holder, "held");
    const messages: string[] = [];
    const waiting = acquireDesktopLock({
      path,
      pollMs: 10,
      remindMs: 100,
      log: (message) => messages.push(message),
    });
    await delay(350);
    expect(messages.length).toBeGreaterThanOrEqual(3);
    holder.kill("SIGTERM");
    (await waiting).release();
  });
});

describe("a dead holder", () => {
  it("is taken over", async () => {
    await mkdir(path);
    const pid = await deadPid();
    await writeFile(
      join(path, "owner.json"),
      JSON.stringify({ token: "old", pid, command: "crashed", worktree: "/w" }),
    );
    const messages: string[] = [];
    const lock = await acquireDesktopLock({
      path,
      pollMs: 10,
      log: (message) => messages.push(message),
    });
    expect(lock.owner.pid).toBe(process.pid);
    expect(messages.join("\n")).toContain(`pid ${pid} (crashed) is gone`);
    lock.release();
  });

  it("includes an acquire that died before it wrote its record", async () => {
    await mkdir(path);
    const old = Temporal.Now.instant().epochMilliseconds / 1000 - 60;
    await utimes(path, old, old);
    const lock = await acquireDesktopLock({ path, pollMs: 10 });
    expect(lock.owner.pid).toBe(process.pid);
    lock.release();
  });
});

it("lets one of several racing acquirers hold it at a time", async () => {
  // Start from a dead holder, so the racers also race the takeover.
  await mkdir(path);
  const pid = await deadPid();
  await writeFile(
    join(path, "owner.json"),
    JSON.stringify({ token: "old", pid, command: "crashed", worktree: "/w" }),
  );
  const trace = join(dir, "trace");
  await writeFile(trace, "");
  const racers = Array.from({ length: 5 }, () =>
    child(
      `const { appendFileSync } = await import("node:fs");
const held = await lock.acquireDesktopLock({ path: process.env.LOCK_PATH, pollMs: 5, log: () => {} });
appendFileSync(process.env.TRACE, "+" + process.pid + "\\n");
await new Promise((resolve) => setTimeout(resolve, 50));
appendFileSync(process.env.TRACE, "-" + process.pid + "\\n");
held.release();`,
      { TRACE: trace },
    ),
  );
  const codes = await Promise.all(
    racers.map(async (racer) => (await once(racer, "exit"))[0]),
  );
  expect(codes).toEqual([0, 0, 0, 0, 0]);
  const lines = (await readFile(trace, "utf8")).trim().split("\n");
  expect(lines).toHaveLength(10);
  for (let index = 0; index < lines.length; index += 2) {
    expect(lines[index]).toMatch(/^\+/);
    expect(lines[index + 1]).toBe(`-${lines[index]!.slice(1)}`);
  }
  expect(await exists(path)).toBe(false);
});

describe("release", () => {
  it("happens when the task throws", async () => {
    const thrower = child(
      `await lock.withDesktopLock(async () => { throw new Error("boom"); }, { path: process.env.LOCK_PATH });`,
    );
    const [code] = await once(thrower, "exit");
    expect(code).not.toBe(0);
    expect(await exists(path)).toBe(false);
  });

  it("happens when the process exits while it holds the lock", async () => {
    const quitter = child(
      `await lock.acquireDesktopLock({ path: process.env.LOCK_PATH });
process.exit(3);`,
    );
    const [code] = await once(quitter, "exit");
    expect(code).toBe(3);
    expect(await exists(path)).toBe(false);
  });

  it("happens on SIGINT", async () => {
    const holder = child(HOLD);
    await printed(holder, "held");
    holder.kill("SIGINT");
    const [, signal] = await once(holder, "exit");
    expect(signal).toBe("SIGINT");
    expect(await exists(path)).toBe(false);
  });
});

describe("a child of the holder", () => {
  it("reuses the lock at once and leaves it held", async () => {
    const lock = await acquireDesktopLock({ path });
    const nested = child(
      `const inner = await lock.acquireDesktopLock({ path: process.env.LOCK_PATH, pollMs: 10, log: () => {} });
console.log(inner.reused ? "reused" : "own");
inner.release();`,
    );
    await printed(nested, "reused");
    await once(nested, "exit");
    expect(await exists(join(path, "owner.json"))).toBe(true);
    lock.release();
  });

  it("acquires normally when the inherited token is not the holder's", async () => {
    process.env[DESKTOP_LOCK_ENV] = "stale";
    const lock = await acquireDesktopLock({ path });
    expect(lock.reused).toBe(false);
    lock.release();
  });
});

describe("the desktop-lock command", () => {
  const SCRIPT = new URL("../scripts/desktop-lock.ts", import.meta.url)
    .pathname;

  /** Run the command in a fresh git repository under the temp dir. */
  async function wrap(...command: string[]) {
    const repo = join(dir, "repo");
    await mkdir(repo, { recursive: true });
    await once(spawn("git", ["init", "--quiet"], { cwd: repo }), "exit");
    const wrapper = spawn(process.execPath, [SCRIPT, "--", ...command], {
      cwd: repo,
      env: { ...process.env, [DESKTOP_LOCK_ENV]: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    wrapper.stdout.on("data", (chunk) => (stdout += String(chunk)));
    const [code] = await once(wrapper, "exit");
    return { code, stdout, lock: join(repo, ".git", "zotlit-desktop.lock") };
  }

  it("holds the lock under the git common dir while the command runs", async () => {
    const { code, stdout, lock } = await wrap(
      process.execPath,
      "-e",
      `const { existsSync } = require("node:fs");
console.log(existsSync(process.argv[1]) ? "locked" : "free", process.env.${DESKTOP_LOCK_ENV} ? "token" : "none");`,
      join(dir, "repo", ".git", "zotlit-desktop.lock"),
    );
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("locked token");
    expect(await exists(lock)).toBe(false);
  });

  it("passes the exit code of the command through", async () => {
    const { code, lock } = await wrap(
      process.execPath,
      "-e",
      "process.exit(7)",
    );
    expect(code).toBe(7);
    expect(await exists(lock)).toBe(false);
  });

  it("exits with 128 plus the signal number when a signal ends the command", async () => {
    const { code } = await wrap(
      process.execPath,
      "-e",
      'process.kill(process.pid, "SIGTERM")',
    );
    expect(code).toBe(143);
  });
});
