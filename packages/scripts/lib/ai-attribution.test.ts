import { describe, expect, it } from "vitest";

import {
  attributionLines,
  isAgentBranch,
  isAgentIdentity,
} from "./ai-attribution.ts";

describe("attributionLines", () => {
  it.each([
    "Co-Authored-By: Claude <noreply@anthropic.com>",
    "Co-authored-by: Cursor <cursoragent@cursor.com>",
    "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>",
    "Claude-Session: https://claude.ai/code/session_01abc",
    "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
    "Made with Cursor",
  ])("flags %s", (line) => {
    expect(attributionLines(`feat: x\n\n${line}\n`)).toEqual([line]);
  });

  it("keeps a message that only mentions the tools", () => {
    expect(
      attributionLines(
        "chore: drop the CLAUDE.md pointers to AGENTS.md\n\nThe cursor moves off the Cursor tool.\n",
      ),
    ).toEqual([]);
  });

  it("keeps a human co-author", () => {
    expect(
      attributionLines("fix: x\n\nCo-authored-by: Ana <ana@example.com>\n"),
    ).toEqual([]);
  });
});

describe("isAgentIdentity", () => {
  it("flags the agents by name or by email", () => {
    expect(isAgentIdentity("Claude", "noreply@anthropic.com")).toBe(true);
    expect(isAgentIdentity("Cursor Agent", "cursoragent@cursor.com")).toBe(
      true,
    );
    expect(isAgentIdentity("Claude", "someone@example.com")).toBe(true);
  });

  it("passes people", () => {
    expect(
      isAgentIdentity("aidenlx", "31102694+aidenlx@users.noreply.github.com"),
    ).toBe(false);
    expect(isAgentIdentity("Claudia Cursor", "claudia@example.com")).toBe(
      false,
    );
  });
});

describe("isAgentBranch", () => {
  it.each(["claude/x", "codex/1418-citation", "cursor/docs-i18n"])(
    "rejects refs/heads/%s",
    (branch) => {
      expect(isAgentBranch(`refs/heads/${branch}`)).toBe(true);
    },
  );

  it.each(["feat/claude-md", "next", "release/codex-notes"])(
    "allows refs/heads/%s",
    (branch) => {
      expect(isAgentBranch(`refs/heads/${branch}`)).toBe(false);
    },
  );

  it("allows tags", () => {
    expect(isAgentBranch("refs/tags/codex/1")).toBe(false);
  });
});
