#!/usr/bin/env zx

// only for the type checker
import type {} from "zx/globals";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

$.verbose = true;

// for copying .env* files from the primary worktree
const primary = argv._[0];

await $`git submodule update --init --jobs 8 --depth 1 --single-branch`;

if (primary) {
  await $`pnpm install --frozen-lockfile --prefer-offline`;
} else {
  await $`pnpm install --frozen-lockfile`;
}

if (primary) {
  for (const rel of await glob("**/.env*", {
    cwd: primary,
    dot: true,
    ignore: ["**/node_modules/**", "**/.git/**", "**/*.example"],
  })) {
    const dest = join(".", rel);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(join(primary, rel), dest);
    echo(`Copied ${rel}`);
  }

  await writeFile(".primary-worktree", primary);
  echo(`Wrote .primary-worktree → ${primary}`);
}

await $`turbo run build --filter=./packages/* --filter=@zotlit/obsidian`;
