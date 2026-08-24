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

// App-level codegen. Both outputs are gitignored, so a fresh worktree type-checks
// only once these run: the Obsidian i18n message facade (`generate:language-packs`)
// and the Fumadocs source map plus Next.js route types such as `PageProps`
// (`codegen`). Left unfiltered so any package that later adds either script is
// picked up.
await $`turbo run generate:language-packs codegen`;
