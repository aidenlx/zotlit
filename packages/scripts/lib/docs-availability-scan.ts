import { regex } from "arkregex";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { gte, major, minor, patch, prerelease, rcompare, valid } from "semver";
import { $ } from "zx";

import {
  getFrontmatterField,
  stripAvailabilityLines,
} from "./mdx-frontmatter.ts";

/**
 * The release-time half of ADR 0002: diffs `content/docs/**\/*.mdx` against
 * the previous Stable Release Line tag, with rename detection, and
 * classifies each touched page into a review candidate. Human review (the
 * accept/reject prompting, and the actual frontmatter writes) happens in the
 * caller — `release.ts`'s docs-availability phase, or a read-only preview.
 */

const DOCS_CONTENT_DIR = "apps/docs/content/docs";
const MAX_DIFF_LINES = 60;

export type DocsAvailabilityCandidateKind = "new" | "moved" | "changed";

export interface DocsAvailabilityCandidate {
  kind: DocsAvailabilityCandidateKind;
  /** Path relative to the workspace root. */
  path: string;
  /** Set only for `moved`: the path this page had at the baseline tag. */
  previousPath?: string;
  /** Unified diff against the baseline tag — empty for `new` (nothing to compare). */
  diff: string;
}

const STATUS_LINE = regex("^(?<status>[AMD])\t(?<path>.+)$");
const RENAME_LINE = regex(
  "^R(?<similarity>\\d+)\t(?<oldPath>[^\t]+)\t(?<newPath>.+)$",
);

function stableReleaseLine(version: string): string {
  return `${major(version)}.${minor(version)}.${patch(version)}`;
}

function isDocsPage(path: string): boolean {
  return path.endsWith(".mdx") && !basename(path).startsWith("_");
}

/** Highest valid, non-prerelease git tag in the repo — the previous Stable Release Line. */
export async function findPreviousStableTag(
  cwd: string,
): Promise<string | null> {
  const { stdout } = await $({ cwd })`git tag --list`;
  const tags = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((tag) => valid(tag) !== null && prerelease(tag) === null);
  if (tags.length === 0) return null;
  return tags.sort(rcompare)[0] ?? null;
}

async function readBlobAtTag(
  cwd: string,
  tag: string,
  path: string,
): Promise<string> {
  const { stdout } = await $({ cwd })`git show ${`${tag}:${path}`}`;
  return stdout;
}

/**
 * Whether a touched page is worth surfacing for review: its content must
 * differ from the baseline once `introduced`/`updated` are ignored (those
 * two lines are `release.ts`'s own output — their mere presence/absence
 * must never count as a change, or this would flag every page the moment
 * this feature first ships, since none of them carried these fields at the
 * previous stable tag), and it must not already have been reviewed earlier
 * in this same release cycle (`updated`'s Stable Release Line already at or
 * ahead of `targetLine` — the baseline tag stays fixed at the previous
 * *stable* tag across an entire beta series per ADR 0002, so re-diffing
 * against it would otherwise re-surface an already-handled page on every
 * subsequent beta bump).
 */
async function shouldReview(
  cwd: string,
  {
    baselineTag,
    baselinePath,
    currentPath,
    targetLine,
  }: {
    baselineTag: string;
    baselinePath: string;
    currentPath: string;
    targetLine: string;
  },
): Promise<boolean> {
  const [before, after] = await Promise.all([
    readBlobAtTag(cwd, baselineTag, baselinePath),
    readFile(join(cwd, currentPath), "utf-8"),
  ]);
  if (stripAvailabilityLines(before) === stripAvailabilityLines(after)) {
    return false;
  }
  const updated = getFrontmatterField(after, "updated");
  return updated === undefined || !gte(stableReleaseLine(updated), targetLine);
}

async function diffPage(
  cwd: string,
  baselineTag: string,
  path: string,
): Promise<string> {
  const { stdout } = await $({
    cwd,
  })`git diff -M ${baselineTag} HEAD -- ${path}`;
  const lines = stdout.split("\n");
  if (lines.length <= MAX_DIFF_LINES) return stdout;
  const hidden = lines.length - MAX_DIFF_LINES;
  return `${lines.slice(0, MAX_DIFF_LINES).join("\n")}\n… ${hidden} more lines — see \`git diff ${baselineTag} HEAD -- ${path}\``;
}

/**
 * Diff `content/docs/**\/*.mdx` between `baselineTag` and `HEAD`, classify
 * each touched page, and skip pages already reviewed within this release
 * cycle.
 */
export async function scanDocsAvailability({
  cwd,
  baselineTag,
  targetVersion,
}: {
  cwd: string;
  baselineTag: string;
  targetVersion: string;
}): Promise<DocsAvailabilityCandidate[]> {
  const { stdout } = await $({
    cwd,
  })`git diff -M --name-status ${baselineTag} HEAD -- ${DOCS_CONTENT_DIR}`;

  const targetLine = stableReleaseLine(targetVersion);
  const candidates: DocsAvailabilityCandidate[] = [];

  for (const line of stdout.split("\n").filter(Boolean)) {
    const rename = RENAME_LINE.exec(line);
    if (rename) {
      const { similarity, oldPath, newPath } = rename.groups;
      if (!isDocsPage(newPath)) continue;
      // 100% similarity: a pure move, content unchanged. `introduced`/
      // `updated` moved with the file's frontmatter — nothing to review.
      if (Number(similarity) >= 100) continue;
      const review = await shouldReview(cwd, {
        baselineTag,
        baselinePath: oldPath,
        currentPath: newPath,
        targetLine,
      });
      if (!review) continue;
      candidates.push({
        kind: "moved",
        path: newPath,
        previousPath: oldPath,
        diff: await diffPage(cwd, baselineTag, newPath),
      });
      continue;
    }

    const status = STATUS_LINE.exec(line);
    if (!status) continue;
    const { path } = status.groups;
    if (!isDocsPage(path)) continue;

    if (status.groups.status === "A") {
      candidates.push({ kind: "new", path, diff: "" });
    } else if (status.groups.status === "M") {
      const review = await shouldReview(cwd, {
        baselineTag,
        baselinePath: path,
        currentPath: path,
        targetLine,
      });
      if (!review) continue;
      candidates.push({
        kind: "changed",
        path,
        diff: await diffPage(cwd, baselineTag, path),
      });
    }
    // "D" (a removed page) carries no frontmatter to assign — out of scope.
  }

  return candidates;
}
