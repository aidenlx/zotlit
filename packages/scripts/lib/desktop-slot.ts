// Desktop admission (ADR 0077, ADR 0078): the Desktop Queue, the pool of N
// Desktop Slots, and the Lease of each holder.
//
// The state lives per user and machine-wide, shared by every clone, in
// `desktopStateDir()`:
//
//   queue/<seq>-<token>.json   one ticket per waiter, in FIFO order
//   queue.seq, queue.lock/     the last sequence number and its mutex
//   slot-<i>/owner.json        the holder of slot i; mkdir of `slot-<i>` is the
//                              atomic claim. An Exclusive Hold has every slot.
//   slot-<i>.takeover/         one waiter at a time removes a dead holder
//   last-start                 the Memory Gate's last admitted start
//
// A holder joins the queue and claims a slot at the head, when one is free and
// no holder from its own worktree has one; an Exclusive Hold claims when every
// slot is free. No waiter overtakes the head. The holder then passes the Memory
// Gate, and only then starts its Lease. One Admission Deadline covers all three
// waits. The holder ends its own work when its Lease ends; the head waiter
// evicts a holder that outlives its Lease by the grace period.

import { regex } from "arkregex";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import {
  admissionWaitMs,
  desktopStateDir,
  EXIT_ADMISSION_BLOCKED,
  lastGateStart,
  MEMORY_GATE_ADMITTED_ENV,
  MemoryGateClosedError,
  parseDuration,
  passMemoryGate,
} from "@zotlit/config/memory-gate";

export {
  ADMISSION_DEADLINE_MS,
  DESKTOP_WAIT_ENV,
  EXIT_ADMISSION_BLOCKED,
  parseDuration,
} from "@zotlit/config/memory-gate";

/** Holds the holder's token; a child process that inherits it reuses the hold. */
export const DESKTOP_SLOT_ENV = "ZOTLIT_DESKTOP_SLOT";
/** How many Desktop Slots the pool has, as a positive integer. */
export const DESKTOP_SLOTS_ENV = "ZOTLIT_DESKTOP_SLOTS";
export const DEFAULT_DESKTOP_SLOTS = 2;
/** Overrides the default Lease of an automated holder, as a duration. */
export const DESKTOP_LEASE_ENV = "ZOTLIT_DESKTOP_LEASE";

/** The holder's Lease ended before its work did. */
export const EXIT_LEASE_ENDED = 76;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** The default Lease of each automated holder. */
export const DEFAULT_LEASE_MS = {
  e2e: 20 * MINUTE,
  e2eWorker: 10 * MINUTE,
  measureQuery: 2 * HOUR,
} as const;
/** The cap of a manual hold, which must state its Lease. */
export const MANUAL_LEASE_CAP_MS = HOUR;
/** No Lease exceeds this. */
export const MAX_LEASE_MS = 2 * HOUR;
/** How long past its Lease a live holder keeps the slot before eviction. */
export const EVICTION_GRACE_MS = 2 * MINUTE;
/** How long a holder has between SIGTERM and SIGKILL. */
export const KILL_AFTER_MS = 10 * SECOND;

const OWNER_FILE = "owner.json";
const QUEUE = "queue";
const QUEUE_SEQ = "queue.seq";
/** A slot directory without an owner record this long is an abandoned claim. */
const ORPHAN_MS = 10 * SECOND;
/** A takeover mutex this old belongs to a waiter that died during takeover. */
const STALE_TAKEOVER_MS = 30 * SECOND;
/** A queue mutex this old belongs to a waiter that died while it enqueued. */
const STALE_QUEUE_LOCK_MS = 10 * SECOND;
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/**
 * The number of Desktop Slots: DESKTOP_SLOTS_ENV, else DEFAULT_DESKTOP_SLOTS.
 * @throws {Error} when DESKTOP_SLOTS_ENV is not a positive integer.
 */
export function desktopSlotCount(): number {
  const text = process.env[DESKTOP_SLOTS_ENV];
  if (!text) return DEFAULT_DESKTOP_SLOTS;
  const count = Number(text);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`${DESKTOP_SLOTS_ENV}=${text} is not a positive integer.`);
  }
  return count;
}

export function formatDuration(ms: number): string {
  if (ms >= 2 * HOUR && ms % HOUR === 0) return `${ms / HOUR} h`;
  if (ms % MINUTE === 0) return `${ms / MINUTE} min`;
  if (ms % SECOND === 0) return `${ms / SECOND} s`;
  return `${ms} ms`;
}

/** The Lease of an automated holder: `defaultMs`, or DESKTOP_LEASE_ENV. */
export function automatedLease(defaultMs: number): number {
  const override = process.env[DESKTOP_LEASE_ENV];
  return Math.min(override ? parseDuration(override) : defaultMs, MAX_LEASE_MS);
}

/** A manual hold's `--for` is missing, malformed, or over the cap. */
export class LeaseUsageError extends Error {}

/**
 * @param text the `--for` value of a manual hold.
 * @throws {LeaseUsageError} when it is missing or over MANUAL_LEASE_CAP_MS.
 */
export function parseManualLease(text: string | undefined): number {
  const hint = `Pass --for <duration>, the Lease of this hold, up to ${formatDuration(MANUAL_LEASE_CAP_MS)} (for example --for 20m).`;
  if (!text) throw new LeaseUsageError(`A manual hold needs a Lease. ${hint}`);
  let ms: number;
  try {
    ms = parseDuration(text);
  } catch (error) {
    throw new LeaseUsageError(`${(error as Error).message} ${hint}`);
  }
  if (ms <= 0 || ms > MANUAL_LEASE_CAP_MS) {
    throw new LeaseUsageError(`--for ${text} is out of range. ${hint}`);
  }
  return ms;
}

/** A waiter in the Desktop Queue. */
export interface QueueTicket {
  seq: number;
  token: string;
  pid: number;
  /** When the process `pid` started, as `ps` reports it; tells a reused pid apart. */
  processStart?: string;
  command: string;
  /** The git toplevel of the waiter's working directory. */
  worktree: string;
  enqueuedAt: string;
  /** The waiter's Admission Deadline. */
  deadline: string;
  /** An Exclusive Hold: it claims every slot at once. */
  exclusive?: boolean;
}

/** The holder of one Desktop Slot, or of all of them for an Exclusive Hold. */
export interface SlotOwner extends Omit<QueueTicket, "seq"> {
  /** The indices of the slots this hold has. */
  slots: number[];
  admittedAt: string;
  /** The Lease granted at admission, in milliseconds. */
  lease: number;
  leaseEndsAt: string;
  /**
   * The process group eviction signals. Absent when the holder shares its
   * group with its caller; eviction then signals the pid alone.
   */
  pgid?: number;
  /**
   * When the group's leader `pgid` started, as `ps` reports it. The group of a
   * dead holder is ended only while its leader still has this start.
   */
  pgidStart?: string;
  /** A manual hold; its extensions stay within MANUAL_LEASE_CAP_MS. */
  manual?: boolean;
}

/** The Admission Deadline passed; the message names the holder and the queue. */
export class DesktopSlotBlockedError extends Error {
  readonly exitCode = EXIT_ADMISSION_BLOCKED;
}

export interface DesktopSlotOptions {
  /** @default desktopStateDir() */
  dir?: string;
  /** Its git toplevel is the holder's worktree. */
  cwd?: string;
  /** What the holder runs, shown to waiters. */
  command?: string;
  /** @default the git toplevel of `cwd`, else `cwd` */
  worktree?: string;
  /** Hold every slot: an Exclusive Hold, for work that needs the whole app. */
  exclusive?: boolean;
  /** The Lease, counted from admission; capped at MAX_LEASE_MS. */
  leaseMs: number;
  /** A manual hold: extensions stay within MANUAL_LEASE_CAP_MS. */
  manual?: boolean;
  /** The Admission Deadline, from now. @default DESKTOP_WAIT_ENV, else 9 min */
  waitMs?: number;
  /** @default 2000 */
  pollMs?: number;
  /** How often a waiter repeats who holds the slot. @default 5 min */
  remindMs?: number;
  /** @default EVICTION_GRACE_MS */
  graceMs?: number;
  /** @default KILL_AFTER_MS */
  killAfterMs?: number;
  /** Epoch milliseconds; tests move it to pass a Lease or a deadline. */
  now?: () => number;
  log?: (message: string) => void;
  /** Release on SIGINT, SIGTERM, and SIGHUP. Turn off when the caller handles signals. */
  signals?: boolean;
  /**
   * Runs when the Lease ends while this process still holds (or reuses) the
   * slot. The default logs the reason and exits with EXIT_LEASE_ENDED.
   */
  onLeaseEnd?: (owner: SlotOwner) => void;
}

export interface DesktopSlot extends Disposable {
  readonly dir: string;
  readonly owner: SlotOwner;
  /** True when an ancestor process holds the slot and this process reuses it. */
  readonly reused: boolean;
  /** Idempotent. A reused hold stays with its holder. */
  release(): void;
}

/** Wait in the Desktop Queue until this process holds a Desktop Slot. */
export async function acquireDesktopSlot(
  options: DesktopSlotOptions,
): Promise<DesktopSlot> {
  const dir = options.dir ?? desktopStateDir();
  const now = options.now ?? epochMs;
  const log = options.log ?? ((message: string) => console.error(message));
  const pollMs = options.pollMs ?? 2000;
  const remindMs = options.remindMs ?? 5 * MINUTE;
  const graceMs = options.graceMs ?? EVICTION_GRACE_MS;
  const killAfterMs = options.killAfterMs ?? KILL_AFTER_MS;
  const leaseMs = Math.min(options.leaseMs, MAX_LEASE_MS);
  const waitMs = options.waitMs ?? admissionWaitMs();
  const cwd = options.cwd ?? process.cwd();
  const count = desktopSlotCount();
  const watch: LeaseWatch = {
    dir,
    now,
    onEnd: options.onLeaseEnd ?? leaseEnded(log),
  };

  const inherited = process.env[DESKTOP_SLOT_ENV];
  if (inherited) {
    const holder = await findHolder(dir, inherited);
    if (
      holder &&
      now() < epochOf(holder.leaseEndsAt) &&
      (await isHolderAlive(holder))
    ) {
      return reusedSlot(watch, holder);
    }
  }

  await mkdir(join(dir, QUEUE), { recursive: true });
  const self = await processInfo(process.pid);
  const start = now();
  const deadline = start + waitMs;
  let ticket = await enqueue(dir, {
    token: randomUUID(),
    pid: process.pid,
    processStart: self.start,
    command: options.command ?? process.argv.slice(1).join(" "),
    worktree: options.worktree ?? (await gitToplevel(cwd)),
    enqueuedAt: isoOf(start),
    deadline: isoOf(deadline),
    ...(options.exclusive ? { exclusive: true } : {}),
  });
  const { seq: _seq, ...record } = ticket;
  const dropTicket = () => rmSync(ticketPath(dir, ticket), { force: true });

  let reported: { key: string; at: number } | undefined;
  /** The overdue holders this waiter signalled, by token. */
  const evicting = new Map<string, { at: number; killed: boolean }>();
  let owner: SlotOwner | undefined;
  try {
    for (;;) {
      const waiters = await liveTickets(dir, ticket.token);
      const position = waiters.findIndex((each) => each.token === ticket.token);
      if (position === -1) {
        // Another waiter reaped it, or someone removed it.
        await mkdir(join(dir, QUEUE), { recursive: true });
        ticket = await enqueue(dir, record);
        log(
          `Desktop Slot: this waiter's ticket was removed; joining the back of the Desktop Queue.`,
        );
        continue;
      }
      const slots = await readSlots(dir);
      const { holders } = slots;
      if (position === 0) {
        // Until the Memory Gate admits this run, its Lease has not started:
        // the gate wait ends by the deadline, so this end is an upper bound.
        const claimed = await tryClaim(
          dir,
          {
            ...record,
            admittedAt: isoOf(now()),
            lease: leaseMs,
            leaseEndsAt: isoOf(deadline + leaseMs),
            ...(self.pgid === process.pid
              ? { pgid: self.pgid, pgidStart: self.start }
              : {}),
            ...(options.manual ? { manual: true } : {}),
          },
          { slots, count },
        );
        if (claimed) {
          owner = claimed;
          break;
        }
        let cleared = false;
        for (const holder of holders) {
          if (!(await isHolderAlive(holder))) {
            log(
              `Desktop Slot: pid ${holder.pid} (${holder.command}) is gone; taking over ${holder.slots.map((index) => slotPath(dir, index)).join(", ")}.`,
            );
            await endOrphanGroup(holder, {
              ownPgid: self.pgid,
              killAfterMs,
              log,
            });
            await takeOver(dir, holder);
            cleared = true;
          } else if (now() > epochOf(holder.leaseEndsAt) + graceMs) {
            const signalled = evicting.get(holder.token);
            if (!signalled) {
              log(
                `Desktop Slot: the Lease of pid ${holder.pid} (${holder.command}) ended at ${holder.leaseEndsAt}; evicting pid ${holder.pid}.`,
              );
              await signalHolder(holder, "SIGTERM", self.pgid);
              evicting.set(holder.token, { at: now(), killed: false });
            } else if (
              !signalled.killed &&
              now() - signalled.at >= killAfterMs
            ) {
              await signalHolder(holder, "SIGKILL", self.pgid);
              signalled.killed = true;
            }
          }
        }
        for (const index of slots.orphans) {
          if ((await age(slotPath(dir, index))) > ORPHAN_MS) {
            await takeOverSlot(dir, index, undefined);
            cleared = true;
          }
        }
        if (cleared) continue;
      }
      if (now() >= deadline) {
        throw new DesktopSlotBlockedError(
          blockedMessage({
            waitMs,
            deadline,
            holders,
            ahead: waiters.slice(0, position),
          }),
        );
      }
      const key = `${holders.map((holder) => holder.token).join()}:${position}`;
      if (reported?.key !== key || now() - reported.at >= remindMs) {
        log(waitingMessage({ position, waiters, holders, deadline }));
        reported = { key, at: now() };
      }
      await delay(pollMs);
    }
  } finally {
    dropTicket();
  }

  let gateAdmitted: boolean;
  try {
    gateAdmitted = await passMemoryGate({
      dir,
      deadline: epochMs() + (deadline - now()),
      pollMs: Math.max(pollMs, 100),
      log,
    });
  } catch (error) {
    releaseIfHeld(dir, owner.token);
    if (!(error instanceof MemoryGateClosedError)) throw error;
    throw new DesktopSlotBlockedError(
      blockedMessage({
        waitMs,
        deadline,
        holders: [],
        ahead: [],
        gate: error.reason,
      }),
    );
  }
  // The Lease starts once the run is admitted.
  const admittedAt = now();
  owner = {
    ...owner,
    admittedAt: isoOf(admittedAt),
    leaseEndsAt: isoOf(admittedAt + leaseMs),
  };
  await writeOwner(dir, owner);
  return heldSlot(watch, owner, {
    signals: options.signals ?? true,
    gateAdmitted,
  });
}

/**
 * {@link acquireDesktopSlot} for an in-process holder: at the Admission
 * Deadline it prints the block and exits with EXIT_ADMISSION_BLOCKED.
 */
export async function acquireDesktopSlotOrExit(
  options: DesktopSlotOptions,
): Promise<DesktopSlot> {
  try {
    return await acquireDesktopSlot(options);
  } catch (error) {
    if (!(error instanceof DesktopSlotBlockedError)) throw error;
    console.error(error.message);
    process.exit(EXIT_ADMISSION_BLOCKED);
  }
}

export type HolderStatus = SlotOwner & { alive: boolean; overdue: boolean };

export interface DesktopSlotStatus {
  /** Every Desktop Slot in order; a free slot has no holder. */
  slots: { index: number; holder?: HolderStatus }[];
  /** One entry per hold, in slot order. */
  holders: HolderStatus[];
  /** Live waiters, head first. */
  waiters: QueueTicket[];
  /** When the Memory Gate last admitted a run. */
  lastGateStart?: string;
  /** Why DESKTOP_SLOTS_ENV could not be read; the slots on disk are listed. */
  slotCountError?: string;
}

export async function readDesktopSlotStatus(
  options: { dir?: string; now?: () => number } = {},
): Promise<DesktopSlotStatus> {
  const dir = options.dir ?? desktopStateDir();
  const now = options.now ?? epochMs;
  const { holders: owners, taken } = await readSlots(dir);
  const holders: HolderStatus[] = [];
  for (const owner of owners) {
    holders.push({
      ...owner,
      alive: await isHolderAlive(owner),
      overdue: now() > epochOf(owner.leaseEndsAt),
    });
  }
  let configured = 0;
  let slotCountError: string | undefined;
  try {
    configured = desktopSlotCount();
  } catch (error) {
    slotCountError = (error as Error).message;
  }
  const count = Math.max(configured, ...[...taken].map((i) => i + 1));
  return {
    slots: Array.from({ length: count }, (_, index) => ({
      index,
      holder: holders.find((holder) => holder.slots.includes(index)),
    })),
    holders,
    waiters: await liveTickets(dir, undefined, false),
    lastGateStart: lastGateStart(dir)?.toString(),
    ...(slotCountError ? { slotCountError } : {}),
  };
}

/**
 * Move the end of the holder's Lease to now plus `byMs`, capped at
 * MANUAL_LEASE_CAP_MS for a manual hold and MAX_LEASE_MS for any hold.
 *
 * @throws {Error} when `token` does not hold the slot, or while anyone waits.
 */
export async function extendDesktopSlot(options: {
  token: string;
  byMs: number;
  dir?: string;
  now?: () => number;
}): Promise<SlotOwner> {
  const dir = options.dir ?? desktopStateDir();
  const now = options.now ?? epochMs;
  const owner = await findHolder(dir, options.token);
  if (!owner) {
    throw new Error(
      "Desktop Slot: this token holds no slot, so there is no Lease to extend.",
    );
  }
  const waiters = await liveTickets(dir);
  if (waiters.length > 0) {
    throw new Error(
      `Desktop Slot: the Lease stays as it is while others wait:\n${describeWaiters(waiters)}\nRelease the slot when done, or join the Desktop Queue again.`,
    );
  }
  const cap = owner.manual ? MANUAL_LEASE_CAP_MS : MAX_LEASE_MS;
  const extended = {
    ...owner,
    leaseEndsAt: isoOf(now() + Math.min(options.byMs, cap)),
  };
  await writeOwner(dir, extended);
  return extended;
}

/**
 * End the holder that `target` (its token or pid) names, by the same path as
 * a waiter's eviction: SIGTERM, then SIGKILL, then takeover.
 *
 * @throws {Error} when `target` does not name a current holder.
 */
export async function evictDesktopSlot(options: {
  target: string;
  dir?: string;
  killAfterMs?: number;
  log?: (message: string) => void;
}): Promise<SlotOwner> {
  const dir = options.dir ?? desktopStateDir();
  const log = options.log ?? ((message: string) => console.error(message));
  const killAfterMs = options.killAfterMs ?? KILL_AFTER_MS;
  const { holders } = await readSlots(dir);
  const owner = holders.find(
    (holder) =>
      holder.token === options.target || String(holder.pid) === options.target,
  );
  if (!owner) {
    throw new Error(
      `Desktop Slot: ${options.target} names no holder${holders.length > 0 ? ` (${holders.map((holder) => `pid ${holder.pid}, token ${holder.token}`).join("; ")})` : "; every slot is free"}.`,
    );
  }
  const self = await processInfo(process.pid);
  const holds = async () =>
    Boolean(await findHolder(dir, owner.token)) && (await isHolderAlive(owner));
  log(`Desktop Slot: evicting ${describeHolder(owner, epochMs())}.`);
  for (const [signal, waitMs] of [
    ["SIGTERM", killAfterMs],
    ["SIGKILL", 5 * SECOND],
  ] as const) {
    if (!(await holds())) break;
    await signalHolder(owner, signal, self.pgid);
    const until = epochMs() + waitMs;
    while (epochMs() < until && (await holds())) await delay(100);
  }
  // A holder that was already gone may have left its command running.
  await endOrphanGroup(owner, { ownPgid: self.pgid, killAfterMs, log });
  await takeOver(dir, owner);
  return owner;
}

/**
 * Record `pgid` as the process group eviction signals, when `token` still
 * holds the slot.
 */
export async function recordDesktopSlotGroup(
  token: string,
  pgid: number,
  dir: string = desktopStateDir(),
): Promise<void> {
  const { start } = await processInfo(pgid);
  const owner = await findHolder(dir, token);
  if (owner) await writeOwner(dir, { ...owner, pgid, pgidStart: start });
}

export function describeHolder(owner: SlotOwner, now: number): string {
  const overdue = now > epochOf(owner.leaseEndsAt) ? " (overdue)" : "";
  const exclusive = owner.exclusive ? ", an Exclusive Hold of every slot" : "";
  return `pid ${owner.pid} (${owner.command}) in ${owner.worktree}${exclusive}, admitted ${owner.admittedAt}, Lease ends ${owner.leaseEndsAt}${overdue}`;
}

function describeHolders(holders: readonly SlotOwner[], now: number): string {
  return holders
    .map((holder) => `  - ${describeHolder(holder, now)}`)
    .join("\n");
}

/** Who holds the slots, for a waiter's message; undefined when no one does. */
function heldBy(holders: readonly SlotOwner[]): string | undefined {
  return holders.length > 0
    ? `slots held by:\n${describeHolders(holders, epochMs())}`
    : undefined;
}

export function describeWaiters(waiters: readonly QueueTicket[]): string {
  return waiters
    .map(
      (ticket, index) =>
        `  ${index + 1}. pid ${ticket.pid} (${ticket.command}) in ${ticket.worktree}${ticket.exclusive ? ", for an Exclusive Hold" : ""}, waiting since ${ticket.enqueuedAt}, deadline ${ticket.deadline}`,
    )
    .join("\n");
}

function waitingMessage({
  position,
  waiters,
  holders,
  deadline,
}: {
  position: number;
  waiters: readonly QueueTicket[];
  holders: readonly SlotOwner[];
  deadline: number;
}): string {
  const place = `position ${position + 1} of ${waiters.length} in the Desktop Queue`;
  const held =
    heldBy(holders) ?? "every slot is free for the head of the queue.";
  return `Desktop Slot: waiting at ${place}, Admission Deadline ${isoOf(deadline)}; ${held}`;
}

function blockedMessage({
  waitMs,
  deadline,
  holders,
  ahead,
  gate,
}: {
  waitMs: number;
  deadline: number;
  holders: readonly SlotOwner[];
  ahead: readonly QueueTicket[];
  /** Why the Memory Gate stayed closed, for a run that held a slot. */
  gate?: string;
}): string {
  const by =
    heldBy(holders) ??
    (gate
      ? `this run held a slot, but the Memory Gate stayed closed: ${gate}.`
      : "the slots changed hands as the deadline passed.");
  const named = holders
    .map((holder) => `pid ${holder.pid} (${holder.command})`)
    .join(", ");
  return [
    `Desktop Slot: not admitted within ${formatDuration(waitMs)} (Admission Deadline ${isoOf(deadline)}); ${by}`,
    ahead.length > 0
      ? `Ahead in the Desktop Queue:\n${describeWaiters(ahead)}`
      : "No one was ahead in the Desktop Queue.",
    `Report this as blocked by the Desktop Slot${named ? `, held by ${named}` : ""}, not as a test failure. Exit ${EXIT_ADMISSION_BLOCKED}.`,
  ].join("\n");
}

function epochMs(): number {
  return Temporal.Now.instant().epochMilliseconds;
}

function isoOf(epochMilliseconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toString();
}

/** A record's instant in epoch ms; a record without one never ends. */
function epochOf(iso: string | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  try {
    return Temporal.Instant.from(iso).epochMilliseconds;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function slotPath(dir: string, index: number): string {
  return join(dir, `slot-${index}`);
}

function ownerPath(dir: string, index: number): string {
  return join(slotPath(dir, index), OWNER_FILE);
}

/** The slot indices among the names in the state dir, ascending. */
function slotIndices(names: readonly string[]): number[] {
  return names
    .filter((name) => name.startsWith("slot-"))
    .map((name) => Number(name.slice("slot-".length)))
    .filter((index) => Number.isInteger(index) && index >= 0)
    .toSorted((a, b) => a - b);
}

/** The git toplevel of `cwd`: the worktree a holder records; else `cwd`. */
async function gitToplevel(cwd: string): Promise<string> {
  try {
    const { stdout } = await promisify(execFile)(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd },
    );
    return stdout.trim();
  } catch {
    return cwd;
  }
}

function ticketPath(dir: string, ticket: QueueTicket): string {
  return join(
    dir,
    QUEUE,
    `${String(ticket.seq).padStart(12, "0")}-${ticket.token}.json`,
  );
}

/** Write `text` so that a reader sees it whole or not at all. */
async function writeAtomic(path: string, text: string): Promise<void> {
  const draft = `${path}.${randomUUID()}.draft`;
  await writeFile(draft, text);
  await rename(draft, path);
}

/**
 * Take the next sequence number under a short mutex, so two waiters that
 * enqueue at once keep a strict order.
 */
async function enqueue(
  dir: string,
  record: Omit<QueueTicket, "seq">,
): Promise<QueueTicket> {
  using _mutex = await mutex(join(dir, `${QUEUE}.lock`));
  const seqPath = join(dir, QUEUE_SEQ);
  const last = Number(await readFile(seqPath, "utf8").catch(() => "0")) || 0;
  const ticket = { ...record, seq: last + 1 };
  await writeAtomic(seqPath, String(ticket.seq));
  await writeAtomic(ticketPath(dir, ticket), JSON.stringify(ticket));
  return ticket;
}

/**
 * Take the mkdir mutex at `path`, breaking one older than `staleMs`. The
 * holder's token inside it keeps a holder whose mutex was broken as stale from
 * removing the next holder's on dispose.
 */
async function mutex(
  path: string,
  staleMs = STALE_QUEUE_LOCK_MS,
  pollMs = 5,
): Promise<Disposable> {
  const tokenPath = join(path, "token");
  const token = randomUUID();
  for (;;) {
    try {
      await mkdir(path);
      await writeFile(tokenPath, token);
      return {
        [Symbol.dispose]: () => {
          try {
            if (readFileSync(tokenPath, "utf8") !== token) return;
          } catch {
            return;
          }
          rmSync(path, { recursive: true, force: true });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if ((await age(path)) > staleMs) {
        await rm(path, { recursive: true, force: true });
      }
      await delay(pollMs);
    }
  }
}

/**
 * Hold the machine-wide mutex `name` in the desktop state dir until disposed.
 * A mutex older than `staleMs` belongs to a holder that died, and is broken.
 */
export async function holdDesktopMutex(
  name: string,
  options: { dir?: string; staleMs?: number } = {},
): Promise<Disposable> {
  const dir = options.dir ?? desktopStateDir();
  await mkdir(dir, { recursive: true });
  return await mutex(join(dir, name), options.staleMs ?? 30 * SECOND, 20);
}

/**
 * The live tickets, head first. Unless `reap` is off, a ticket whose waiter
 * is gone is removed; `self` is alive without a check.
 */
async function liveTickets(
  dir: string,
  self?: string,
  reap = true,
): Promise<QueueTicket[]> {
  const names = await readdir(join(dir, QUEUE)).catch(() => []);
  const tickets: QueueTicket[] = [];
  for (const name of names.filter((each) => each.endsWith(".json"))) {
    const path = join(dir, QUEUE, name);
    const ticket = parseRecord<QueueTicket>(
      await readFile(path, "utf8").catch(() => ""),
    );
    if (!ticket) continue;
    if (ticket.token !== self && !(await isHolderAlive(ticket))) {
      if (reap) await rm(path, { force: true });
      continue;
    }
    tickets.push(ticket);
  }
  return tickets.toSorted((a, b) => a.seq - b.seq);
}

/**
 * Claim a slot for `owner` when one is free and no holder from its worktree
 * has one, or every slot for an Exclusive Hold when all are free.
 * @returns the owner with its slots, or undefined when it must wait.
 */
async function tryClaim(
  dir: string,
  owner: Omit<SlotOwner, "slots">,
  { slots: { holders, taken }, count }: { slots: SlotState; count: number },
): Promise<SlotOwner | undefined> {
  const all = Array.from({ length: count }, (_, index) => index);
  let wanted: number[];
  // Every slot on disk counts, also one past this process's count: another
  // process may see more slots.
  if (owner.exclusive) {
    if (taken.size > 0) return undefined;
    wanted = all;
  } else {
    if (
      holders.some(
        (holder) => holder.exclusive || holder.worktree === owner.worktree,
      )
    ) {
      return undefined;
    }
    const free = all.find((index) => !taken.has(index));
    if (free === undefined) return undefined;
    wanted = [free];
  }
  const slots: number[] = [];
  try {
    for (const index of wanted) {
      await mkdir(slotPath(dir, index));
      slots.push(index);
    }
  } catch (error) {
    for (const index of slots) {
      await rm(slotPath(dir, index), { recursive: true, force: true });
    }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined;
    throw error;
  }
  const claimed = { ...owner, slots };
  await writeOwner(dir, claimed);
  return claimed;
}

/** Write the record of `owner` into each of its slots. */
async function writeOwner(dir: string, owner: SlotOwner): Promise<void> {
  for (const index of owner.slots) {
    await writeAtomic(ownerPath(dir, index), JSON.stringify(owner));
  }
}

function parseRecord<T extends { token: string; pid: number }>(
  text: string,
): T | undefined {
  try {
    const record = JSON.parse(text) as Partial<T>;
    if (typeof record.token !== "string" || typeof record.pid !== "number") {
      return undefined;
    }
    return record as T;
  } catch {
    return undefined;
  }
}

interface SlotState {
  /** One entry per hold, in slot order, with the slots it has. */
  holders: SlotOwner[];
  /** Slots claimed without an owner record yet. */
  orphans: number[];
  /** Every slot index with a claim. */
  taken: Set<number>;
}

async function readSlots(dir: string): Promise<SlotState> {
  const names = await readdir(dir).catch(() => []);
  const byToken = new Map<string, SlotOwner>();
  const orphans: number[] = [];
  const taken = new Set<number>();
  for (const index of slotIndices(names)) {
    taken.add(index);
    const owner = parseRecord<SlotOwner>(
      await readFile(ownerPath(dir, index), "utf8").catch(() => ""),
    );
    if (!owner) {
      orphans.push(index);
      continue;
    }
    const known = byToken.get(owner.token);
    if (known) known.slots.push(index);
    else byToken.set(owner.token, { ...owner, slots: [index] });
  }
  return { holders: [...byToken.values()], orphans, taken };
}

async function findHolder(
  dir: string,
  token: string,
): Promise<SlotOwner | undefined> {
  return (await readSlots(dir)).holders.find(
    (holder) => holder.token === token,
  );
}

function readOwnerSync(dir: string, index: number): SlotOwner | undefined {
  try {
    return parseRecord<SlotOwner>(readFileSync(ownerPath(dir, index), "utf8"));
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

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** `ps -o pgid= -o lstart=`: the group, then a start such as `Wed Oct 21 21:49:58 2026`. */
const PS_LINE = regex("^\\s*(?<pgid>\\d+)\\s+(?<start>.+?)\\s*$");

/**
 * When `pid` started and its process group, as `ps` reports them; empty when
 * `ps` cannot tell (no `ps`, no process).
 */
async function processInfo(
  pid: number,
): Promise<{ start?: string; pgid?: number }> {
  try {
    const { stdout } = await promisify(execFile)(
      "ps",
      ["-o", "pgid=", "-o", "lstart=", "-p", String(pid)],
      { env: { ...process.env, LC_ALL: "C" } },
    );
    const match = PS_LINE.exec(stdout);
    return match
      ? { pgid: Number(match.groups.pgid), start: match.groups.start }
      : {};
  } catch {
    return {};
  }
}

/** The process runs, and its pid was not given to a new process. */
async function isHolderAlive(record: {
  pid: number;
  processStart?: string;
}): Promise<boolean> {
  if (!isAlive(record.pid)) return false;
  if (record.processStart === undefined) return true;
  const { start } = await processInfo(record.pid);
  return start === undefined || start === record.processStart;
}

/**
 * Signal a holder's process group (or its pid alone), after checking that its
 * pid still names the holder's process. A process never signals itself or its
 * own group.
 */
async function signalHolder(
  holder: SlotOwner,
  signal: NodeJS.Signals,
  ownPgid: number | undefined,
): Promise<void> {
  if (holder.pid === process.pid || !(await isHolderAlive(holder))) return;
  const targets =
    holder.pgid !== undefined && holder.pgid !== ownPgid
      ? [-holder.pgid, holder.pid]
      : [holder.pid];
  for (const target of targets) {
    try {
      process.kill(target, signal);
    } catch {
      // Gone already.
    }
  }
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * End the process group of a dead holder, which keeps driving the desktop when
 * the holder was killed and its command lives on: SIGTERM, then SIGKILL after
 * `killAfterMs`. A group whose leader's start differs from the record, or
 * cannot be read, is never signalled.
 */
async function endOrphanGroup(
  holder: SlotOwner,
  {
    ownPgid,
    killAfterMs,
    log,
  }: {
    ownPgid: number | undefined;
    killAfterMs: number;
    log: (message: string) => void;
  },
): Promise<void> {
  const { pgid, pgidStart } = holder;
  if (pgid === undefined || pgidStart === undefined || pgid === ownPgid) return;
  const { start } = await processInfo(pgid);
  if (start === undefined || start !== pgidStart) return;
  log(
    `Desktop Slot: the process group ${pgid} of pid ${holder.pid} (${holder.command}) is still running; ending it.`,
  );
  for (const [signal, waitMs] of [
    ["SIGTERM", killAfterMs],
    ["SIGKILL", 0],
  ] as const) {
    if (!groupAlive(pgid)) return;
    try {
      process.kill(-pgid, signal);
    } catch {
      return;
    }
    const until = epochMs() + waitMs;
    while (epochMs() < until && groupAlive(pgid)) await delay(100);
  }
}

/** Remove every slot of `seen`, a holder that is gone or was evicted. */
async function takeOver(dir: string, seen: SlotOwner): Promise<void> {
  for (const index of seen.slots) await takeOverSlot(dir, index, seen.token);
}

/**
 * Remove slot `index` while its holder is still `token` (or, when undefined,
 * while it is an orphan claim). A takeover mutex lets one waiter at a time
 * re-check and remove it, so a waiter never removes a slot that another waiter
 * has just claimed.
 */
async function takeOverSlot(
  dir: string,
  index: number,
  token: string | undefined,
): Promise<void> {
  const path = slotPath(dir, index);
  const lock = `${path}.takeover`;
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await age(lock)) > STALE_TAKEOVER_MS) {
      await rm(lock, { recursive: true, force: true });
    }
    return;
  }
  try {
    const current = parseRecord<SlotOwner>(
      await readFile(ownerPath(dir, index), "utf8").catch(() => ""),
    );
    const unchanged = token
      ? current?.token === token
      : !current && (await age(path)) > ORPHAN_MS;
    if (unchanged) await rm(path, { recursive: true, force: true });
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

function releaseIfHeld(dir: string, token: string): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const index of slotIndices(names)) {
    if (readOwnerSync(dir, index)?.token === token) {
      rmSync(slotPath(dir, index), { recursive: true, force: true });
    }
  }
}

interface LeaseWatch {
  dir: string;
  now: () => number;
  onEnd: (owner: SlotOwner) => void;
}

/**
 * Call `onEnd` when the Lease of `owner` ends, re-reading the record so an
 * extension moves the end. The timer never keeps the process alive.
 */
function watchLease(
  { dir, now, onEnd }: LeaseWatch,
  owner: SlotOwner,
): () => void {
  let timer: NodeJS.Timeout | undefined;
  const arm = (endsAt: number) => {
    if (!Number.isFinite(endsAt)) return;
    timer = setTimeout(check, Math.max(0, endsAt - now()));
    timer.unref();
  };
  const check = () => {
    const current = readOwnerSync(dir, owner.slots[0]!);
    if (current?.token !== owner.token) return;
    const endsAt = epochOf(current.leaseEndsAt);
    if (endsAt > now()) arm(endsAt);
    else onEnd(current);
  };
  arm(epochOf(owner.leaseEndsAt));
  return () => clearTimeout(timer);
}

function leaseEnded(log: (message: string) => void) {
  return (owner: SlotOwner) => {
    log(
      `Desktop Slot: the Lease of ${formatDuration(owner.lease)} for pid ${owner.pid} (${owner.command}) ended at ${owner.leaseEndsAt}; ending this run with exit ${EXIT_LEASE_ENDED}.`,
    );
    process.exit(EXIT_LEASE_ENDED);
  };
}

/** A child reuses its holder's slot, inside the holder's Lease. */
function reusedSlot(watch: LeaseWatch, owner: SlotOwner): DesktopSlot {
  const stop = watchLease(watch, owner);
  return {
    dir: watch.dir,
    owner,
    reused: true,
    release: stop,
    [Symbol.dispose]: stop,
  };
}

function heldSlot(
  watch: LeaseWatch,
  owner: SlotOwner,
  { signals, gateAdmitted }: { signals: boolean; gateAdmitted: boolean },
): DesktopSlot {
  const { dir } = watch;
  let released = false;
  const stopLease = watchLease(watch, owner);
  const onSignal = (signal: NodeJS.Signals) => {
    release();
    // Keep the default exit for a signal no one else handles.
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  };
  function release() {
    if (released) return;
    released = true;
    stopLease();
    process.off("exit", release);
    for (const signal of SIGNALS) process.off(signal, onSignal);
    if (process.env[DESKTOP_SLOT_ENV] === owner.token) {
      delete process.env[DESKTOP_SLOT_ENV];
    }
    if (gateAdmitted) delete process.env[MEMORY_GATE_ADMITTED_ENV];
    releaseIfHeld(dir, owner.token);
  }
  process.on("exit", release);
  if (signals) {
    for (const signal of SIGNALS) process.on(signal, onSignal);
  }
  process.env[DESKTOP_SLOT_ENV] = owner.token;
  // What this holder starts was admitted with it.
  if (gateAdmitted) process.env[MEMORY_GATE_ADMITTED_ENV] = "1";
  return {
    dir,
    owner,
    reused: false,
    release,
    [Symbol.dispose]: release,
  };
}
