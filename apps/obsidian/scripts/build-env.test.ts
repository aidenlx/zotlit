// turbo runs `build:dev` and `dev` in strict env mode and caches `build:dev`,
// so every env var the Vite build reads must be on those tasks' `env` lists:
// an unlisted var is hidden from the task and left out of its cache key.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { getPackageRoot } from "@zotlit/scripts/package-roots";

const packageRoot = getPackageRoot(import.meta.filename);

/** Env vars that authenticate a download and leave the build output alone. */
const OUTPUT_NEUTRAL = new Set(["GITHUB_TOKEN", "GH_TOKEN"]);

/** `vite.config.ts` and the workspace modules it imports directly. */
async function buildSources(): Promise<string[]> {
  const configPath = join(packageRoot, "vite.config.ts");
  const config = await readFile(configPath, "utf8");
  const specifiers = [...config.matchAll(/from\s+"([^"]+)"/g)]
    .map(([, specifier]) => specifier!)
    .filter((s) => /^(\.\/(?!package\.json)|@zotlit\/|#)/.test(s));
  const paths = specifiers.map((s) =>
    fileURLToPath(import.meta.resolve(s, `file://${configPath}`)),
  );
  return Promise.all(
    [configPath, ...paths].map((path) => readFile(path, "utf8")),
  );
}

/**
 * Names read as `process.env.NAME`, or as `process.env[CONST]` where
 * `CONST = "NAME"` sits in one of the sources. A quoted `"process.env.X"` is a
 * `define` key, not a read.
 */
function envReads(sources: string[]): Set<string> {
  const all = sources.join("\n");
  const names = new Set<string>();
  for (const [, direct, indirect] of all.matchAll(
    /(?<!["'`])process\.env(?:\.([A-Z_][A-Z0-9_]*)|\[([A-Za-z_$][\w$]*)\])/g,
  )) {
    if (direct) names.add(direct);
    if (indirect) {
      const constant = all.match(
        new RegExp(`\\b${indirect}\\s*=\\s*"([A-Z_][A-Z0-9_]*)"`),
      );
      if (constant) names.add(constant[1]!);
    }
  }
  return names;
}

const reads = envReads(await buildSources());
const turbo = JSON.parse(
  await readFile(join(packageRoot, "turbo.json"), "utf8"),
) as { tasks: Record<string, { env?: string[] }> };

describe("turbo env lists", () => {
  it.each(["build:dev", "dev"])(
    "%s lists every env var the Vite build reads",
    (task) => {
      const listed = new Set(turbo.tasks[task]?.env);
      const missing = [...reads].filter(
        (name) => !OUTPUT_NEUTRAL.has(name) && !listed.has(name),
      );
      expect(missing).toEqual([]);
    },
  );
});
