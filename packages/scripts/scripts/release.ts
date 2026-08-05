import * as p from "@clack/prompts";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inc, prerelease, valid } from "semver";
import { $ } from "zx";

import { parseManifest as parseObsidianManifest } from "#obsidian-manifest";
import { getWorkspaceRoot } from "#package-roots";

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
 * The release line is inferred from the **version** picked, not the branch:
 * a non-prerelease version targets `main` (stable graduation), a prerelease
 * targets `next`. Primary development happens on `next`; `main` receives
 * stable graduations and emergency hotfixes (patch-only).
 *
 * @see CONTRIBUTING.md "Branching model"
 * @see docs/adr/0021-next-is-the-primary-branch.md
 */

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);

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
    pkgPath: join(workspaceRoot, "apps/obsidian/package.json"),
  },
  zotero: {
    name: "zotero",
    display: "@zotlit/zotero",
    pkgPath: join(workspaceRoot, "apps/zotero/package.json"),
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
  await $({ cwd: workspaceRoot })`git rev-parse --abbrev-ref HEAD`
).stdout.trim();

if (currentBranch !== "main" && currentBranch !== "next") {
  p.log.warn(
    `Releasing from "${currentBranch}" (not main/next): the PR base will target this branch.`,
  );
}

// Sync the current branch with origin before bumping. For pre-releases and
// hotfixes, basing the release branch on `origin/${currentBranch}` keeps only the
// version-bump commit in the PR. For stable graduations from next, the PR carries
// all of next's changes to main (the promotion). Pushing first avoids dragging
// unpushed commits into the release branch. `HEAD` for a local-only branch.
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

// Determine the PR target. On `next`, the version picked decides the target:
// non-prerelease → stable graduation targeting `main`; prerelease → stays on
// `next`. On `main` (hotfix path) and other branches, the target is the branch
// itself.
let prTarget: string;
const hasStable = bumps.some((b) => prerelease(b.next) === null);
const hasPre = bumps.some((b) => prerelease(b.next) !== null);
const isStableGraduation = currentBranch === "next" && hasStable && !hasPre;

if (currentBranch === "next") {
  if (hasStable && hasPre) {
    p.cancel(
      "Cannot mix stable and pre-release versions from next — all apps must graduate together or all must stay on pre-release.",
    );
    process.exit(1);
  }

  if (isStableGraduation) {
    if (bumps.length < Object.keys(APPS).length) {
      p.cancel(
        "Stable releases from next must include all apps — select Both.",
      );
      process.exit(1);
    }
    await assertMainAncestry();
    prTarget = "main";
  } else {
    prTarget = "next";
  }
} else {
  prTarget = currentBranch;
}

const summary = bumps.map((b) => `${b.app.name}@${b.next}`).join(", ");
const confirmMsg = isStableGraduation
  ? `Stable release ${summary} (PR targets main). Proceed?`
  : `Release ${summary}?`;
const confirmed = await p.confirm({ message: confirmMsg });
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
await syncTestVaultPrevVersion(bumps, stagedPaths);

s.start("Refreshing lockfile");
await $({ cwd: workspaceRoot })`pnpm install --lockfile-only`;
stagedPaths.add(join(workspaceRoot, "pnpm-lock.yaml"));
s.stop("Lockfile refreshed");

s.start("Quality check");
const quality = await $({ cwd: workspaceRoot, nothrow: true })`pnpm quality`;
if (quality.exitCode !== 0) {
  s.stop("Quality check failed", 1);
  p.cancel(
    `Quality check failed — fix lint/format errors before releasing:\n${quality.stdout}${quality.stderr}`,
  );
  process.exit(1);
}
s.stop("Quality passed");

// Obsidian's community review rejects guideline violations, so the plugin is
// scanned here rather than after merge — `release.yml` only runs once the
// version commit has already landed. oxlint (in `pnpm quality` above) owns
// general hygiene; this is the Obsidian-specific pass. See ADR 0020.
if (bumps.some((b) => b.app.name === "obsidian")) {
  s.start("Plugin review");
  const review = await $({ cwd: workspaceRoot, nothrow: true })`pnpm review`;
  if (review.exitCode !== 0) {
    s.stop("Plugin review failed", 1);
    p.cancel(
      `Obsidian guideline violations — fix these before releasing:\n${review.stdout}${review.stderr}`,
    );
    process.exit(1);
  }
  s.stop("Plugin review passed");
}

const branchName = `release/${prTarget}/${bumps.map((b) => `${b.app.name}-${b.next}`).join("+")}`;
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
await $({ cwd: workspaceRoot })`git checkout -b ${branchName} ${baseRef}`;
s.stop(`On branch ${branchName}`);

s.start("Committing");
await $({ cwd: workspaceRoot })`git add ${[...stagedPaths]}`;
await $({ cwd: workspaceRoot })`git commit -m ${commitMsg}`;
s.stop("Committed");

s.start("Pushing");
await $({ cwd: workspaceRoot })`git push -u origin ${branchName}`;
s.stop("Pushed");

const openPr = await p.confirm({ message: `Open a PR to ${prTarget}?` });
if (!p.isCancel(openPr) && openPr) {
  await openPR(branchName, commitMsg, prTarget);
}

// The release branch now lives on origin (the PR references it); drop the local
// copy and return to the working branch. `-D` because its release commit is not
// merged into `${currentBranch}` locally.
s.start(`Returning to ${currentBranch}`);
await $({ cwd: workspaceRoot })`git checkout ${currentBranch}`;
await $({ cwd: workspaceRoot })`git branch -D ${branchName}`;
s.stop(`Back on ${currentBranch}, removed local ${branchName}`);

p.outro(
  [
    `Released ${summary} on branch ${branchName}.`,
    `On merge to ${prTarget}, release.yml cuts the tag(s) and GitHub release(s).`,
  ].join("\n"),
);

async function openPR(
  branch: string,
  title: string,
  base: string,
): Promise<void> {
  const hasGh = await $({
    cwd: workspaceRoot,
    nothrow: true,
  })`gh --version`.then((r) => r.exitCode === 0);

  if (hasGh) {
    const s = p.spinner();
    s.start("Creating PR via gh");
    // `gh pr create` prints the new PR's URL to stdout.
    const created = await $({
      cwd: workspaceRoot,
    })`gh pr create --title ${title} --body "" --head ${branch} --base ${base}`;
    s.stop("PR created");
    const prUrl = created.stdout.trim();
    if (prUrl) p.log.info(`PR: ${prUrl}`);
  } else {
    const rootPkg = JSON.parse(
      await readFile(join(workspaceRoot, "package.json"), "utf-8"),
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
 * Options are filtered by context: on `main`, only `patch` and `custom` are
 * shown (hotfix path). On `next` with a prerelease current version, `patch`
 * and `prepatch` are hidden (they produce nonsensical versions from a
 * prerelease base). `custom` is always available as an escape hatch.
 *
 * @returns the chosen version, or `null` if cancelled.
 */
async function pickVersion(
  app: AppMeta,
  current: string,
): Promise<string | null> {
  const preid = prerelease(current)?.[0]?.toString() ?? "beta";
  const currentIsPrerelease = prerelease(current) !== null;

  type BumpKind =
    | "patch"
    | "minor"
    | "major"
    | "prepatch"
    | "preminor"
    | "premajor"
    | "prerelease"
    | "custom";

  const allOptions: { value: BumpKind; label: string }[] = [
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
  ];

  const hidden = new Set<BumpKind>(
    currentBranch === "main"
      ? // Hotfix path: patch + custom only.
        ["minor", "major", "prepatch", "preminor", "premajor", "prerelease"]
      : currentIsPrerelease
        ? // On next with prerelease: patch/prepatch produce nonsensical versions.
          ["patch", "prepatch"]
        : [],
  );
  const options = allOptions.filter((o) => !hidden.has(o.value));

  while (true) {
    const kind = await p.select({
      message: `New version for ${app.display} (current ${current})`,
      options,
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
  const manifestPath = join(workspaceRoot, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  staged.add(manifestPath);

  const versionsPath = join(workspaceRoot, "versions.json");
  const versions = JSON.parse(await readFile(versionsPath, "utf-8")) as Record<
    string,
    string
  >;
  versions[manifest.version] = manifest.minAppVersion;
  await writeFile(versionsPath, `${JSON.stringify(versions, null, 2)}\n`);
  staged.add(versionsPath);
}

/**
 * Test-vault fixture sync: bumps `release.previous-version` in the manual test
 * vault's plugin data so a fresh launch there exercises the update-notice path
 * against the version being released from. Skipped when the fixture is absent
 * (e.g. a fresh checkout without the test vault populated) — the read itself
 * is the existence check, not a preceding stat.
 */
async function syncTestVaultPrevVersion(
  releases: Bump[],
  staged: Set<string>,
): Promise<void> {
  const obsidian = releases.find((b) => b.app.name === "obsidian");
  if (!obsidian) return;

  const dataPath = join(
    workspaceRoot,
    "tests/zt-vault/.obsidian/plugins/zotlit/data.json",
  );

  let raw: string;
  try {
    raw = await readFile(dataPath, "utf-8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) return;
    throw error;
  }

  const data = JSON.parse(raw) as Record<string, unknown>;
  data["release.previous-version"] = obsidian.next;
  await writeFile(dataPath, JSON.stringify(data, null, 2));
  staged.add(dataPath);
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
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
    await $({ cwd: workspaceRoot })`git status --porcelain`
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
    cwd: workspaceRoot,
    nothrow: true,
  })`git fetch origin ${branch}`;
  if (fetched.exitCode !== 0) {
    p.log.warn(`No origin/${branch}: basing the release branch on local HEAD.`);
    return false;
  }

  const counts = (
    await $({
      cwd: workspaceRoot,
    })`git rev-list --left-right --count origin/${branch}...HEAD`
  ).stdout.trim();
  const [behind, ahead] = counts.split(/\s+/).map(Number) as [number, number];

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
    await $({ cwd: workspaceRoot })`git push origin ${branch}`;
    s.stop(`Pushed ${branch}`);
  }

  return true;
}

/**
 * Guards against regressing a hotfix that landed directly on `main`: aborts if
 * `origin/main` is not an ancestor of the current `HEAD`.
 */
async function assertMainAncestry(): Promise<void> {
  await $({ cwd: workspaceRoot, nothrow: true })`git fetch origin main`;

  const result = await $({
    cwd: workspaceRoot,
    nothrow: true,
  })`git merge-base --is-ancestor origin/main HEAD`;

  if (result.exitCode !== 0) {
    p.cancel(
      "main has commits not on next — merge main into next before graduating to stable.",
    );
    process.exit(1);
  }
}

function cancel(): never {
  p.cancel("Release cancelled.");
  process.exit(0);
}
