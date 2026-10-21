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
 * derived sync side-effects, refreshes the lockfile, gates on
 * `pnpm verify --release`, and lands a single release commit on a release
 * branch, then pushes it, opens the PR and offers to merge it. It performs
 * **no tagging, no GitHub release** — CI (`release.yml`) verifies and cuts
 * tags/releases on merge to the line the PR targets (`main` = stable,
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
// all of next's changes to main (the promotion). `resolveBaseRef` picks that base
// and reconciles a branch that runs ahead of origin.
const baseRef = await resolveBaseRef(currentBranch);

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

await completeRelease();

async function completeRelease(): Promise<void> {
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

  s.start("Refreshing lockfile");
  await $({ cwd: workspaceRoot })`pnpm install --lockfile-only`;
  stagedPaths.add(join(workspaceRoot, "pnpm-lock.yaml"));
  s.stop("Lockfile refreshed");

  // The full gate, Obsidian guideline review included, runs before the version
  // commit exists. `release.yml` runs it again on the merged tree before it
  // publishes. See ADR 0076.
  p.log.step("Release gate (pnpm verify --release)");
  const verify = await $({
    cwd: workspaceRoot,
    nothrow: true,
    stdio: "inherit",
  })`pnpm verify --release`;
  if (verify.exitCode !== 0) {
    p.cancel("Release gate failed — fix the errors above before releasing.");
    process.exit(1);
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
  const prUrl =
    !p.isCancel(openPr) && openPr
      ? await openPR(branchName, commitMsg, prTarget)
      : undefined;

  // Pull requests run no checks (ADR 0076), so the PR is ready to merge as
  // soon as it exists. Merging starts `release.yml`.
  let merged = false;
  if (prUrl) {
    const merge = await p.confirm({
      message: `Merge the PR into ${prTarget} now? release.yml then verifies and publishes.`,
    });
    if (!p.isCancel(merge) && merge) {
      s.start("Merging");
      await $({ cwd: workspaceRoot })`gh pr merge ${prUrl} --merge`;
      // The API call leaves the local checkout and the pre-push hook alone.
      await $({
        cwd: workspaceRoot,
      })`gh api -X DELETE repos/{owner}/{repo}/git/refs/heads/${branchName}`;
      s.stop(`Merged into ${prTarget}, removed origin/${branchName}`);
      merged = true;
    }
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
      merged
        ? `Merged ${summary} into ${prTarget}. release.yml verifies the merged tree, then cuts the tag(s) and GitHub release(s).`
        : `Released ${summary} on branch ${branchName}. On merge to ${prTarget}, release.yml verifies the merged tree, then cuts the tag(s) and GitHub release(s).`,
      ...(isStableGraduation
        ? [
            "",
            `${merged ? "Now" : "After the PR merges to main,"} sync back:`,
            "  git checkout next && git pull && git merge main",
            "  pnpm release  # pick preminor to start the next beta cycle",
          ]
        : []),
    ].join("\n"),
  );
}

/** @returns the new PR's URL when `gh` created it. */
async function openPR(
  branch: string,
  title: string,
  base: string,
): Promise<string | undefined> {
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
    return prUrl || undefined;
  }
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
  return undefined;
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
 * Fetches `origin/${branch}` and resolves the ref the release branch is cut from,
 * so that branch (cut from the remote tip) carries only the version bump. Aborts
 * on behind/diverged since the base would be stale.
 *
 * A branch that is merely ahead is reconciled per branch. `main` accepts commits
 * through pull requests only — a repository ruleset restricts it to merge commits
 * and rejects direct pushes — so its unpushed commits ride along in the release PR
 * from a `HEAD` base. Other branches offer a push, which keeps the PR down to the
 * version-bump commit.
 *
 * @returns the git ref to cut the release branch from — `HEAD` for a local-only
 *   branch, or for `main` carrying unpushed commits.
 */
async function resolveBaseRef(branch: string): Promise<string> {
  const fetched = await $({
    cwd: workspaceRoot,
    nothrow: true,
  })`git fetch origin ${branch}`;
  if (fetched.exitCode !== 0) {
    p.log.warn(`No origin/${branch}: basing the release branch on local HEAD.`);
    return "HEAD";
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
  if (ahead === 0) return `origin/${branch}`;

  if (branch === "main") {
    p.log.info(
      `"${branch}" has ${ahead} commit(s) not on origin/${branch}: they ride along in the release PR.`,
    );
    return "HEAD";
  }

  const push = await p.confirm({
    message: `"${branch}" has ${ahead} commit(s) not on origin/${branch}. Push them before bumping the version?`,
  });
  if (p.isCancel(push) || !push) cancel();
  const s = p.spinner();
  s.start(`Pushing ${branch} to origin`);
  await $({ cwd: workspaceRoot })`git push origin ${branch}`;
  s.stop(`Pushed ${branch}`);

  return `origin/${branch}`;
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
