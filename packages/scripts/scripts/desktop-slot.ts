#!/usr/bin/env node

// The Desktop Slot from the command line: hold it around a manual session on
// the desktop Obsidian, show who holds it, extend a Lease, or evict a holder.
// `--help` prints the contract.

import { spawn } from "node:child_process";
import { constants } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  DESKTOP_DIR_ENV,
  desktopStateDir,
  MEMORY_GATE_ENV,
} from "@zotlit/config/memory-gate";

import {
  acquireDesktopSlot,
  ADMISSION_DEADLINE_MS,
  DEFAULT_LEASE_MS,
  DESKTOP_LEASE_ENV,
  DESKTOP_SLOT_ENV,
  DESKTOP_WAIT_ENV,
  DesktopSlotBlockedError,
  describeHolder,
  describeWaiters,
  EVICTION_GRACE_MS,
  evictDesktopSlot,
  EXIT_ADMISSION_BLOCKED,
  EXIT_LEASE_ENDED,
  extendDesktopSlot,
  formatDuration,
  KILL_AFTER_MS,
  LeaseUsageError,
  MANUAL_LEASE_CAP_MS,
  MAX_LEASE_MS,
  parseDuration,
  parseManualLease,
  readDesktopSlotStatus,
  updateDesktopSlotOwner,
} from "#desktop-slot";

const EXIT_USAGE = 2;

const epilogue = `The Desktop Slot is exclusive use of the one desktop Obsidian app, across every clone and session on this machine (ADR 0077). A holder joins the Desktop Queue (first in, first out), claims the slot at its head, passes the Memory Gate, and then its Lease starts.

Exit codes:
  ${EXIT_ADMISSION_BLOCKED}   the Admission Deadline passed; blocked at admission, not a failure.
       The message names the holder and the waiters ahead.
  ${EXIT_LEASE_ENDED}   the Lease ended; run ended the command's process group.
  ${EXIT_USAGE}    usage error, such as a missing --for or one over ${formatDuration(MANUAL_LEASE_CAP_MS)}.
  run otherwise exits with the command's code, or 128 plus the signal number.

Admission Deadline: ${formatDuration(ADMISSION_DEADLINE_MS)} by default, for the queue, the slot, and the Memory Gate together.
Leases: a manual hold states --for, up to ${formatDuration(MANUAL_LEASE_CAP_MS)}. Automated holders default to pnpm e2e ${formatDuration(DEFAULT_LEASE_MS.e2e)}, e2e:worker ${formatDuration(DEFAULT_LEASE_MS.e2eWorker)}, measure:query ${formatDuration(DEFAULT_LEASE_MS.measureQuery)}. No Lease exceeds ${formatDuration(MAX_LEASE_MS)}.
A holder that outlives its Lease by ${formatDuration(EVICTION_GRACE_MS)} is evicted by the head waiter: SIGTERM to its process group, SIGKILL after ${formatDuration(KILL_AFTER_MS)}.
Durations: 300ms, 90s, 20m, 2h.

Environment:
  ${DESKTOP_SLOT_ENV}     the holder's token; a ZotLit tool the command starts reuses the hold, inside its Lease
  ${DESKTOP_WAIT_ENV}     the Admission Deadline of an in-process holder (pnpm e2e, e2e:worker, measure:query)
  ${DESKTOP_LEASE_ENV}    the Lease of an automated holder, instead of its default
  ${DESKTOP_DIR_ENV}      the state directory (now ${desktopStateDir()})
  ${MEMORY_GATE_ENV}=off  skip the Memory Gate`;

function usage(message: string): never {
  console.error(`desktop-slot: ${message}`);
  process.exit(EXIT_USAGE);
}

function duration(text: string): number {
  try {
    return parseDuration(text);
  } catch (error) {
    return usage((error as Error).message);
  }
}

async function run(
  command: string[],
  lease: string | undefined,
  wait?: string,
) {
  let leaseMs: number;
  try {
    leaseMs = parseManualLease(lease);
  } catch (error) {
    if (error instanceof LeaseUsageError) usage(error.message);
    throw error;
  }
  if (command.length === 0) usage("name the command after --.");
  let leaseOver = false;
  const slot = await acquireDesktopSlot({
    command: command.join(" "),
    leaseMs,
    manual: true,
    waitMs: wait === undefined ? undefined : duration(wait),
    // The command handles the signals; the slot is released after it exits.
    signals: false,
    onLeaseEnd: (owner) => {
      leaseOver = true;
      console.error(
        `Desktop Slot: the Lease of ${formatDuration(owner.lease)} ended at ${owner.leaseEndsAt}; ending the command's process group (exit ${EXIT_LEASE_ENDED}).`,
      );
      signalGroup("SIGTERM");
      setTimeout(() => signalGroup("SIGKILL"), KILL_AFTER_MS).unref();
    },
  }).catch((error: unknown) => {
    if (!(error instanceof DesktopSlotBlockedError)) throw error;
    console.error(error.message);
    process.exit(EXIT_ADMISSION_BLOCKED);
  });

  const posix = process.platform !== "win32";
  // Its own process group, so the Lease can end the command's descendants too.
  const child = spawn(command[0]!, command.slice(1), {
    stdio: "inherit",
    detached: posix,
  });
  function signalGroup(signal: NodeJS.Signals) {
    try {
      if (posix && child.pid !== undefined) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      // The group is gone.
    }
  }
  if (posix && child.pid !== undefined) {
    await updateDesktopSlotOwner(slot.owner.token, { pgid: child.pid });
  }
  // The command no longer shares the terminal's group, so pass every signal on.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => signalGroup(signal));
  }
  child.on("error", (error) => {
    console.error(error.message);
    slot.release();
    process.exit(127);
  });
  child.on("exit", async (code, signal) => {
    if (leaseOver) {
      // Give the rest of the group the same grace, then end it.
      const until = Temporal.Now.instant().add({ milliseconds: KILL_AFTER_MS });
      while (
        posix &&
        groupAlive(child.pid!) &&
        Temporal.Instant.compare(Temporal.Now.instant(), until) < 0
      ) {
        await delay(100);
      }
      signalGroup("SIGKILL");
    }
    slot.release();
    process.exit(
      leaseOver
        ? EXIT_LEASE_ENDED
        : (code ?? 128 + (signal ? constants.signals[signal] : 0)),
    );
  });
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function status(json: boolean) {
  const now = Temporal.Now.instant().epochMilliseconds;
  const state = await readDesktopSlotStatus();
  if (json) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  const { holder, waiters } = state;
  console.log(
    holder
      ? `Holder: ${describeHolder(holder, now)}${holder.alive ? "" : " (process gone)"}`
      : "Holder: none; the Desktop Slot is free.",
  );
  console.log(
    waiters.length > 0
      ? `Desktop Queue:\n${describeWaiters(waiters)}`
      : "Desktop Queue: empty.",
  );
  console.log(
    `Memory Gate: last admitted start ${state.lastGateStart ?? "none recorded"}.`,
  );
}

await yargs(hideBin(process.argv))
  .scriptName("desktop-slot")
  .usage("pnpm desktop-slot <command>")
  .command(
    "run",
    "hold the Desktop Slot around a command: run --for <dur> [--wait <dur>] -- <command...>",
    (y) =>
      y
        .option("for", {
          type: "string",
          describe: `the Lease of this hold, up to ${formatDuration(MANUAL_LEASE_CAP_MS)} (required)`,
        })
        .option("wait", {
          type: "string",
          describe: `the Admission Deadline (default ${formatDuration(ADMISSION_DEADLINE_MS)})`,
        }),
    async (argv) => {
      const command = (argv["--"] as unknown[] | undefined) ?? [];
      await run(command.map(String), argv.for, argv.wait);
    },
  )
  .command(
    "status",
    "show the holder, the Desktop Queue, and the Memory Gate's last start",
    (y) =>
      y.option("json", {
        type: "boolean",
        default: false,
        describe: "print JSON",
      }),
    async (argv) => {
      await status(argv.json);
    },
  )
  .command(
    "extend <duration>",
    `move the end of the Lease to now plus <duration>; refused while anyone waits (cap ${formatDuration(MANUAL_LEASE_CAP_MS)} for a manual hold, ${formatDuration(MAX_LEASE_MS)} for any hold)`,
    (y) =>
      y
        .positional("duration", { type: "string", demandOption: true })
        .option("token", {
          type: "string",
          describe: `the holder's token (default: $${DESKTOP_SLOT_ENV})`,
        }),
    async (argv) => {
      const token = argv.token ?? process.env[DESKTOP_SLOT_ENV];
      if (!token)
        usage(
          `pass --token, or run under the hold that sets ${DESKTOP_SLOT_ENV}.`,
        );
      try {
        const owner = await extendDesktopSlot({
          token,
          byMs: duration(argv.duration),
        });
        console.log(
          `Desktop Slot: the Lease now ends at ${owner.leaseEndsAt}.`,
        );
      } catch (error) {
        console.error((error as Error).message);
        process.exit(1);
      }
    },
  )
  .command(
    "evict <holder>",
    "end the holder named by its token or pid, as an overdue holder is evicted",
    (y) => y.positional("holder", { type: "string", demandOption: true }),
    async (argv) => {
      try {
        const owner = await evictDesktopSlot({ target: argv.holder });
        console.log(
          `Desktop Slot: evicted pid ${owner.pid} (${owner.command}).`,
        );
      } catch (error) {
        console.error((error as Error).message);
        process.exit(1);
      }
    },
  )
  .demandCommand(1)
  .parserConfiguration({ "populate--": true })
  .epilogue(epilogue)
  .strict()
  .version(false)
  .wrap(null)
  .fail((message, error) => {
    if (error) throw error;
    usage(message);
  })
  .parseAsync();
