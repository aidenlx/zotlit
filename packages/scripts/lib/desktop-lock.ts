// One process at a time drives the one desktop Obsidian and its Paired Zotero
// on this machine. The lock is a directory under the clone's common git
// directory, so every worktree of the clone sees the same lock. mkdir is the
// atomic acquire; the owner record inside tells a waiter who holds it.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

/** Holds the owner token; a child process that inherits it reuses the lock. */
export const DESKTOP_LOCK_ENV = "ZOTLIT_DESKTOP_LOCK";

const LOCK_NAME = "zotlit-desktop.lock";
const OWNER_FILE = "owner.json";
/** A lock directory without an owner record this long is an abandoned acquire. */
const ORPHAN_MS = 10_000;
/** A takeover mutex this old belongs to a waiter that died during takeover. */
const STALE_TAKEOVER_MS = 30_000;
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export interface DesktopLockOwner {
  token: string;
  pid: number;
  command: string;
  worktree: string;
  startedAt: string;
}

export interface DesktopLockOptions {
  /** The lock directory. Defaults to the one under the git common dir of `cwd`. */
  path?: string;
  /** Resolves the default path and the recorded worktree. */
  cwd?: string;
  /** What the holder runs, shown to waiters. */
  command?: string;
  worktree?: string;
  pollMs?: number;
  /** How often a waiter repeats who holds the lock. */
  remindMs?: number;
  log?: (message: string) => void;
  /** Release on SIGINT, SIGTERM, and SIGHUP. Turn off when the caller handles signals. */
  signals?: boolean;
}

export interface DesktopLock extends Disposable {
  readonly path: string;
  readonly owner: DesktopLockOwner;
  /** True when an ancestor process holds the lock and this process reuses it. */
  readonly reused: boolean;
  /** Idempotent. A reused lock stays with its holder. */
  release(): void;
}

/** The lock path shared by every worktree of the clone that holds `cwd`. */
export async function desktopLockPath(cwd: string): Promise<string> {
  const { stdout } = await promisify(execFile)(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd },
  );
  return join(stdout.trim(), LOCK_NAME);
}

/** Wait until this process holds the desktop lock. */
export async function acquireDesktopLock(
  options: DesktopLockOptions = {},
): Promise<DesktopLock> {
  const cwd = options.cwd ?? process.cwd();
  const path = options.path ?? (await desktopLockPath(cwd));
  const log = options.log ?? ((message: string) => console.error(message));
  const pollMs = options.pollMs ?? 2000;
  const remindMs = options.remindMs ?? 5 * 60_000;

  const inherited = process.env[DESKTOP_LOCK_ENV];
  if (inherited) {
    const owner = await readOwner(path);
    if (owner?.token === inherited && isAlive(owner.pid)) {
      return reusedLock(path, owner);
    }
  }

  const owner: DesktopLockOwner = {
    token: randomUUID(),
    pid: process.pid,
    command: options.command ?? process.argv.slice(1).join(" "),
    worktree: options.worktree ?? cwd,
    startedAt: Temporal.Now.instant().toString(),
  };
  let reported: { token: string | undefined; at: number } | undefined;
  for (;;) {
    if (await tryCreate(path, owner)) return heldLock(path, owner, options);
    const holder = await readOwner(path);
    if (holder && !isAlive(holder.pid)) {
      log(
        `Desktop lock: pid ${holder.pid} (${holder.command}) is gone; taking over ${path}.`,
      );
      await takeOver(path, holder);
      continue;
    }
    if (!holder && (await age(path)) > ORPHAN_MS) {
      await takeOver(path, undefined);
      continue;
    }
    const now = epochMs();
    if (
      holder &&
      (reported?.token !== holder.token || now - reported.at >= remindMs)
    ) {
      log(
        `Desktop lock: waiting for pid ${holder.pid} (${holder.command}) in ${holder.worktree}, holding since ${holder.startedAt}. Lock: ${path}`,
      );
      reported = { token: holder.token, at: now };
    }
    await delay(pollMs);
  }
}

/** Run `task` while this process holds the desktop lock. */
export async function withDesktopLock<T>(
  task: () => Promise<T>,
  options?: DesktopLockOptions,
): Promise<T> {
  using _lock = await acquireDesktopLock(options);
  return await task();
}

async function tryCreate(
  path: string,
  owner: DesktopLockOwner,
): Promise<boolean> {
  try {
    await mkdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  // Rename makes the record appear whole to a waiter that reads it.
  const draft = join(path, `${OWNER_FILE}.${owner.token}`);
  await writeFile(draft, JSON.stringify(owner));
  await rename(draft, join(path, OWNER_FILE));
  return true;
}

function parseOwner(text: string): DesktopLockOwner | undefined {
  try {
    const owner = JSON.parse(text) as Partial<DesktopLockOwner>;
    if (typeof owner.token !== "string" || typeof owner.pid !== "number") {
      return undefined;
    }
    return owner as DesktopLockOwner;
  } catch {
    return undefined;
  }
}

async function readOwner(path: string): Promise<DesktopLockOwner | undefined> {
  try {
    return parseOwner(await readFile(join(path, OWNER_FILE), "utf8"));
  } catch {
    return undefined;
  }
}

function readOwnerSync(path: string): DesktopLockOwner | undefined {
  try {
    return parseOwner(readFileSync(join(path, OWNER_FILE), "utf8"));
  } catch {
    return undefined;
  }
}

/** Milliseconds since the path last changed; 0 when it is gone. */
async function age(path: string): Promise<number> {
  try {
    return epochMs() - (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

function epochMs(): number {
  return Temporal.Now.instant().epochMilliseconds;
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Remove a lock whose holder is `seen` (or an orphan when undefined). A
 * takeover mutex lets one waiter at a time re-check and remove it, so a waiter
 * never removes a lock that another waiter has just taken.
 */
async function takeOver(
  path: string,
  seen: DesktopLockOwner | undefined,
): Promise<void> {
  const mutex = `${path}.takeover`;
  try {
    await mkdir(mutex);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await age(mutex)) > STALE_TAKEOVER_MS) {
      await rm(mutex, { recursive: true, force: true });
    }
    return;
  }
  try {
    const current = await readOwner(path);
    const unchanged = seen
      ? current?.token === seen.token
      : !current && (await age(path)) > ORPHAN_MS;
    if (unchanged) await rm(path, { recursive: true, force: true });
  } finally {
    await rm(mutex, { recursive: true, force: true });
  }
}

function reusedLock(path: string, owner: DesktopLockOwner): DesktopLock {
  return {
    path,
    owner,
    reused: true,
    release() {},
    [Symbol.dispose]() {},
  };
}

function heldLock(
  path: string,
  owner: DesktopLockOwner,
  options: DesktopLockOptions,
): DesktopLock {
  let released = false;
  const onSignal = (signal: NodeJS.Signals) => {
    release();
    // Keep the default exit for a signal no one else handles.
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  };
  function release() {
    if (released) return;
    released = true;
    process.off("exit", release);
    for (const signal of SIGNALS) process.off(signal, onSignal);
    if (process.env[DESKTOP_LOCK_ENV] === owner.token) {
      delete process.env[DESKTOP_LOCK_ENV];
    }
    if (readOwnerSync(path)?.token === owner.token) {
      rmSync(path, { recursive: true, force: true });
    }
  }
  process.on("exit", release);
  if (options.signals ?? true) {
    for (const signal of SIGNALS) process.on(signal, onSignal);
  }
  process.env[DESKTOP_LOCK_ENV] = owner.token;
  return {
    path,
    owner,
    reused: false,
    release,
    [Symbol.dispose]: release,
  };
}
