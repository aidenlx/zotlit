import * as p from "@clack/prompts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  findPreviousStableTag,
  scanDocsAvailability,
} from "#docs-availability-scan";
import { getWorkspaceRoot } from "#package-roots";

/**
 * Read-only dry run of `release.ts`'s docs-availability phase (ADR 0002):
 * prints the same candidates that phase would surface for review, without
 * writing anything — for sanity-checking a docs-heavy PR before it's
 * anywhere near a real release.
 *
 * Usage: `pnpm --filter @zotlit/scripts preview-docs-availability [version]`
 * `version` only affects the "already reviewed this cycle" skip check
 * (ADR 0002); it defaults to the checked-out `apps/obsidian/package.json`
 * version, which is good enough when you haven't picked a real next version
 * yet.
 */

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);

const targetVersion = process.argv[2] ?? (await currentObsidianVersion());

const baselineTag = await findPreviousStableTag(workspaceRoot);
if (!baselineTag) {
  p.log.error("No previous stable release tag found.");
  process.exit(1);
}

p.log.info(`Baseline: ${baselineTag}  Target: ${targetVersion}`);

const candidates = await scanDocsAvailability({
  cwd: workspaceRoot,
  baselineTag,
  targetVersion,
});

if (candidates.length === 0) {
  p.log.success("No docs pages need an availability update.");
} else {
  for (const candidate of candidates) {
    const label =
      candidate.kind === "moved"
        ? `${candidate.previousPath} → ${candidate.path}`
        : candidate.path;
    p.log.step(`[${candidate.kind}] ${label}`);
    if (candidate.diff) p.log.message(candidate.diff);
  }
  p.log.info(`${candidates.length} candidate(s).`);
}

async function currentObsidianVersion(): Promise<string> {
  const pkgPath = join(workspaceRoot, "apps/obsidian/package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as {
    version: string;
  };
  return pkg.version;
}
