#!/usr/bin/env zx

// only for the type checker
import type {} from "zx/globals";

$.verbose = true;

// path to the primary worktree; wt itself copies gitignored files matched by
// .worktreeinclude when creating the worktree
const primary = argv._[0];

/**
 * Config flags that make `submodule update` clone from the primary worktree
 * rather than from GitHub.
 *
 * A linked worktree gets its own submodule gitdirs under
 * `.git/worktrees/<name>/modules/` and shares nothing with the primary, so
 * every worktree otherwise re-clones all three submodules over the network.
 * Rewriting each URL to the primary's own checkout makes it a local clone,
 * which costs no network at all — measured at 0.14 s against 10.2 s for the
 * same three submodules over the wire. Git hardlinks the object files where it
 * can; a shallow source is repacked instead, which for these submodules is a
 * matter of tens of KB. Unlike `--reference` the result borrows nothing, so
 * pruning or deleting the primary cannot break this worktree, and
 * `remote.origin.url` keeps the GitHub URL either way, so later fetches go
 * where they always did.
 *
 * A submodule is only redirected when the primary's checkout already sits at
 * the commit this worktree pins. The primary's own submodules are `--depth 1`
 * clones, so any other commit is simply absent there, and a local clone that
 * could not resolve the pin would fail rather than fall back to the network.
 *
 * `protocol.file.allow` is what git requires of a local-path submodule clone
 * (CVE-2022-39253), and is scoped to this one command.
 */
async function localCloneFlags(primaryPath: string): Promise<string[]> {
  const q = $({ quiet: true, nothrow: true });

  const listed =
    await q`git config --file .gitmodules --get-regexp ^submodule\..*\.path$`;
  if (listed.exitCode !== 0) return [];

  const flags: string[] = [];
  for (const line of listed.stdout.trim().split("\n").filter(Boolean)) {
    const sep = line.indexOf(" ");
    if (sep < 0) continue;
    const name = line.slice("submodule.".length, sep - ".path".length);
    const path = line.slice(sep + 1);

    const url = (
      await q`git config --file .gitmodules --get submodule.${name}.url`
    ).stdout.trim();
    const pinned = (await q`git rev-parse HEAD:${path}`).stdout.trim();
    const inPrimary = (
      await q`git -C ${`${primaryPath}/${path}`} rev-parse HEAD`
    ).stdout.trim();
    if (!url || !pinned || pinned !== inPrimary) continue;

    flags.push("-c", `url.${primaryPath}/${path}.insteadOf=${url}`);
  }

  return flags.length > 0 ? ["-c", "protocol.file.allow=always", ...flags] : [];
}

// `--no-submodules` skips checkout when the caller already has them — e.g. CI
// where actions/checkout fetches submodules itself.
if (argv.submodules !== false) {
  // `--depth` is ignored for a local clone — git says so as a warning and
  // carries on — so the network flags stay unconditional and still apply to
  // whatever the redirect above did not cover.
  const local = primary ? await localCloneFlags(primary) : [];
  await $`git ${local} submodule update --init --jobs 8 --depth 1 --single-branch`;
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
