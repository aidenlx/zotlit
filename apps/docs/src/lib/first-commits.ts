// The day each content file was first committed, carried through renames: a
// page's publication day for its JSON-LD. Fumadocs' `lastModified` gives the
// last commit only, so this scan runs once in Node and reaches the app as the
// `__FIRST_COMMIT_DAYS__` define (`vitest.config.ts` does the same for tests).

import { execFileSync } from "node:child_process";
import type { Plugin } from "vite";

/**
 * Reads `git log` oldest first over `content/`, following each rename, so a
 * page that moved keeps the day it first appeared.
 * @returns ISO days keyed by path under `content/` (`docs/how-to/x.mdx`).
 * @throws outside a git checkout, or in a shallow one: the build needs the
 * whole history (the deploy checks out with `fetch-depth: 0`) to date its
 * pages. A shallow history ends early, so its oldest commit would stand in as
 * every older page's publication day.
 */
export function scanFirstCommitDays(
  packageRoot: string,
): Record<string, string> {
  let shallow: string;
  try {
    shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
      cwd: packageRoot,
      encoding: "utf8",
    }).trim();
  } catch (cause) {
    throw new Error(
      `Pages' first commit days need the git history of ${packageRoot}/content`,
      { cause },
    );
  }
  if (shallow === "true") {
    throw new Error(
      "Pages' first commit days need the whole git history, and this clone is shallow. Run `git fetch --unshallow`, or check out with `fetch-depth: 0`.",
    );
  }

  let log: string;
  try {
    log = execFileSync(
      "git",
      [
        "-c",
        "core.quotepath=off",
        "log",
        "--reverse",
        "--relative",
        "-M",
        "--name-status",
        "--date=format-local:%Y-%m-%d",
        "--format=commit:%ad",
        "--",
        "content",
      ],
      {
        cwd: packageRoot,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        // `format-local` prints the author day in UTC.
        env: { ...process.env, TZ: "UTC" },
      },
    );
  } catch (cause) {
    throw new Error(
      `Pages' first commit days need the git history of ${packageRoot}/content`,
      { cause },
    );
  }

  const days = new Map<string, string>();
  let day = "";
  for (const line of log.split("\n")) {
    if (line.startsWith("commit:")) {
      day = line.slice("commit:".length);
      continue;
    }
    const [status = "", from = "", to] = line.split("\t");
    if (status.startsWith("R") && to !== undefined) {
      days.set(to, days.get(from) ?? day);
      days.delete(from);
    } else if (status === "D") {
      days.delete(from);
    } else if (from && !days.has(from)) {
      days.set(from, day);
    }
  }

  return Object.fromEntries(
    [...days]
      .filter(([path]) => path.startsWith("content/"))
      .map(([path, first]) => [path.slice("content/".length), first]),
  );
}

export function firstCommitsPlugin(packageRoot: string): Plugin {
  return {
    name: "zotlit:first-commits",
    config() {
      return {
        define: {
          __FIRST_COMMIT_DAYS__: JSON.stringify(
            scanFirstCommitDays(packageRoot),
          ),
        },
      };
    },
  };
}
