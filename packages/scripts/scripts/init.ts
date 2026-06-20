#!/usr/bin/env zx

import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
// only for the type checker
import type {} from "zx/globals";

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

  const appCss = ".agents/skills/obsidian-css/references/app.css";
  try {
    await mkdir(dirname(appCss), { recursive: true });
    await copyFile(join(primary, appCss), appCss);
    echo(`Copied ${appCss}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  await writeFile(".primary-worktree", primary);
  echo(`Wrote .primary-worktree → ${primary}`);
}

await $`turbo run build --filter=./packages/*`;
await $`turbo run paraglide:compile`;
