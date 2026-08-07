#!/usr/bin/env zx

// only for the type checker
import type {} from "zx/globals";

$.verbose = true;

// path to the primary worktree; wt itself copies gitignored files matched by
// .worktreeinclude when creating the worktree
const primary = argv._[0];

// `--no-submodules` skips checkout when the caller already has them — e.g. CI
// where actions/checkout fetches submodules itself.
if (argv.submodules !== false) {
  await $`git submodule update --init --jobs 8 --depth 1 --single-branch`;
}

if (primary) {
  await $`pnpm install --frozen-lockfile --prefer-offline`;
} else {
  await $`pnpm install --frozen-lockfile`;
}

await $`turbo run build --filter=./packages/*`;
