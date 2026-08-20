#!/usr/bin/env node

// Reviews committed documentation changes and applies release availability.

import type {
  DocsAvailabilityPlan,
  DocsAvailabilityReview,
} from "#docs-availability";
import * as p from "@clack/prompts";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  DOCS_AVAILABILITY_PENDING_EXIT_CODE,
  DOCS_AVAILABILITY_REVIEW_BATCH_SIZE,
  runDocsAvailability,
} from "#docs-availability";
import { getWorkspaceRoot } from "#package-roots";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);

class CancelledReview extends Error {}

class TerminalReview implements DocsAvailabilityReview {
  appliedPlan: DocsAvailabilityPlan | null = null;

  async reviewBatch({
    pages,
    initiallySelectedPaths,
  }: Parameters<DocsAvailabilityReview["reviewBatch"]>[0]): Promise<
    readonly string[]
  > {
    for (const page of pages) {
      p.log.step(`${page.number}. ${page.label}`);
      p.log.message(page.diff);
    }
    const selected = await p.multiselect({
      message: "Which pages changed materially?",
      options: pages.map((page) => ({
        value: page.path,
        label: `${page.number}. ${page.label}`,
      })),
      initialValues: [...initiallySelectedPaths],
      required: false,
    });
    if (p.isCancel(selected)) throw new CancelledReview();
    return selected;
  }

  async confirm(plan: DocsAvailabilityPlan): Promise<boolean> {
    this.appliedPlan = plan;
    p.note(renderPlan(plan), "Availability plan");
    const confirmed = await p.confirm({ message: "Apply this complete plan?" });
    if (p.isCancel(confirmed)) throw new CancelledReview();
    return confirmed;
  }
}

await yargs(hideBin(process.argv))
  .scriptName("docs:availability")
  .command(
    "$0 <stable-version>",
    "review committed docs availability for a Stable Release Line",
    (command) =>
      command
        .positional("stable-version", {
          describe: "Stable Release Line to write, such as 2.1.0",
          type: "string",
          demandOption: true,
        })
        .option("check", {
          describe: "report pending work without prompts or file writes",
          type: "boolean",
          default: false,
        }),
    async (argv) => {
      p.intro(`Docs availability ${argv["stable-version"]}`);
      const review = new TerminalReview();
      try {
        const result = argv.check
          ? await runDocsAvailability({
              cwd: workspaceRoot,
              targetVersion: argv["stable-version"],
              check: true,
            })
          : await runDocsAvailability({
              cwd: workspaceRoot,
              targetVersion: argv["stable-version"],
              review,
            });

        for (const error of result.errors) p.log.error(error);
        p.log.info(renderCounts(result.counts));
        process.exitCode = result.exitCode;

        if (result.status === "pending") {
          if (result.plan !== undefined) {
            p.note(renderPlan(result.plan), "Pending availability");
          }
          p.outro(
            `Availability work is pending for ${argv["stable-version"]}. Run without --check to review it.`,
          );
        } else if (result.status === "cancelled") {
          p.outro("Availability plan cancelled. No files changed.");
        } else if (result.status === "failed") {
          p.outro(
            "Docs availability failed. Review the reported file and working tree.",
          );
        } else if (argv.check) {
          p.outro("No docs pages need an availability update.");
        } else if (
          review.appliedPlan !== null &&
          planHasEdits(review.appliedPlan)
        ) {
          p.outro(
            [
              "Docs availability updated.",
              "Review and commit the edits.",
              "Then rerun pnpm release.",
            ].join("\n"),
          );
        } else if (review.appliedPlan !== null) {
          p.outro("Review complete. No files changed. Rerun pnpm release.");
        } else {
          p.outro("No docs pages need an availability update.");
        }
      } catch (error) {
        if (error instanceof CancelledReview) {
          p.cancel("Docs availability cancelled. No files changed.");
          return;
        }
        throw error;
      }
    },
  )
  .strict()
  .version(false)
  .epilogue(renderGuide())
  .help()
  .parseAsync();

function renderPlan(plan: DocsAvailabilityPlan): string {
  const sections = [
    ["New", plan.newPages],
    ["Updated", plan.updatedPages],
    ["Section Index cleanup", plan.sectionIndexes],
  ] as const;
  return sections
    .map(([label, paths]) =>
      paths.length === 0
        ? `${label}: 0`
        : `${label}: ${paths.length}\n${paths.map((path) => `  ${path}`).join("\n")}`,
    )
    .join("\n");
}

function planHasEdits(plan: DocsAvailabilityPlan): boolean {
  return (
    plan.newPages.length > 0 ||
    plan.updatedPages.length > 0 ||
    plan.sectionIndexes.length > 0
  );
}

function renderGuide(): string {
  return [
    "Contract:",
    "  stable-version must be a non-prerelease semantic version.",
    "  The working tree must be clean. The scan compares the highest stable tag with HEAD.",
    `  Changed and moved pages appear in batches of at most ${DOCS_AVAILABILITY_REVIEW_BATCH_SIZE}, with no default selections.`,
    "  The command validates the full plan, asks once, and then writes all planned page edits.",
    `  --check writes nothing and exits ${DOCS_AVAILABILITY_PENDING_EXIT_CODE} when availability work is pending.`,
  ].join("\n");
}

function renderCounts({
  new: newCount,
  updated,
  declined,
  skipped,
  failed,
}: {
  new: number;
  updated: number;
  declined: number;
  skipped: number;
  failed: number;
}): string {
  return `New: ${newCount}; updated: ${updated}; declined: ${declined}; skipped: ${skipped}; failed: ${failed}.`;
}
