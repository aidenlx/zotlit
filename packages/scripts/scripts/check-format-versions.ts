#!/usr/bin/env node
import { execFileSync } from "node:child_process";

import {
  compareFormatVersion,
  formatVersions,
  latestReleaseTag,
  readFormatVersion,
} from "#format-versions";
import { getWorkspaceRoot } from "#package-roots";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const git = (...args: string[]) =>
  execFileSync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });

try {
  const release = latestReleaseTag(git("tag", "--list").trim().split("\n"));
  const releasedFiles = new Set(
    git("ls-tree", "-r", "--name-only", "-z", release).split("\0"),
  );
  const errors: string[] = [];
  for (const entry of formatVersions) {
    const head = readFormatVersion(
      git("show", `HEAD:${entry.file}`),
      entry.constant,
    );
    const released = releasedFiles.has(entry.file)
      ? readFormatVersion(
          git("show", `${release}:${entry.file}`),
          entry.constant,
        )
      : null;
    const error = compareFormatVersion(entry, head, released);
    if (error) errors.push(error);
  }
  if (errors.length)
    throw new Error(`Released baseline: ${release}\n${errors.join("\n")}`);
  console.log(
    `check-format-versions: ${formatVersions.length} formats checked against ${release}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
