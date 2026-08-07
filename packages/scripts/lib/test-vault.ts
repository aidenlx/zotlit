// Per-worktree debug vault paths, shared by the Vite build and the vault script.

import { basename, join } from "node:path";

/**
 * The vault this worktree debugs against. Obsidian names a vault after its
 * folder and resolves `vault=<name>` to the first basename match, so the folder
 * carries the worktree name to keep every worktree's vault distinct.
 */
export function getTestVaultDir(workspaceRoot: string): string {
  return join(workspaceRoot, "tests", `zt-vault-${basename(workspaceRoot)}`);
}

/** The tracked fixture that a fresh per-worktree vault is seeded from. */
export function getTestVaultTemplateDir(workspaceRoot: string): string {
  return join(workspaceRoot, "tests", "zt-vault");
}
