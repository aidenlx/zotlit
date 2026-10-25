import { describe, expect, it } from "vitest";

import { isAgentDoc, isAgentDocsOnly } from "./agent-docs.ts";

describe("isAgentDoc", () => {
  it.each([
    "AGENTS.md",
    "apps/obsidian/AGENTS.md",
    "CLAUDE.md",
    "CODING_STANDARDS.md",
    "apps/obsidian/CODING_STANDARDS.md",
    "packages/db/GLOSSARY.md",
    "README.md",
    "CONTRIBUTING.md",
    "policies/simplicity.md",
    "apps/obsidian/policies/services.md",
    "docs/adr/0076-checks-run-before-push-and-ci-runs-only-to-release.md",
    "docs/agents/issue-tracker.md",
    ".agents/skills/obsidian-services/SKILL.md",
    ".claude/skills/codex/SKILL.md",
  ])("counts %s", (path) => {
    expect(isAgentDoc(path)).toBe(true);
  });

  it.each([
    // Code reads these.
    "apps/obsidian/src/lib/turndown/__snapshots__/zt-note-example.md",
    "packages/scripts/lib/fixture/vault-pages/Scan target.md",
    "apps/docs/content/docs/reference/templates/data.mdx",
    "apps/docs/content/docs/index.md",
    "pnpm-lock.yaml",
    "apps/obsidian/src/main.ts",
    ".claude/settings.json",
  ])("does not count %s", (path) => {
    expect(isAgentDoc(path)).toBe(false);
  });
});

describe("isAgentDocsOnly", () => {
  it("is true when every changed file is an agent doc", () => {
    expect(isAgentDocsOnly(["AGENTS.md", "policies/simplicity.md"])).toBe(true);
  });

  it("is false when one changed file is not", () => {
    expect(isAgentDocsOnly(["AGENTS.md", "pnpm-lock.yaml"])).toBe(false);
  });

  it("is false when nothing changed", () => {
    expect(isAgentDocsOnly([])).toBe(false);
  });
});
