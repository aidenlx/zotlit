// Per-worktree dev-vault paths, shared by the Vite build and the vault script.

import { basename, dirname, join } from "node:path";

import { getFixtureLayout, getFixtureRoot } from "./fixture/layout.ts";

/**
 * The vault this worktree debugs against. Obsidian names a vault after its
 * folder and resolves `vault=<name>` to the first basename match, so the folder
 * carries the worktree name to keep every worktree's vault distinct.
 */
export function getDevVaultDir(workspaceRoot: string): string {
  const worktreeName = basename(workspaceRoot);
  const worktreeParent = dirname(workspaceRoot);
  const worktreesDir = dirname(worktreeParent);
  const codexWorktree =
    basename(worktreesDir) === "worktrees" &&
    basename(dirname(worktreesDir)) === ".codex";
  const uniqueName = codexWorktree
    ? `${worktreeName}-${basename(worktreeParent)}`
    : worktreeName;

  return join(workspaceRoot, "tests", `fixture-vault-${uniqueName}`);
}

/** The generated Fixture Vault that seeds a fresh per-worktree dev vault. */
export function getFixtureVaultDir(workspaceRoot: string): string {
  return getFixtureLayout(getFixtureRoot(workspaceRoot)).vaultDir;
}
