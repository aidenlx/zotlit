import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getDevVaultDir } from "./dev-vault.ts";

describe("getDevVaultDir", () => {
  it("uses the worktree folder for an ordinary worktree", () => {
    const workspaceRoot = join("workspace", "feature-branch");

    expect(getDevVaultDir(workspaceRoot)).toBe(
      join(workspaceRoot, "tests", "fixture-vault-feature-branch"),
    );
  });

  it("includes the Codex worktree id when repository folders repeat", () => {
    const workspaceRoot = join(
      "workspace",
      ".codex",
      "worktrees",
      "57d4",
      "zotlit-v2",
    );

    expect(getDevVaultDir(workspaceRoot)).toBe(
      join(workspaceRoot, "tests", "fixture-vault-zotlit-v2-57d4"),
    );
  });
});
