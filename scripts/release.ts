import * as p from "@clack/prompts";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { inc, prerelease, valid } from "semver";
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
 * The release line is inferred from the branch the script runs on: a stable
 * release from `main`, a beta release from `next`. Keeping the beta line
 * strictly ahead of stable is a manual convention — see CONTRIBUTING.md
 * "Version policy"; it is not enforced here.
 *
 * @see CONTRIBUTING.md "Branching model"
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

if (currentBranch !== "main" && currentBranch !== "next") {
  p.log.warn(
    `Releasing from "${currentBranch}" (not main/next): the PR base will target this branch.`,
  );
}

// Sync the branch with origin before bumping so the release PR contains only the
// version-bump commit. Basing the release branch on `origin/${currentBranch}`
// (below) drops any unpushed local commits; pushing first lands them on the base
// branch instead of dragging them into the PR (where a rebase-merge would replay
// them with fresh SHAs). `HEAD` for a local-only branch with no origin counterpart.
const remoteExists = await assertBranchSynced(currentBranch);
const baseRef = remoteExists ? `origin/${currentBranch}` : "HEAD";

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
  const next = await pickVersion(app, current);
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
      `To finish manually: git checkout -b ${branchName} ${baseRef} && git add -A && git commit -m "${commitMsg}" && git push -u origin ${branchName}`,
    ].join("\n"),
  );
  process.exit(0);
}

s.start(`Creating branch ${branchName}`);
await $({ cwd: repoRoot })`git checkout -b ${branchName} ${baseRef}`;
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
    // `gh pr create` prints the new PR's URL to stdout.
    const created = await $({
      cwd: repoRoot,
    })`gh pr create --title ${title} --body "" --head ${branch} --base ${base}`;
    s.stop("PR created");
    const prUrl = created.stdout.trim();
    if (prUrl) p.log.info(`PR: ${prUrl}`);
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
 * Interactive semver picker.
 *
 * @returns the chosen version, or `null` if cancelled.
 */
async function pickVersion(
  app: AppMeta,
  current: string,
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
      // Normalize: `valid()` also accepts noncanonical input like `v2.0.0`.
      next = valid(custom);
    } else {
      next = inc(current, kind, preid);
    }
    if (next === null) {
      p.log.error("Could not compute the next version; pick another.");
      continue;
    }
    return next;
  }
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

/**
 * Fetches `origin/${branch}` and requires local to match it before releasing, so
 * the release branch (cut from the remote tip) carries only the version bump.
 * Offers to push when the branch is merely ahead; aborts on behind/diverged since
 * the base would be stale.
 *
 * @returns whether an origin counterpart exists — `false` for a local-only
 *   branch, whose release branch falls back to `HEAD`.
 */
async function assertBranchSynced(branch: string): Promise<boolean> {
  const fetched = await $({
    cwd: repoRoot,
    nothrow: true,
  })`git fetch origin ${branch}`;
  if (fetched.exitCode !== 0) {
    p.log.warn(`No origin/${branch}: basing the release branch on local HEAD.`);
    return false;
  }

  const counts = (
    await $({
      cwd: repoRoot,
    })`git rev-list --left-right --count origin/${branch}...HEAD`
  ).stdout.trim();
  const [behind, ahead] = counts.split(/\s+/).map(Number);

  if (behind > 0 && ahead > 0) {
    p.cancel(
      `"${branch}" has diverged from origin/${branch} (${ahead} ahead, ${behind} behind). Reconcile before releasing.`,
    );
    process.exit(1);
  }
  if (behind > 0) {
    p.cancel(
      `"${branch}" is ${behind} commit(s) behind origin/${branch}. Pull before releasing.`,
    );
    process.exit(1);
  }
  if (ahead > 0) {
    const push = await p.confirm({
      message: `"${branch}" has ${ahead} commit(s) not on origin/${branch}. Push them before bumping the version?`,
    });
    if (p.isCancel(push) || !push) cancel();
    const s = p.spinner();
    s.start(`Pushing ${branch} to origin`);
    await $({ cwd: repoRoot })`git push origin ${branch}`;
    s.stop(`Pushed ${branch}`);
  }

  return true;
}

function cancel(): never {
  p.cancel("Release cancelled.");
  process.exit(0);
}
