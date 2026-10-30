// A type-aware root task reads the build of every workspace package its files
// import. turbo.json reaches those builds through the scriptless `lint:deps`
// task, and the root package.json names the packages that no other package
// imports. This test holds the task graph that turbo resolves to the package
// graph, so a new package that misses that path fails here.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getWorkspaceRoot } from "./package-roots.ts";

interface Manifest {
  readonly name: string;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

const root = await getWorkspaceRoot(import.meta.dirname);
// The root package.json depends on the apps only to wire the task graph; the
// packages are what lint reads.
const manifests: Manifest[] = (
  JSON.parse(
    execFileSync("pnpm", ["ls", "-r", "--json", "--depth", "-1"], {
      cwd: root,
      encoding: "utf8",
    }),
  ) as { path: string }[]
)
  .filter(({ path }) => path !== root)
  .map(
    ({ path }) =>
      JSON.parse(readFileSync(join(path, "package.json"), "utf8")) as Manifest,
  );
const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));

/** The tasks with a command that `turbo run <task>` schedules. */
function scheduled(task: string): Set<string> {
  const plan = JSON.parse(
    execFileSync("pnpm", ["exec", "turbo", "run", task, "--dry=json"], {
      cwd: root,
      encoding: "utf8",
    }),
  ) as { tasks: { taskId: string; command: string }[] };
  return new Set(
    plan.tasks
      .filter(({ command }) => command !== "<NONEXISTENT>")
      .map(({ taskId }) => taskId),
  );
}

/** The workspace packages that `manifest` depends on. */
function workspaceDependencies(manifest: Manifest): string[] {
  return [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
  ].flatMap((deps) =>
    Object.entries(deps ?? {})
      .filter(([, version]) => version.startsWith("workspace:"))
      .map(([name]) => name),
  );
}

/** The `<package>#build` tasks of the packages that `consumers` read, transitively. */
function buildsReadBy(consumers: readonly Manifest[]): string[] {
  const read = new Set<string>();
  const pending = consumers.flatMap(workspaceDependencies);
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (read.has(name)) continue;
    read.add(name);
    const manifest = byName.get(name);
    if (manifest) pending.push(...workspaceDependencies(manifest));
  }
  return [...read]
    .filter((name) => byName.get(name)?.scripts?.build !== undefined)
    .map((name) => `${name}#build`)
    .sort();
}

describe("turbo.json root task dependencies", () => {
  it.each([
    // oxlint is type-aware over the whole tree.
    ["//#lint:repo:deps", manifests],
    // ESLint reviews the Obsidian plugin alone.
    ["//#review:plugin:deps", [byName.get("@zotlit/obsidian")!]],
  ] as const)(
    "%s builds every workspace package its files read",
    (task, consumers) => {
      const runs = scheduled(task);
      const missing = buildsReadBy(consumers).filter(
        (build) => !runs.has(build),
      );
      expect(
        missing,
        "add the packages that no workspace package imports to the root package.json",
      ).toEqual([]);
    },
  );
});
