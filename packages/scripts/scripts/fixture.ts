#!/usr/bin/env node

// Builds, re-scopes, and discards the Fixture. See docs/fixture.md for the
// maintainer workflow.

import { access } from "node:fs/promises";
import { join } from "node:path";

import {
  buildFixture,
  DEFAULT_SCOPE_CASE,
  discardFixture,
  getFixtureLayout,
  getFixtureRoot,
  LIBRARIES,
  PERSONAL_SELECTOR,
  SCOPE_CASES,
  selectScopeCase,
  UNAVAILABLE_GROUP_IDS,
} from "#fixture";
import { getWorkspaceRoot } from "#package-roots";
import {
  launchPairedZotero,
  PINNED_ZOTERO_VERSION,
  ZOTERO_APP_ENV,
} from "#paired-zotero";

const usage = `Usage:
  fixture.ts                      build with the default scope case
  fixture.ts build [scope-case]   rebuild the fixture from the spec
  fixture.ts select <scope-case>  re-scope the built vault
  fixture.ts paths                print the fixture paths
  fixture.ts zotero               launch the Paired Zotero on the fixture
  fixture.ts discard              delete the whole fixture

Scope cases:
${SCOPE_CASES.map((c) => `  ${c.id.padEnd(12)} ${c.summary}`).join("\n")}

Environment:
  ${ZOTERO_APP_ENV}   Zotero app bundle the launcher runs instead of the managed Zotero ${PINNED_ZOTERO_VERSION}`;

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const layout = getFixtureLayout(getFixtureRoot(workspaceRoot));

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

async function main(): Promise<void> {
  // A bare run builds, so one command produces the fixture from a clean checkout.
  const [command = "build", argument] = process.argv.slice(2);

  switch (command) {
    case "build": {
      const scopeCase = argument ?? DEFAULT_SCOPE_CASE;
      const pluginBundleDir = await findPluginBundle();
      await buildFixture(layout, { scopeCase, pluginBundleDir });
      console.log(`Built the Fixture at ${layout.root}`);
      printPaths();
      console.log("Libraries:");
      printLibraries();
      console.log(`Saved Library Scope: ${scopeCase}`);
      console.log(
        pluginBundleDir
          ? "Installed ZotLit in the vault and enabled it."
          : "No plugin bundle found, so the vault has ZotLit neither installed nor enabled. Run 'pnpm fixture' from the workspace root to build it first.",
      );
      break;
    }
    case "select": {
      if (!argument) throw new Error("select needs a scope case");
      await selectScopeCase(layout, argument);
      console.log(`Saved Library Scope: ${argument}`);
      break;
    }
    case "paths":
      printPaths();
      break;
    case "zotero": {
      const { appBundle, pid } = await launchPairedZotero(layout);
      console.log(`Launched the Paired Zotero from ${appBundle} (pid ${pid})`);
      printPaths();
      break;
    }
    case "discard":
      await discardFixture(layout);
      console.log(`Deleted ${layout.root}`);
      break;
    default:
      console.error(usage);
      process.exitCode = 1;
  }
}

await main().catch((error: unknown) => {
  console.error(
    `fixture: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
