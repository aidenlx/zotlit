// Transactional review and writing for documentation release availability.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prerelease, valid } from "semver";
import { $ } from "zx";

import {
  findPreviousStableTag,
  scanDocsAvailability,
} from "./docs-availability-scan.ts";
import type { DocsAvailabilityCandidate } from "./docs-availability-scan.ts";
import {
  insertNewPageAvailability,
  removeAvailability,
  setUpdatedRelease,
} from "./mdx-frontmatter.ts";

export const DOCS_AVAILABILITY_REVIEW_BATCH_SIZE = 5;
export const DOCS_AVAILABILITY_PENDING_EXIT_CODE = 1;

export interface DocsAvailabilityReviewPage extends DocsAvailabilityCandidate {
  number: number;
  label: string;
}

export interface DocsAvailabilityReviewBatch {
  pages: readonly DocsAvailabilityReviewPage[];
  initiallySelectedPaths: readonly [];
}

export interface DocsAvailabilityPlan {
  newPages: readonly string[];
  updatedPages: readonly string[];
  sectionIndexes: readonly string[];
}

export interface DocsAvailabilityReview {
  reviewBatch(
    batch: DocsAvailabilityReviewBatch,
  ): Promise<readonly string[]> | readonly string[];
  confirm(plan: DocsAvailabilityPlan): Promise<boolean> | boolean;
}

export interface DocsAvailabilityCounts {
  new: number;
  updated: number;
  declined: number;
  skipped: number;
  failed: number;
}

export interface DocsAvailabilityResult {
  status: "completed" | "cancelled" | "pending" | "failed";
  exitCode: 0 | 1;
  counts: DocsAvailabilityCounts;
  errors: readonly string[];
  baselineTag?: string;
  plan?: DocsAvailabilityPlan;
}

type DocsAvailabilityOptions =
  | {
      cwd: string;
      targetVersion: string;
      check: true;
      review?: never;
    }
  | {
      cwd: string;
      targetVersion: string;
      check?: false;
      review: DocsAvailabilityReview;
    };

interface PreparedEdit {
  path: string;
  relativePath: string;
  before: string;
  after: string;
}

export async function runDocsAvailability(
  options: DocsAvailabilityOptions,
): Promise<DocsAvailabilityResult> {
  const normalizedVersion = valid(options.targetVersion);
  if (normalizedVersion === null || prerelease(normalizedVersion) !== null) {
    return failedResult(
      `Target version must be a valid Stable Release Line: ${options.targetVersion}`,
    );
  }

  const status = (
    await $({ cwd: options.cwd })`git status --porcelain`
  ).stdout.trim();
  if (status.length > 0) {
    return failedResult(`Working tree is not clean:\n${status}`);
  }

  const baselineTag = await findPreviousStableTag(options.cwd);
  if (baselineTag === null) {
    return failedResult("No previous stable release tag found.");
  }

  const scan = await scanDocsAvailability({
    cwd: options.cwd,
    baselineTag,
    targetVersion: normalizedVersion,
  });
  const newPages = scan.candidates.filter(({ kind }) => kind === "new");
  const reviewPages = scan.candidates.filter(({ kind }) => kind !== "new");

  if (options.check) {
    const plan: DocsAvailabilityPlan = {
      newPages: newPages.map(({ path }) => path),
      updatedPages: reviewPages.map(({ path }) => path),
      sectionIndexes: scan.sectionIndexes,
    };
    const prepared = await preparePlan({
      cwd: options.cwd,
      targetVersion: normalizedVersion,
      newPages,
      updatedPages: reviewPages,
      sectionIndexes: scan.sectionIndexes,
    });
    if (prepared.errors.length > 0) {
      return failedResult(prepared.errors, baselineTag, scan.skipped);
    }
    const pending = prepared.edits.length > 0 || reviewPages.length > 0;
    return {
      status: pending ? "pending" : "completed",
      exitCode: pending ? DOCS_AVAILABILITY_PENDING_EXIT_CODE : 0,
      counts: {
        new: newPages.length,
        updated: reviewPages.length,
        declined: 0,
        skipped: scan.skipped,
        failed: 0,
      },
      errors: [],
      baselineTag,
      plan: pending ? plan : undefined,
    };
  }

  const selectedPaths = new Set<string>();
  for (
    let index = 0;
    index < reviewPages.length;
    index += DOCS_AVAILABILITY_REVIEW_BATCH_SIZE
  ) {
    const pages = reviewPages
      .slice(index, index + DOCS_AVAILABILITY_REVIEW_BATCH_SIZE)
      .map((page, pageIndex) => ({
        ...page,
        number: pageIndex + 1,
        label:
          page.kind === "moved"
            ? `${page.previousPath} → ${page.path}`
            : page.path,
      }));
    for (const path of await options.review.reviewBatch({
      pages,
      initiallySelectedPaths: [],
    })) {
      if (pages.some((page) => page.path === path)) selectedPaths.add(path);
    }
  }

  const selectedPages = reviewPages.filter(({ path }) =>
    selectedPaths.has(path),
  );
  const plan: DocsAvailabilityPlan = {
    newPages: newPages.map(({ path }) => path),
    updatedPages: selectedPages.map(({ path }) => path),
    sectionIndexes: scan.sectionIndexes,
  };
  const prepared = await preparePlan({
    cwd: options.cwd,
    targetVersion: normalizedVersion,
    newPages,
    updatedPages: selectedPages,
    sectionIndexes: scan.sectionIndexes,
  });
  if (prepared.errors.length > 0) {
    return failedResult(prepared.errors, baselineTag, scan.skipped);
  }

  if (
    reviewPages.length === 0 &&
    newPages.length === 0 &&
    scan.sectionIndexes.length === 0
  ) {
    return {
      status: "completed",
      exitCode: 0,
      counts: {
        new: 0,
        updated: 0,
        declined: 0,
        skipped: scan.skipped,
        failed: 0,
      },
      errors: [],
      baselineTag,
    };
  }

  if (!(await options.review.confirm(plan))) {
    return {
      status: "cancelled",
      exitCode: 0,
      counts: {
        new: 0,
        updated: 0,
        declined: reviewPages.length - selectedPages.length,
        skipped: scan.skipped,
        failed: 0,
      },
      errors: [],
      baselineTag,
    };
  }

  for (const edit of prepared.edits) {
    try {
      if ((await readFile(edit.path, "utf-8")) !== edit.before) {
        throw new Error("page changed after preflight validation");
      }
      await writeFile(edit.path, edit.after);
      if ((await readFile(edit.path, "utf-8")) !== edit.after) {
        throw new Error("written content did not match the validated plan");
      }
    } catch (error) {
      return failedResult(
        `${edit.relativePath}: ${errorMessage(error)}`,
        baselineTag,
        scan.skipped,
      );
    }
  }

  return {
    status: "completed",
    exitCode: 0,
    counts: {
      new: newPages.length,
      updated: selectedPages.length,
      declined: reviewPages.length - selectedPages.length,
      skipped: scan.skipped,
      failed: 0,
    },
    errors: [],
    baselineTag,
  };
}

async function preparePlan({
  cwd,
  targetVersion,
  newPages,
  updatedPages,
  sectionIndexes,
}: {
  cwd: string;
  targetVersion: string;
  newPages: readonly DocsAvailabilityCandidate[];
  updatedPages: readonly DocsAvailabilityCandidate[];
  sectionIndexes: readonly string[];
}): Promise<{ edits: PreparedEdit[]; errors: string[] }> {
  const transforms = [
    ...newPages.map(({ path }) => ({
      path,
      transform: (content: string) =>
        insertNewPageAvailability(content, targetVersion),
    })),
    ...updatedPages.map(({ path }) => ({
      path,
      transform: (content: string) => setUpdatedRelease(content, targetVersion),
    })),
    ...sectionIndexes.map((path) => ({ path, transform: removeAvailability })),
  ];
  const edits: PreparedEdit[] = [];
  const errors: string[] = [];

  for (const item of transforms) {
    try {
      const path = join(cwd, item.path);
      const before = await readFile(path, "utf-8");
      const after = item.transform(before);
      if (after === before) {
        throw new Error("planned transformation made no change");
      }
      edits.push({ path, relativePath: item.path, before, after });
    } catch (error) {
      errors.push(`${item.path}: ${errorMessage(error)}`);
    }
  }

  return { edits, errors };
}

function failedResult(
  errors: string | readonly string[],
  baselineTag?: string,
  skipped = 0,
): DocsAvailabilityResult {
  const errorList = typeof errors === "string" ? [errors] : errors;
  return {
    status: "failed",
    exitCode: 1,
    counts: {
      new: 0,
      updated: 0,
      declined: 0,
      skipped,
      failed: errorList.length,
    },
    errors: errorList,
    baselineTag,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
