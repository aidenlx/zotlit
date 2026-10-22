import {
  acquireDesktopSlotOrExit,
  automatedLease,
  DEFAULT_LEASE_MS,
} from "@zotlit/scripts/desktop-slot";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { isObsidianReachable } from "./vault-script.ts";

/**
 * The first global setup of each project: wait for a Desktop Slot. A run
 * without a reachable Obsidian skips its tests, so it takes no slot. At the
 * Admission Deadline the process exits 75, and at the end of its Lease 76:
 * Vitest would turn a thrown error into exit 1.
 */
export default async function setup() {
  const cwd = await getWorkspaceRoot(import.meta.dirname);
  if (!(await isObsidianReachable(cwd))) return;
  const slot = await acquireDesktopSlotOrExit({
    cwd,
    command: "pnpm e2e",
    leaseMs: automatedLease(DEFAULT_LEASE_MS.e2e),
  });
  return () => slot.release();
}
