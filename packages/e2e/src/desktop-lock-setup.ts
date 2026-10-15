import { acquireDesktopLock } from "@zotlit/scripts/desktop-lock";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { isObsidianReachable } from "./vault-script.ts";

/**
 * The first global setup of each project: wait for the desktop lock. A run
 * without a reachable Obsidian skips its tests, so it takes no lock.
 */
export default async function setup() {
  const cwd = await getWorkspaceRoot(import.meta.dirname);
  if (!(await isObsidianReachable(cwd))) return;
  const lock = await acquireDesktopLock({ cwd });
  return () => lock.release();
}
