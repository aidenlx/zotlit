#!/usr/bin/env node

// The one quality gate. GitHub runs no pull-request checks; see ADR 0076.
//   (no flag)   the packages the branch changed since it left `next` or
//               `main`, and their dependents. Lefthook runs this on every push.
//   --release   every package, the desktop End-to-end Run and worker check,
//               plus the Obsidian guideline review (ADR 0020).
//               `release.ts` runs it before the version commit and
//               `release.yml` before it publishes (desktop checks skip there).
// Format, lint and the generated-artifact checks always cover the whole tree.
import { $ } from "zx";

import {
  MEMORY_GATE_ADMITTED_ENV,
  passMemoryGateOrExit,
} from "@zotlit/config/memory-gate";

import { affectedBase } from "#affected-base";
import {
  acquireDesktopSlotOrExit,
  automatedLease,
  DEFAULT_LEASE_MS,
} from "#desktop-slot";
import { getWorkspaceRoot } from "#package-roots";

const release = process.argv.includes("--release");
const ci = process.env.GITHUB_ACTIONS === "true";

const root = await getWorkspaceRoot(import.meta.dirname);
const base = release ? undefined : await affectedBase(root);
// `--affected` selects the changed packages and their dependents since
// TURBO_SCM_BASE. Without a base, every package.
const scope = base ? ["--affected"] : [];
const env = base ? { ...process.env, TURBO_SCM_BASE: base } : process.env;
const sh = $({ cwd: root, stdio: "inherit", env });

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
// The step passes the Memory Gate once; each package's Vitest then skips it.
await step("Test", async () => {
  const admitted = await passMemoryGateOrExit();
  const gated = sh({
    env: admitted ? { ...env, [MEMORY_GATE_ADMITTED_ENV]: "1" } : env,
  });
  await gated`pnpm exec turbo run test ${scope} --concurrency=${ci ? 1 : 2}`;
  await gated`pnpm test:eval-runtime`;
});

if (release) {
  await desktopChecks();
  await step("Obsidian guideline review", () => sh`pnpm review`);
}

/**
 * One Desktop Slot hold covers both desktop runs: one wait in the Desktop
 * Queue and one Memory Gate pass, which the nested runs reuse through the
 * environment. At the Admission Deadline this exits 75, outside `step`.
 */
async function desktopChecks(): Promise<void> {
  using _slot = ci
    ? undefined
    : await acquireDesktopSlotOrExit({
        cwd: root,
        command: "pnpm verify --release",
        leaseMs: automatedLease(
          DEFAULT_LEASE_MS.e2e + DEFAULT_LEASE_MS.e2eWorker,
        ),
      });
  await step("End-to-end Run", async () => {
    if (ci) {
      console.log("End-to-end Run is desktop-only and ran in pnpm release.");
      return;
    }
    // The hold put its token and the Memory Gate mark in process.env.
    await sh({ env: { ...process.env, ZOTLIT_E2E_REQUIRED: "1" } })`pnpm e2e`;
    await sh({ env: { ...process.env } })`pnpm e2e:worker`;
  });
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
