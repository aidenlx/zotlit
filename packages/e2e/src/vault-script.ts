// The suite's calls to `packages/scripts/scripts/obsidian-vault.ts`, and the
// vault folders they register.

import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { basename, join, sep } from "node:path";
import { promisify } from "node:util";

import { cli } from "./obsidian-cli.ts";

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

/**
 * An open vault outside every run's `.scratch/e2e-*` vaults, to host the
 * suite's vault calls. `obsidian-vault.ts` otherwise hosts them in the focused
 * window, which is often a vault a run just opened, in this worktree or
 * another, and that run removes it when it ends.
 */
async function stableHost(): Promise<string | undefined> {
  const output = await cli([
    "eval",
    "code=JSON.stringify(require('electron').ipcRenderer.sendSync('vault-list'))",
  ]).catch(() => undefined);
  const reply = output?.slice(output.lastIndexOf("=> ") + 3);
  if (!reply) return undefined;
  const vaults = JSON.parse(reply) as Record<
    string,
    { path: string; open?: boolean }
  >;
  return Object.entries(vaults).find(
    ([, vault]) =>
      vault.open === true && !vault.path.includes(`${sep}.scratch${sep}e2e-`),
  )?.[0];
}

/**
 * `obsidian-vault.ts`, pinned to the Fixture at `fixtureRoot` and to a host
 * vault that outlives every End-to-end Run.
 */
export function vaultScript(
  workspaceRoot: string,
  fixtureRoot: string,
): VaultScript {
  return async (args) => {
    const host = await stableHost();
    return execFileAsync(
      process.execPath,
      [scriptPath(workspaceRoot), ...args, `--fixture-root=${fixtureRoot}`],
      {
        windowsHide: true,
        // `OBSIDIAN_HOST_VAULT_ENV` in packages/scripts/lib/obsidian-host-readiness.ts.
        env: host ? { ...process.env, ZT_HOST_VAULT: host } : process.env,
      },
    );
  };
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
