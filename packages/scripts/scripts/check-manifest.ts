#!/usr/bin/env node
// Runs the community directory's `obsidianmd/validate-manifest` rule over the
// manifest that `parseManifest` derives from apps/obsidian/package.json. The
// root manifest.json only refreshes on a stable release, after the release
// gate, so this check reads the source the next release ships from.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseManifest } from "#obsidian-manifest";
import { getWorkspaceRoot } from "#package-roots";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const pkg = JSON.parse(
  await readFile(join(workspaceRoot, "apps/obsidian/package.json"), "utf8"),
);
const manifest = `${JSON.stringify(parseManifest(pkg), null, 2)}\n`;

try {
  // eslint.config.js applies the rule to `manifest.json`; `--quiet` keeps the
  // scanner's warn-level rules from running on the JSON.
  execFileSync(
    "pnpm",
    [
      "exec",
      "eslint",
      "--quiet",
      "--stdin",
      "--stdin-filename",
      "manifest.json",
    ],
    {
      cwd: workspaceRoot,
      input: manifest,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
} catch {
  console.error(
    "The manifest generated from apps/obsidian/package.json fails the Obsidian manifest rules above.",
  );
  process.exit(1);
}
