import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { e2eVaultDir } from "./vault-script.ts";

describe("e2eVaultDir", () => {
  it("uses the worktree folder for an ordinary worktree", () => {
    const workspaceRoot = join("workspace", "feature-branch");

    expect(e2eVaultDir(workspaceRoot, "fixture-vault")).toBe(
      join(workspaceRoot, ".scratch", "e2e-fixture-vault-feature-branch"),
    );
  });

  it("includes the Codex worktree id when repository folders repeat", () => {
    const firstRoot = join(
      "workspace",
      ".codex",
      "worktrees",
      "1dc9",
      "zotlit-v2",
    );
    const secondRoot = join(
      "workspace",
      ".codex",
      "worktrees",
      "2439",
      "zotlit-v2",
    );

    expect(e2eVaultDir(firstRoot, "fixture-vault")).toBe(
      join(firstRoot, ".scratch", "e2e-fixture-vault-zotlit-v2-1dc9"),
    );
    expect(e2eVaultDir(secondRoot, "fixture-vault")).toBe(
      join(secondRoot, ".scratch", "e2e-fixture-vault-zotlit-v2-2439"),
    );
    expect(e2eVaultDir(firstRoot, "fixture-vault")).toBe(
      e2eVaultDir(firstRoot, "fixture-vault"),
    );
  });
});
