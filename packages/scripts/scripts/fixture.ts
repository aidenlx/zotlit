#!/usr/bin/env node

// Builds, re-scopes, stops, and discards the Fixture.

import { access } from "node:fs/promises";
import { join } from "node:path";
import yargs from "yargs";
import type { Argv } from "yargs";
import { hideBin } from "yargs/helpers";

import {
  DOCS_DEV_SERVER_ORIGIN,
  localBridgeOrigin,
} from "@zotlit/workbench/bridge";

import { DEV_VAULT_CASE_ENV } from "#dev-vault";
import {
  buildFixture,
  DEFAULT_SCOPE_CASE,
  DEFAULT_STRESS_ITEM_COUNT,
  DEFAULT_VAULT_CASE,
  discardFixture,
  getFixtureLayout,
  getFixtureRoot,
  LIBRARIES,
  PERSONAL_SELECTOR,
  SCOPE_CASES,
  selectScopeCase,
  STRESS_ITEM_COUNT_CONSTRAINT,
  UNAVAILABLE_GROUP_IDS,
  VAULT_CASES,
  writePairedRunState,
} from "#fixture";
import { renderGuide } from "#fixture/guide";
import { startMockLocalBridge } from "#fixture/local-bridge-server";
import { runPairedRun } from "#fixture/paired-run";
import {
  createNodePairedRunPorts,
  describeLive,
} from "#fixture/paired-run-node";
import {
  harvestPristineTemplate,
  PRISTINE_STYLES_PATH,
  PRISTINE_TEMPLATE_PATH,
} from "#fixture/pristine";
import { regenerateFixtureSampleItems } from "#fixture/sample-items";
import { getWorkspaceRoot } from "#package-roots";
import {
  installBetterBibtex,
  launchPairedZotero,
  PINNED_ZOTERO_VERSION,
  ZOTERO_APP_ENV,
} from "#paired-zotero";

const scopeCaseIds = SCOPE_CASES.map((c) => c.id).join(", ");
const vaultCaseIds = VAULT_CASES.map((c) => c.id).join(", ");

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const layout = getFixtureLayout(getFixtureRoot(workspaceRoot));
const companionDir = join(workspaceRoot, "apps", "zotero", "dist-dev", "addon");
const pairedRunPorts = createNodePairedRunPorts({ workspaceRoot, layout });

const localApiOption = {
  describe:
    "open Zotero's Local API in the Fixture profile, on a free Zotero HTTP port the profile carries",
  type: "boolean",
  default: false,
} as const;

const grantLocalApiWritesOption = {
  describe:
    "seed a remembered Local API write grant for the Development Vault; use --no-grant-local-api-writes to test authorization",
  type: "boolean",
  default: true,
} as const;

function pairedRunBuilder(y: Argv) {
  return y
    .positional("scope-case", {
      describe: `Scope Case to build (${scopeCaseIds})`,
      type: "string",
      default: DEFAULT_SCOPE_CASE,
    })
    .option("vault-case", {
      describe: `Vault Case to build (${vaultCaseIds}); each case other than the default opens its own Development Vault (default: $${DEV_VAULT_CASE_ENV})`,
      type: "string",
      choices: VAULT_CASES.map(({ id }) => id),
      default: process.env[DEV_VAULT_CASE_ENV],
    })
    .option("purge", {
      describe:
        "restore the exact generated Development Vault seed, and clear the plugin's vault-scoped local storage and stored excerpt images",
      type: "boolean",
      default: false,
    })
    .option("local-api", localApiOption)
    .option("grant-local-api-writes", grantLocalApiWritesOption);
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
  vaultCase = DEFAULT_VAULT_CASE,
  stressItemCount,
  localApi = false,
}: {
  scopeCase: string;
  vaultCase?: string;
  stressItemCount?: number;
  localApi?: boolean;
}): Promise<void> {
  const pluginBundleDir = await findPluginBundle();
  // The Local API needs one port both sides name, and the shipped 23119 belongs
  // to whatever Zotero the machine already runs. The profile carries this one,
  // so Paired Zotero serves on it and ZotLit reads it back from the same file.
  const zoteroHttpPort = localApi
    ? await pairedRunPorts.allocateZoteroHttpPort()
    : undefined;
  await buildFixture(layout, {
    scopeCase,
    vaultCase,
    stressItemCount,
    pluginBundleDir,
    zoteroHttpPort,
    localApi,
  });
  await installBetterBibtex(layout.profileDir);
  console.log(
    stressItemCount === undefined
      ? `Built the Fixture at ${layout.root}`
      : `Built a Stress Build with ${stressItemCount.toLocaleString("en-US")} synthetic Items at ${layout.root}`,
  );
  printPaths();
  console.log("Libraries:");
  printLibraries();
  console.log(`Saved Library Scope: ${scopeCase}`);
  console.log(`Vault Case: ${vaultCase}`);
  console.log("Installed pinned Better BibTeX in the Zotero profile.");
  if (zoteroHttpPort !== undefined) {
    console.log(
      `Opened Zotero's Local API at http://127.0.0.1:${zoteroHttpPort}/api/`,
    );
  }
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
      y
        .positional("scope-case", {
          describe: `Scope Case to build (${scopeCaseIds})`,
          type: "string",
          default: DEFAULT_SCOPE_CASE,
        })
        .option("vault-case", {
          describe: `Vault Case to build (${vaultCaseIds})`,
          type: "string",
          choices: VAULT_CASES.map(({ id }) => id),
          default: DEFAULT_VAULT_CASE,
        })
        .option("local-api", localApiOption),
    async (argv) => {
      await build({
        scopeCase: argv["scope-case"],
        vaultCase: argv["vault-case"],
        localApi: argv["local-api"],
      });
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
          vaultCase: argv["vault-case"],
          purge: argv.purge,
          localApi: argv["local-api"],
          grantLocalApiWrites: argv["grant-local-api-writes"],
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
          vaultCase: argv["vault-case"],
          purge: argv.purge,
          localApi: argv["local-api"],
          grantLocalApiWrites: argv["grant-local-api-writes"],
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
    `launch the Paired Zotero on the Fixture (set ${ZOTERO_APP_ENV} to run an application folder instead of the managed Zotero ${PINNED_ZOTERO_VERSION})`,
    () => {},
    async () => {
      const { applicationDir, pid } = await launchPairedZotero(
        layout,
        companionDir,
      );
      // This instance holds `zotero.sqlite` exactly as a Paired Run's does, so
      // it is reported the same way — anything that would rebuild the Fixture
      // has to see it. It carries no debugging port, and the report says so.
      await writePairedRunState(layout, { pid });
      console.log(
        `Launched the Paired Zotero from ${applicationDir} (pid ${pid})`,
      );
      printPaths();
    },
  )
  .command(
    "harvest",
    `re-capture the pristine Zotero database template and CSL styles from a Zotero ${PINNED_ZOTERO_VERSION} first run`,
    () => {},
    async () => {
      const report = await harvestPristineTemplate(
        join(workspaceRoot, ".scratch", "fixture-harvest"),
      );
      console.log(`Harvested from ${report.applicationDir}`);
      console.log(
        `  userdata ${report.userdata} / compatibility ${report.compatibility}`,
      );
      console.log(
        `  ${kilobytes(report.bytes)} of database, ${kilobytes(report.compressedBytes)} committed`,
      );
      console.log(
        `  ${report.styles} CSL styles, ${kilobytes(report.stylesCompressedBytes)} committed`,
      );
      console.log(`Wrote ${PRISTINE_TEMPLATE_PATH}`);
      console.log(`Wrote ${PRISTINE_STYLES_PATH}`);
    },
  )
  .command(
    "samples",
    "regenerate the web Workbench Sample Items",
    () => {},
    async () => {
      const generated = await regenerateFixtureSampleItems(workspaceRoot);
      console.log(
        `Regenerated ${generated.length} Sample Items in packages/workbench/src/samples.`,
      );
    },
  )
  .command(
    "bridge",
    "build and serve the mock Local Bridge on loopback",
    (y) =>
      y
        .option("port", {
          describe: "loopback port",
          type: "number",
          default: 23_120,
        })
        .option("origin", {
          describe: "approved Workbench Origin",
          type: "string",
          default: DOCS_DEV_SERVER_ORIGIN,
        })
        .option("conflict-next-save", {
          describe: "make the next Profile save observe an external revision",
          type: "boolean",
          default: false,
        }),
    async (argv) => {
      const pluginBundleDir = await findPluginBundle();
      await buildFixture(layout, { pluginBundleDir });
      const bridge = startMockLocalBridge({
        layout,
        allowedOrigin: argv.origin,
        port: argv.port,
        conflictNextSave: argv["conflict-next-save"],
      });
      console.log(
        `Mock Local Bridge listening at ${localBridgeOrigin(argv.port)} for ${argv.origin}`,
      );
      console.log(`One-time code: ${bridge.initialOneTimeCode}`);
    },
  )
  .command(
    "stop",
    "close the Paired Zotero that holds this Fixture, and wait until it releases the database",
    () => {},
    async () => {
      const closed = await pairedRunPorts.stopLivePairedZotero();
      console.log(
        closed.length === 0
          ? "No Paired Zotero holds this Fixture."
          : `Closed the Paired Zotero: ${describeLive(closed)}`,
      );
    },
  )
  .command(
    "discard",
    "close the Paired Zotero that holds this Fixture, then delete the whole Fixture",
    () => {},
    async () => {
      // Deleting the root under a live Zotero leaves it running on a profile
      // that no longer exists, where no later stop can find it.
      await pairedRunPorts.stopLivePairedZotero();
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
