#!/usr/bin/env node

// The one quality gate. GitHub runs no pull-request checks; see ADR 0076.
//   (no flag)   the packages the branch changed since it left `next` or
//               `main`, and their dependents. Lefthook runs this on every push.
//   --release   every package, plus the Obsidian guideline review (ADR 0020).
//               `release.ts` runs it before the version commit and
//               `release.yml` before it publishes.
// Format, lint and the generated-artifact checks always cover the whole tree.
import { $ } from "zx";

import { getWorkspaceRoot } from "#package-roots";

const release = process.argv.includes("--release");
const ci = process.env.GITHUB_ACTIONS === "true";

const root = await getWorkspaceRoot(import.meta.dirname);
const base = release ? undefined : await affectedBase();
// `--affected` selects the changed packages and their dependents since
// TURBO_SCM_BASE. Without a base, every package.
const scope = base ? ["--affected"] : [];
const sh = $({
  cwd: root,
  stdio: "inherit",
  env: base ? { ...process.env, TURBO_SCM_BASE: base } : process.env,
});

await step("Format", () => sh`pnpm exec oxfmt --check`);

// The `zt` template contract and the template data page generate from TS
// sources (ADR 0015), so a commit that changes the sources without the
// regenerated output fails here. The contract generator imports the built
// `@zotlit/zotero-types`; the page generator reads the contract source.
await step("Generated artifacts", async () => {
  await sh`pnpm exec turbo run build --filter=@zotlit/zotero-types`;
  await sh`pnpm --filter @zotlit/db generate:contract`;
  await sh`pnpm --filter @zotlit/docs generate:template-data`;
  const stale = (
    await $({
      cwd: root,
    })`git status --porcelain -- packages/db/src/contract/generated apps/docs/content/docs/reference/templates/data.mdx`
  ).stdout.trim();
  if (stale) {
    throw new Error(
      `Regenerated output differs from the commit. Commit these files:\n${stale}`,
    );
  }
});

// `-f github` turns oxlint errors into inline annotations on the run.
await step("Lint", () => sh`pnpm lint ${ci ? ["--", "-f", "github"] : []}`);

// @zotlit/e2e stays out with the rest of the End-to-end Run.
await step(
  "Typecheck",
  () =>
    sh`pnpm exec turbo run typecheck typecheck:test --filter=!@zotlit/e2e ${scope}`,
);

await step(
  "Snapshot size",
  () => sh`node packages/scripts/scripts/snapshot-size.ts`,
);

// Each Vitest package runs its own worker pool, so a few packages at a time
// keep a starved worker from tripping its wall-clock timeout. The hosted
// runner has 4 vCPU: one package at a time there.
await step("Test", async () => {
  await sh`pnpm exec turbo run test ${scope} --concurrency=${ci ? 1 : 2}`;
  await sh`pnpm test:eval-runtime`;
});

if (release) await step("Obsidian guideline review", () => sh`pnpm review`);

/**
 * The merge base with the nearer of `origin/next` and `origin/main`. A hotfix
 * branch off `main` then checks its own commits, not everything `next` gained.
 */
async function affectedBase(): Promise<string | undefined> {
  let base: { sha: string; distance: number } | undefined;
  for (const line of ["origin/next", "origin/main"]) {
    const mergeBase = await $({
      cwd: root,
      nothrow: true,
    })`git merge-base HEAD ${line}`;
    if (mergeBase.exitCode !== 0) continue;
    const sha = mergeBase.stdout.trim();
    const distance = Number(
      (await $({ cwd: root })`git rev-list --count ${sha}..HEAD`).stdout,
    );
    if (!base || distance < base.distance) base = { sha, distance };
  }
  return base?.sha;
}

async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  console.log(`\n▸ ${name}`);
  try {
    await run();
  } catch (error) {
    // zx has already streamed the failed command's output.
    if (error instanceof Error && !("exitCode" in error)) {
      console.error(error.message);
    }
    console.error(`\n✖ ${name} failed`);
    process.exit(1);
  }
}
