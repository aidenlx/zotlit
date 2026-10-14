import { acquireDesktopLock } from "@zotlit/scripts/desktop-lock";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

/** The first global setup of each project: wait for the desktop lock. */
export default async function setup() {
  const cwd = await getWorkspaceRoot(import.meta.dirname);
  const lock = await acquireDesktopLock({ cwd });
  return () => lock.release();
}
