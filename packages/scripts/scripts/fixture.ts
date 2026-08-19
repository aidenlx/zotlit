#!/usr/bin/env node

// Builds, re-scopes, and discards the Fixture.

import { access } from "node:fs/promises";
import { join } from "node:path";
import yargs from "yargs";
import type { Argv } from "yargs";
import { hideBin } from "yargs/helpers";

import {
  buildFixture,
  DEFAULT_SCOPE_CASE,
  DEFAULT_STRESS_ITEM_COUNT,
  discardFixture,
  getFixtureLayout,
  getFixtureRoot,
  LIBRARIES,
  PERSONAL_SELECTOR,
  SCOPE_CASES,
  selectScopeCase,
  STRESS_ITEM_COUNT_CONSTRAINT,
  UNAVAILABLE_GROUP_IDS,
} from "#fixture";
import { renderGuide } from "#fixture/guide";
import { runPairedRun } from "#fixture/paired-run";
import { createNodePairedRunPorts } from "#fixture/paired-run-node";
import {
  harvestPristineTemplate,
  PRISTINE_TEMPLATE_PATH,
} from "#fixture/pristine";
import { getWorkspaceRoot } from "#package-roots";
import {
  launchPairedZotero,
  PINNED_ZOTERO_VERSION,
  ZOTERO_APP_ENV,
} from "#paired-zotero";

const scopeCaseIds = SCOPE_CASES.map((c) => c.id).join(", ");

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const layout = getFixtureLayout(getFixtureRoot(workspaceRoot));
const companionDir = join(workspaceRoot, "apps", "zotero", "dist-dev", "addon");
const pairedRunPorts = createNodePairedRunPorts({ workspaceRoot, layout });

function pairedRunBuilder(y: Argv) {
  return y
    .positional("scope-case", {
      describe: `Scope Case to build (${scopeCaseIds})`,
      type: "string",
      default: DEFAULT_SCOPE_CASE,
    })
    .option("purge", {
      describe: "restore the exact generated Development Vault seed",
      type: "boolean",
      default: false,
    });
}

/**
 * The dev build of the plugin. `pnpm fixture` builds it first, so it is missing
 * only when this script runs on its own.
 */
async function findPluginBundle(): Promise<string | undefined> {
  const dir = join(workspaceRoot, "apps", "obsidian", "dist-dev");
  return access(join(dir, "main.js")).then(
    () => dir,
    () => undefined,
  );
}

function kilobytes(bytes: number): string {
  return `${Math.round(bytes / 1024).toLocaleString("en-US")} KB`;
}

function printPaths(): void {
  console.log(`Zotero data directory   ${layout.dataDir}`);
  console.log(`Zotero profile          ${layout.profileDir}`);
  console.log(`Obsidian vault          ${layout.vaultDir}`);
}

function printLibraries(): void {
  for (const library of LIBRARIES) {
    const selector = library.groupID ?? PERSONAL_SELECTOR;
    const membership = library.editable ? "editable" : "read-only";
    console.log(
      `  ${String(selector).padEnd(10)} libraryID ${library.libraryID}  ${membership}  ${library.name ?? "My Library"}`,
    );
  }
  console.log(`  unavailable selectors: ${UNAVAILABLE_GROUP_IDS.join(", ")}`);
}

async function build({
  scopeCase,
  stressItemCount,
}: {
  scopeCase: string;
  stressItemCount?: number;
}): Promise<void> {
  const pluginBundleDir = await findPluginBundle();
  await buildFixture(layout, { scopeCase, stressItemCount, pluginBundleDir });
  console.log(
    stressItemCount === undefined
      ? `Built the Fixture at ${layout.root}`
      : `Built a Stress Build with ${stressItemCount.toLocaleString("en-US")} synthetic Items at ${layout.root}`,
  );
  printPaths();
  console.log("Libraries:");
  printLibraries();
  console.log(`Saved Library Scope: ${scopeCase}`);
  console.log(
    pluginBundleDir
      ? "Installed ZotLit in the vault and enabled it."
      : "No plugin bundle found, so the vault has ZotLit neither installed nor enabled. Run 'pnpm fixture' from the workspace root to build it first.",
  );
}

const cli = yargs(hideBin(process.argv))
  .scriptName("fixture.ts")
  .command(
    ["build [scope-case]", "$0"],
    "rebuild the Fixture from the Fixture Spec",
    (y) =>
      y.positional("scope-case", {
        describe: `Scope Case to build (${scopeCaseIds})`,
        type: "string",
        default: DEFAULT_SCOPE_CASE,
      }),
    async (argv) => {
      await build({ scopeCase: argv["scope-case"] });
    },
  )
  .command(
    "open [scope-case]",
    "prepare and open a finite Paired Run",
    pairedRunBuilder,
    async (argv) => {
      await runPairedRun(
        {
          mode: "open",
          scopeCase: argv["scope-case"],
          purge: argv.purge,
        },
        pairedRunPorts,
      );
    },
  )
  .command(
    "dev [scope-case]",
    "prepare and supervise a live Paired Run",
    pairedRunBuilder,
    async (argv) => {
      await runPairedRun(
        {
          mode: "dev",
          scopeCase: argv["scope-case"],
          purge: argv.purge,
        },
        pairedRunPorts,
      );
    },
  )
  .command(
    "stress [item-count]",
    "rebuild with an additive synthetic corpus",
    (y) =>
      y.positional("item-count", {
        describe: `number of synthetic Items to add; must be ${STRESS_ITEM_COUNT_CONSTRAINT}`,
        type: "number",
        default: DEFAULT_STRESS_ITEM_COUNT,
      }),
    async (argv) => {
      await build({
        scopeCase: DEFAULT_SCOPE_CASE,
        stressItemCount: argv["item-count"],
      });
    },
  )
  .command(
    "select <scope-case>",
    "re-scope the built vault",
    (y) =>
      y.positional("scope-case", {
        describe: `Scope Case to select (${scopeCaseIds})`,
        type: "string",
        demandOption: true,
      }),
    async (argv) => {
      await selectScopeCase(layout, argv["scope-case"]);
      console.log(`Saved Library Scope: ${argv["scope-case"]}`);
    },
  )
  .command(
    "paths",
    "print the Fixture paths",
    () => {},
    () => {
      printPaths();
    },
  )
  .command(
    "zotero",
    `launch the Paired Zotero on the Fixture (set ${ZOTERO_APP_ENV} to run a bundle instead of the managed Zotero ${PINNED_ZOTERO_VERSION})`,
    () => {},
    async () => {
      const { appBundle, pid } = await launchPairedZotero(layout, companionDir);
      console.log(`Launched the Paired Zotero from ${appBundle} (pid ${pid})`);
      printPaths();
    },
  )
  .command(
    "harvest",
    `re-capture the pristine Zotero database template from a Zotero ${PINNED_ZOTERO_VERSION} first run`,
    () => {},
    async () => {
      const report = await harvestPristineTemplate(
        join(workspaceRoot, "tmp", "fixture-harvest"),
      );
      console.log(`Harvested from ${report.appBundle}`);
      console.log(
        `  userdata ${report.userdata} / compatibility ${report.compatibility}`,
      );
      console.log(
        `  ${kilobytes(report.bytes)} of database, ${kilobytes(report.compressedBytes)} committed`,
      );
      console.log(`Wrote ${PRISTINE_TEMPLATE_PATH}`);
    },
  )
  .command(
    "discard",
    "delete the whole Fixture",
    () => {},
    async () => {
      await discardFixture(layout);
      console.log(`Deleted ${layout.root}`);
    },
  )
  .epilogue(renderGuide())
  .demandCommand(0, 1)
  .strict()
  .version(false)
  .fail((message, error) => {
    console.error(
      `fixture: ${error instanceof Error ? error.message : (message ?? String(error))}`,
    );
    process.exitCode = 1;
    // Throwing stops yargs from invoking the command handler after a
    // validation failure (unknown argument, missing positional, and so on).
    throw error instanceof Error ? error : new Error(String(message));
  });

try {
  await cli.parseAsync();
} catch {
  // The fail handler above already reported the error and set the exit
  // code; this only stops the throw (sync or async) from surfacing as an
  // unhandled/uncaught error.
}
