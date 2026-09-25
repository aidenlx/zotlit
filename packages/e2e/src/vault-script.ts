// The suite's calls to `packages/scripts/scripts/obsidian-vault.ts`, and the
// vault folders they register.

import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function scriptPath(workspaceRoot: string): string {
  return join(workspaceRoot, "packages/scripts/scripts/obsidian-vault.ts");
}

/** Whether a desktop Obsidian answers with a live vault to host CLI calls. */
export async function isObsidianReachable(
  workspaceRoot: string,
): Promise<boolean> {
  const result = await execFileAsync(
    process.execPath,
    [scriptPath(workspaceRoot), "status"],
    { windowsHide: true },
  ).catch(() => undefined);
  return result?.stdout.trim().startsWith("ready ") ?? false;
}

/** Runs one `obsidian-vault.ts` command. */
export type VaultScript = (args: string[]) => Promise<{ stdout: string }>;

/** `obsidian-vault.ts`, pinned to the Fixture at `fixtureRoot`. */
export function vaultScript(
  workspaceRoot: string,
  fixtureRoot: string,
): VaultScript {
  return (args) =>
    execFileAsync(
      process.execPath,
      [scriptPath(workspaceRoot), ...args, `--fixture-root=${fixtureRoot}`],
      { windowsHide: true },
    );
}

/**
 * The folder of one suite vault. Obsidian refuses a vault whose folder name a
 * registered vault already has, so the name carries the worktree, as a
 * Development Vault's does.
 */
export function e2eVaultDir(workspaceRoot: string, name: string): string {
  return join(
    workspaceRoot,
    ".scratch",
    `e2e-${name}-${basename(workspaceRoot)}`,
  );
}

/**
 * Unregisters the vault at `path`, with its vault-scoped local storage and
 * IndexedDB, and deletes its folder. A path that no vault holds passes.
 */
export async function clearVault(
  run: VaultScript,
  path: string,
): Promise<void> {
  await run(["remove", path]);
  await rm(path, { recursive: true, force: true });
}
