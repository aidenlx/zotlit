#!/usr/bin/env node

// Pre-commit guard: fails when files outside the commit would reach the lint
// build. One `git status` call; Lefthook runs it before format and lint.
import { $ } from "zx";

import { looseFiles, looseFilesMessage } from "#commit-tree";

const { stdout } =
  await $`git --no-optional-locks status --porcelain=v1 -z --untracked-files=all`;
const loose = looseFiles(stdout);
if (loose.length > 0) {
  console.error(looseFilesMessage(loose));
  process.exitCode = 1;
}
