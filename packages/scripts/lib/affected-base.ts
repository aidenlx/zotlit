import { $ } from "zx";

/**
 * The merge base with the nearer of `origin/next` and `origin/main`. A hotfix
 * branch off `main` then checks its own commits, not everything `next` gained.
 */
export async function affectedBase(root: string): Promise<string | undefined> {
  let base: { sha: string; distance: number } | undefined;
  for (const line of ["origin/next", "origin/main"]) {
    const mergeBase = await $({
      cwd: root,
      nothrow: true,
      quiet: true,
    })`git merge-base HEAD ${line}`;
    if (mergeBase.exitCode !== 0) continue;
    const sha = mergeBase.stdout.trim();
    const distance = Number(
      (await $({ cwd: root, quiet: true })`git rev-list --count ${sha}..HEAD`)
        .stdout,
    );
    if (!base || distance < base.distance) base = { sha, distance };
  }
  return base?.sha;
}
