// Per-worktree dev-vault paths, shared by the Vite build and the vault script.

import { basename, dirname, join } from "node:path";

import { getFixtureLayout, getFixtureRoot } from "./fixture/layout.ts";
import { DEFAULT_VAULT_CASE } from "./fixture/spec.ts";

/**
 * Environment variable that selects the Vault Case for tools that take no
 * argument: the Vite dev build copies its bundle into that case's vault, and
 * the vault script defaults `--vault-case` to it.
 */
export const DEV_VAULT_CASE_ENV = "ZT_VAULT_CASE";

/**
 * The vault this worktree debugs against. Obsidian names a vault after its
 * folder and resolves `vault=<name>` to the first basename match, so the folder
 * carries the worktree name to keep every worktree's vault distinct. Each
 * Vault Case other than the default gets its own vault, suffixed with the
 * case id, so the cases never overwrite one another.
 */
export function getDevVaultDir(
  workspaceRoot: string,
  vaultCase: string = DEFAULT_VAULT_CASE,
): string {
  const worktreeName = basename(workspaceRoot);
  const worktreeParent = dirname(workspaceRoot);
  const worktreesDir = dirname(worktreeParent);
  const codexWorktree =
    basename(worktreesDir) === "worktrees" &&
    basename(dirname(worktreesDir)) === ".codex";
  const uniqueName = codexWorktree
    ? `${worktreeName}-${basename(worktreeParent)}`
    : worktreeName;

  const caseSuffix = vaultCase === DEFAULT_VAULT_CASE ? "" : `-${vaultCase}`;

  return join(
    workspaceRoot,
    "tests",
    `fixture-vault-${uniqueName}${caseSuffix}`,
  );
}

/** The generated Fixture Vault that seeds a fresh per-worktree dev vault. */
export function getFixtureVaultDir(workspaceRoot: string): string {
  return getFixtureLayout(getFixtureRoot(workspaceRoot)).vaultDir;
}
