import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Compiles the Language Packs before the tests import them, so a run after a
 * merge or a `messages/*.json` edit never reads stale Message wrappers, however
 * vitest was started.
 */
export default function setup(): void {
  execFileSync(process.execPath, ["scripts/generate-language-packs.ts"], {
    cwd: resolve(import.meta.dirname),
    stdio: ["ignore", "ignore", "inherit"],
  });
}
