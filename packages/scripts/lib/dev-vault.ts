// Per-worktree dev-vault paths, shared by the Vite build and the vault script.

import { basename, join } from "node:path";

import { getFixtureLayout, getFixtureRoot } from "./fixture/layout.ts";

/**
 * The vault this worktree debugs against. Obsidian names a vault after its
 * folder and resolves `vault=<name>` to the first basename match, so the folder
 * carries the worktree name to keep every worktree's vault distinct.
 */
export function getDevVaultDir(workspaceRoot: string): string {
  return join(
    workspaceRoot,
    "tests",
    `fixture-vault-${basename(workspaceRoot)}`,
  );
}

/** The generated Fixture Vault that seeds a fresh per-worktree dev vault. */
export function getFixtureVaultDir(workspaceRoot: string): string {
  return getFixtureLayout(getFixtureRoot(workspaceRoot)).vaultDir;
}
