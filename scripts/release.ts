import * as p from "@clack/prompts";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { coerce, gte, inc, lte, prerelease, valid } from "semver";
import { $ } from "zx";

import { parseManifest as parseObsidianManifest } from "../apps/obsidian/scripts/manifest.js";

/**
 * Phase 1 of the release pipeline: local, interactive version bump.
 *
 * Bumps `apps/{app}/package.json#version` (the sole version source), runs the
 * derived sync side-effects, refreshes the lockfile, gates on `pnpm quality`
 * (aborts loudly if lint/format fails), and lands a single release commit. It
 * performs **no tagging, no push, no GitHub release** — CI (`release.yml`)
 * cuts tags/releases on merge to the line the PR targets (`main` = stable,
 * `next` = beta), keyed on package version.
 *
 * The line is inferred from the branch the script runs on: a stable release
 * from `main`, a beta release from `next`. A floor-guard reads the counterpart
 * line's version and rejects out-of-policy bumps (stable must stay below the
 * beta floor; beta must stay strictly above the stable head).
 *
 * @see HANDOFF.md "Phase 1 — Local version bump", "Branching model"
 */

const repoRoot = resolve(import.meta.dirname, "..");

type AppName = "obsidian" | "zotero";

interface AppMeta {
  name: AppName;
  display: string;
  pkgPath: string;
}

const APPS: Record<AppName, AppMeta> = {
  obsidian: {
    name: "obsidian",
    display: "@zotlit/obsidian",
    pkgPath: join(repoRoot, "apps/obsidian/package.json"),
  },
  zotero: {
    name: "zotero",
    display: "@zotlit/zotero",
    pkgPath: join(repoRoot, "apps/zotero/package.json"),
  },
};

interface Bump {
  app: AppMeta;
  current: string;
  next: string;
}

p.intro("ZotLit release");

await assertCleanWorkingTree();

const currentBranch = (
  await $({ cwd: repoRoot })`git rev-parse --abbrev-ref HEAD`
).stdout.trim();

/** Release line inferred from the branch: `main` ships stable, `next` ships beta. */
const line: "stable" | "beta" | "other" =
  currentBranch === "main"
    ? "stable"
    : currentBranch === "next"
      ? "beta"
      : "other";

/** The opposite line's branch, whose version the floor-guard reads. */
const counterpartBranch =
  currentBranch === "main" ? "next" : currentBranch === "next" ? "main" : null;

if (line === "other") {
  p.log.warn(
    `Releasing from "${currentBranch}" (not main/next): floor-guard is advisory and the PR base will target this branch.`,
  );
}

const selection = await p.select({
  message: "Which app(s) to release?",
  options: [
    { value: "obsidian", label: "Obsidian (@zotlit/obsidian)" },
    { value: "zotero", label: "Zotero (@zotlit/zotero)" },
    { value: "both", label: "Both" },
  ] as const,
});
if (p.isCancel(selection)) cancel();

const targets: AppMeta[] =
  selection === "both"
    ? [APPS.obsidian, APPS.zotero]
    : [APPS[selection as AppName]];

const bumps: Bump[] = [];
for (const app of targets) {
  const current = (await readPackageJson(app.pkgPath)).version as string;
  const counterpart = await counterpartVersion(app);
  if (counterpartBranch && counterpart === null) {
    p.log.warn(
      `Counterpart branch "${counterpartBranch}" has no ${app.display} version; floor-guard is advisory for this app.`,
    );
  }
  const next = await pickVersion(app, current, counterpart);
  if (next === null) cancel();
  bumps.push({ app, current, next });
}

const summary = bumps.map((b) => `${b.app.name}@${b.next}`).join(", ");
const confirmed = await p.confirm({ message: `Release ${summary}?` });
if (p.isCancel(confirmed) || !confirmed) cancel();

const stagedPaths = new Set<string>();
const s = p.spinner();

s.start("Bumping versions");
for (const { app, next } of bumps) {
  await writePackageVersion(app.pkgPath, next);
  stagedPaths.add(app.pkgPath);
}
s.stop("Versions bumped");

await syncObsidian(bumps, stagedPaths);

s.start("Refreshing lockfile");
await $({ cwd: repoRoot })`pnpm install --lockfile-only`;
stagedPaths.add(join(repoRoot, "pnpm-lock.yaml"));
s.stop("Lockfile refreshed");

s.start("Quality check");
const quality = await $({ cwd: repoRoot, nothrow: true })`pnpm quality`;
if (quality.exitCode !== 0) {
  s.stop("Quality check failed", 1);
  p.cancel(
    `Quality check failed — fix lint/format errors before releasing:\n${quality.stdout}${quality.stderr}`,
  );
  process.exit(1);
}
s.stop("Quality passed");

const branchName = `release/${currentBranch}/${bumps.map((b) => `${b.app.name}-${b.next}`).join("+")}`;
const commitMsg = `chore: release ${summary}`;

const gitConfirm = await p.confirm({
  message: `Create branch ${branchName}, commit, push to origin, and open a PR?`,
});
if (p.isCancel(gitConfirm) || !gitConfirm) {
  p.outro(
    [
      "Version files updated but not committed.",
      `To finish manually: git checkout -b ${branchName} && git add -A && git commit -m "${commitMsg}" && git push -u origin ${branchName}`,
    ].join("\n"),
  );
  process.exit(0);
}

s.start(`Creating branch ${branchName}`);
await $({ cwd: repoRoot })`git checkout -b ${branchName}`;
s.stop(`On branch ${branchName}`);

s.start("Committing");
await $({ cwd: repoRoot })`git add ${[...stagedPaths]}`;
await $({ cwd: repoRoot })`git commit -m ${commitMsg}`;
s.stop("Committed");

s.start("Pushing");
await $({ cwd: repoRoot })`git push -u origin ${branchName}`;
s.stop("Pushed");

const openPr = await p.confirm({ message: `Open a PR to ${currentBranch}?` });
if (!p.isCancel(openPr) && openPr) {
  await openPR(branchName, commitMsg, currentBranch);
}

p.outro(
  [
    `Released ${summary} on branch ${branchName}.`,
    `On merge to ${currentBranch}, release.yml cuts the tag(s) and GitHub release(s).`,
  ].join("\n"),
);

async function openPR(
  branch: string,
  title: string,
  base: string,
): Promise<void> {
  const hasGh = await $({ cwd: repoRoot, nothrow: true })`gh --version`.then(
    (r) => r.exitCode === 0,
  );

  if (hasGh) {
    const s = p.spinner();
    s.start("Creating PR via gh");
    await $({
      cwd: repoRoot,
    })`gh pr create --title ${title} --body "" --head ${branch} --base ${base}`;
    s.stop("PR created");
  } else {
    const rootPkg = JSON.parse(
      await readFile(join(repoRoot, "package.json"), "utf-8"),
    ) as { repository?: { url?: string } | string };
    const repoUrl =
      typeof rootPkg.repository === "string"
        ? rootPkg.repository
        : rootPkg.repository?.url?.replace(/^git\+/, "").replace(/\.git$/, "");
    const prUrl = repoUrl
      ? `${repoUrl}/compare/${base}...${branch}?expand=1`
      : `https://github.com — open a PR from ${branch} to ${base}`;
    p.log.info(`Open a PR: ${prUrl}`);
  }
}

/**
 * Interactive semver picker with the branching-model floor-guard. Re-prompts on
 * an out-of-policy choice.
 *
 * @param counterpart the counterpart line's current version (stable head when on
 *   `next`, beta head when on `main`), or `null` when that branch is absent — in
 *   which case the guard is advisory.
 * @returns the chosen version, or `null` if cancelled.
 */
async function pickVersion(
  app: AppMeta,
  current: string,
  counterpart: string | null,
): Promise<string | null> {
  const preid = prerelease(current)?.[0]?.toString() ?? "beta";
  while (true) {
    const kind = await p.select({
      message: `New version for ${app.display} (current ${current})`,
      options: [
        { value: "patch", label: `patch (${inc(current, "patch")})` },
        { value: "minor", label: `minor (${inc(current, "minor")})` },
        { value: "major", label: `major (${inc(current, "major")})` },
        {
          value: "prepatch",
          label: `prepatch (${inc(current, "prepatch", preid)})`,
        },
        {
          value: "preminor",
          label: `preminor (${inc(current, "preminor", preid)})`,
        },
        {
          value: "premajor",
          label: `premajor (${inc(current, "premajor", preid)})`,
        },
        {
          value: "prerelease",
          label: `prerelease (${inc(current, "prerelease", preid)})`,
        },
        { value: "custom", label: "custom…" },
      ] as const,
    });
    if (p.isCancel(kind)) return null;

    let next: string | null;
    if (kind === "custom") {
      const custom = await p.text({
        message: "Enter custom version",
        validate: (val) => (valid(val) ? undefined : "Invalid semver version"),
      });
      if (p.isCancel(custom)) return null;
      next = custom;
    } else {
      next = inc(current, kind, preid);
    }
    if (next === null) {
      p.log.error("Could not compute the next version; pick another.");
      continue;
    }

    const violation = floorViolation(next, counterpart);
    if (violation) {
      p.log.error(violation);
      continue;
    }
    return next;
  }
}

/**
 * Read the counterpart line's version for `app` via `git show`.
 *
 * @returns the version string, or `null` when the branch or its `package.json`
 *   doesn't exist yet — the guard then becomes advisory.
 */
async function counterpartVersion(app: AppMeta): Promise<string | null> {
  if (!counterpartBranch) return null;
  const res = await $({
    cwd: repoRoot,
    nothrow: true,
  })`git show ${`${counterpartBranch}:apps/${app.name}/package.json`}`;
  if (res.exitCode !== 0) return null;
  try {
    return (JSON.parse(res.stdout) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

/**
 * Enforce the version-monotonicity invariant between the stable and beta lines.
 *
 * - On `main` (stable): reject when `coerce(next) >= coerce(beta)` — stable must
 *   stay below the beta's release namespace.
 * - On `next` (beta): reject when `coerce(next) <= stableHead` — the beta base
 *   must stay strictly above the stable head.
 *
 * @returns a human-readable rejection reason, or `null` when the choice is in
 *   policy (or the guard is advisory).
 */
function floorViolation(
  next: string,
  counterpart: string | null,
): string | null {
  if (line === "other" || counterpart === null) return null;
  const c = coerce(next);
  if (!c) return null;

  if (line === "stable") {
    const floor = coerce(counterpart);
    if (floor && gte(c, floor)) {
      return `Stable releases from main must stay below the beta floor ${floor.version} (beta is ${counterpart}). Pick a patch or a custom version below ${floor.version}.`;
    }
  } else {
    const head = coerce(counterpart);
    if (head && lte(c, head)) {
      return `Beta releases from next must stay strictly above the stable head ${counterpart}. Pick a higher minor/major.`;
    }
  }
  return null;
}

/**
 * Obsidian community-store sync, applied on **stable** Obsidian releases only.
 * Prereleases ship via BRAT straight from release assets, so the root
 * `manifest.json` / `versions.json` are untouched.
 */
async function syncObsidian(
  releases: Bump[],
  staged: Set<string>,
): Promise<void> {
  const obsidian = releases.find((b) => b.app.name === "obsidian");
  if (!obsidian || prerelease(obsidian.next) !== null) return;

  const pkg = await readPackageJson(APPS.obsidian.pkgPath);
  pkg.version = obsidian.next;

  const manifest = parseObsidianManifest(pkg);
  const manifestPath = join(repoRoot, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  staged.add(manifestPath);

  const versionsPath = join(repoRoot, "versions.json");
  const versions = JSON.parse(await readFile(versionsPath, "utf-8")) as Record<
    string,
    string
  >;
  versions[manifest.version] = manifest.minAppVersion;
  await writeFile(versionsPath, `${JSON.stringify(versions, null, 2)}\n`);
  staged.add(versionsPath);
}

async function readPackageJson(
  path: string,
): Promise<Record<string, unknown> & { version: string }> {
  return JSON.parse(await readFile(path, "utf-8"));
}

async function writePackageVersion(
  path: string,
  version: string,
): Promise<void> {
  const pkg = await readPackageJson(path);
  pkg.version = version;
  await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function assertCleanWorkingTree(): Promise<void> {
  const status = (
    await $({ cwd: repoRoot })`git status --porcelain`
  ).stdout.trim();
  if (status.length === 0) return;
  p.cancel(
    `Working tree is not clean. Commit or stash changes first:\n${status}`,
  );
  process.exit(1);
}

function cancel(): never {
  p.cancel("Release cancelled.");
  process.exit(0);
}
