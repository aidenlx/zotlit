// What a Paired Run leaves on disk about the Paired Zotero it started, so a
// later process on the same Fixture reaches that instance without being told
// its ports.

import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { FixtureLayout } from "./layout.ts";

/** The Paired Zotero one command started, as that command reported it. */
export interface PairedRunState {
  pid: number;
  /**
   * The remote debugging port this instance listens on, for evaluating JS in
   * Zotero's parent process (`packages/scripts/scripts/zotero-rdp.ts`).
   *
   * Absent where the launcher started Zotero without a debugger, which
   * `pnpm fixture zotero` does. Such an instance still holds `zotero.sqlite`,
   * so it still has to be reported — a reader that needs the port skips what
   * it cannot do rather than treating the whole report as missing.
   */
  debuggerPort?: number;
}

/** Beside the Fixture's other generated trees, so `discardFixture` takes it. */
export function pairedRunStatePath(layout: FixtureLayout): string {
  return join(layout.root, "paired-zotero.json");
}

export async function writePairedRunState(
  layout: FixtureLayout,
  state: PairedRunState,
): Promise<void> {
  await writeFile(
    pairedRunStatePath(layout),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

/**
 * @returns what the last Paired Run reported, or null where no run has
 *   reported one and where the file no longer says what it once did — a caller
 *   is attaching to an instance it did not start, so an absent or unreadable
 *   report is an ordinary "nothing to attach to", never a failure.
 */
export async function readPairedRunState(
  layout: FixtureLayout,
): Promise<PairedRunState | null> {
  const source = await readFile(pairedRunStatePath(layout), "utf-8").catch(
    () => null,
  );
  if (source === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { pid, debuggerPort } = parsed as Record<string, unknown>;
  if (typeof pid !== "number") return null;
  if (debuggerPort !== undefined && typeof debuggerPort !== "number") {
    return null;
  }
  return debuggerPort === undefined ? { pid } : { pid, debuggerPort };
}

/**
 * Forget the Paired Zotero this Fixture reported, so the report never outlives
 * the process it names.
 */
export async function clearPairedRunState(
  layout: FixtureLayout,
): Promise<void> {
  await rm(pairedRunStatePath(layout), { force: true });
}

/**
 * Whether a process is still running, for a caller that only wants to know
 * whether a reported pid is worth believing. Signal `0` performs the existence
 * check without delivering anything: `ESRCH` is gone, and `EPERM` is a process
 * this user may not signal, which means it is very much alive.
 */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The Paired Zotero holding this Fixture open right now, or null.
 *
 * A Paired Zotero keeps `zotero.sqlite` open, so anything that would rebuild
 * the Fixture has to stand aside while one is live. The report alone is not
 * the answer: a Zotero that exits on its own leaves the file behind, and
 * treating that as "live" would silently stop a developer's suite from testing
 * anything. So the pid is checked too.
 *
 * @param isAlive the liveness probe, injectable so the decision is testable
 *   with no Zotero anywhere.
 */
export async function livePairedZotero(
  layout: FixtureLayout,
  { isAlive = processAlive }: { isAlive?: (pid: number) => boolean } = {},
): Promise<PairedRunState | null> {
  const reported = await readPairedRunState(layout);
  if (reported === null) return null;
  return isAlive(reported.pid) ? reported : null;
}
