import { assertDevBundleFresh } from "@e2e/bundle-freshness.ts";
import { isObsidianReachable } from "@e2e/vault-script.ts";

import {
  acquireDesktopSlotOrExit,
  automatedLease,
  DEFAULT_LEASE_MS,
} from "@zotlit/scripts/desktop-slot";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { captureRequested } from "./docs-walk.ts";

/**
 * The global setup of `pnpm --filter @zotlit/e2e docs-walk`: one Desktop Slot
 * for the run, or an Exclusive Hold of every slot when the run captures
 * screenshots, so no other run's window moves while a capture lands. A run
 * without a reachable Obsidian skips its walks and takes no slot.
 */
export default async function setup() {
  const cwd = await getWorkspaceRoot(import.meta.dirname);
  if (!(await isObsidianReachable(cwd))) return;
  // A walk proves the page against the code as it is now, not an old bundle.
  await assertDevBundleFresh(cwd);
  const slot = await acquireDesktopSlotOrExit({
    cwd,
    command: "pnpm docs-walk",
    exclusive: captureRequested(),
    leaseMs: automatedLease(DEFAULT_LEASE_MS.e2e),
  });
  return () => slot.release();
}
