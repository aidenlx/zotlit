import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempDisposableSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { scanFirstCommitDays } from "./first-commits";

/** Git in `root` with none of this machine's settings, such as commit signing. */
function git(root: string, args: string[], env: Record<string, string> = {}) {
  execFileSync("git", args, {
    cwd: root,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      ...env,
    },
  });
}

/** Commits the working tree of `root` as of `day`. */
function commitOn(root: string, day: string) {
  git(root, ["commit", "--quiet", "--all", "--message", day], {
    GIT_AUTHOR_DATE: `${day}T12:00:00Z`,
    GIT_COMMITTER_DATE: `${day}T12:00:00Z`,
  });
}

// A page's publication day must not move when the page is edited or moved:
// JSON-LD `datePublished` reads it.
describe("scanFirstCommitDays", () => {
  it("keeps each page's first day through edits and renames", () => {
    using dir = mkdtempDisposableSync(join(tmpdir(), "first-commits-"));
    const root = dir.path;
    git(root, ["init", "--quiet"]);
    mkdirSync(join(root, "content/docs/tutorial"), { recursive: true });
    writeFileSync(join(root, "content/docs/tutorial/first-note.mdx"), "one\n");
    writeFileSync(join(root, "outside.md"), "not content\n");
    git(root, ["add", "."]);
    commitOn(root, "2026-07-18");

    mkdirSync(join(root, "content/learn"));
    renameSync(
      join(root, "content/docs/tutorial/first-note.mdx"),
      join(root, "content/learn/connect.mdx"),
    );
    writeFileSync(join(root, "content/docs/new.mdx"), "new\n");
    git(root, ["add", "--all"]);
    commitOn(root, "2026-11-13");

    writeFileSync(join(root, "content/learn/connect.mdx"), "one\nedited\n");
    commitOn(root, "2026-11-20");

    expect(scanFirstCommitDays(root)).toEqual({
      "learn/connect.mdx": "2026-07-18",
      "docs/new.mdx": "2026-11-13",
    });
  });

  it("finds no days outside a git checkout", () => {
    using dir = mkdtempDisposableSync(join(tmpdir(), "first-commits-"));
    expect(scanFirstCommitDays(dir.path)).toEqual({});
  });
});
