// The Paired Run the scenario owns: a Fixture of its own, a new vault seeded
// from it, and a Paired Zotero started on it. The developer's Fixture under
// `.scratch/acceptance-fixture`, their Development Vault, and a Paired Zotero
// that `pnpm fixture open` started stay as they are.

import { join } from "node:path";

import { discardFixture, getFixtureLayout } from "@zotlit/scripts/fixture";
import type { FixtureLayout } from "@zotlit/scripts/fixture";
import { createNodePairedRunPorts } from "@zotlit/scripts/fixture/paired-run-node";

import { zoteroFetch } from "./paired-zotero.ts";
import { clearVault, e2eVaultDir, vaultScript } from "./vault-script.ts";

/** One End-to-end Run's Paired Run, torn down whole by its disposal. */
export interface PairedEnvironment extends AsyncDisposable {
  layout: FixtureLayout;
  /** The run's own vault folder, a copy of `layout.vaultDir`. */
  vaultPath: string;
  vaultId: string;
  /** `http://127.0.0.1:<port>/api/`, served by this run's Paired Zotero. */
  baseUrl: string;
  /** That Paired Zotero's remote debugging port. */
  debuggerPort: number;
}

/**
 * Build a fresh Fixture, open a new vault on it, and start a Paired Zotero with
 * its Local API open and one remembered Write Authorization seeded on both
 * sides.
 *
 * A run that stopped before its disposal leaves its Zotero, its vault
 * registration, and its folders behind, so this clears all three first. Every
 * path and the Zotero it stops belong to this worktree's End-to-end Run alone:
 * the Zotero is found by the file handle it holds on this Fixture's database.
 */
export async function openPairedEnvironment(
  workspaceRoot: string,
): Promise<PairedEnvironment> {
  const layout = getFixtureLayout(
    join(workspaceRoot, ".scratch", "e2e-paired-fixture"),
  );
  const vaultPath = e2eVaultDir(workspaceRoot, "paired-vault");
  const run = vaultScript(workspaceRoot, layout.root);
  const ports = createNodePairedRunPorts({ workspaceRoot, layout });
  const removeVault = () => clearVault(run, vaultPath);

  await ports.stopLivePairedZotero();
  await removeVault();

  await using stack = new AsyncDisposableStack();
  stack.defer(() => discardFixture(layout));
  const liveUpdatePort = await ports.allocateLiveUpdatePort();
  const zoteroHttpPort = await ports.allocateZoteroHttpPort();
  stack.defer(removeVault);
  // An unregistered path takes `create`: it rebuilds the Fixture on the ports
  // above, copies its vault here, and links ZotLit to its profile and database.
  const opened = await run([
    "open",
    vaultPath,
    "--local-api",
    `--live-update-port=${liveUpdatePort}`,
    `--zotero-http-port=${zoteroHttpPort}`,
  ]);
  const vaultId = opened.stdout.trim().split("\n").at(-1)?.trim();
  if (!vaultId) throw new Error(`no vault id for ${vaultPath}`);

  // Zotero reads `httpServer.port` at startup, from the profile built above.
  stack.defer(async () => {
    await ports.stopLivePairedZotero();
  });
  const { debuggerPort } = await ports.openPairedZotero();
  if (debuggerPort === undefined)
    throw new Error("Paired Zotero reported no debugging port");
  const baseUrl = `http://127.0.0.1:${zoteroHttpPort}/api/`;
  // `GET /api/` answers 200 "Nothing to see here." once the API is open.
  const reply = await zoteroFetch(baseUrl, "");
  if (reply.status !== 200)
    throw new Error(`Paired Zotero answered ${reply.status} at ${baseUrl}`);

  const owned = stack.move();
  return {
    layout,
    vaultPath,
    vaultId,
    baseUrl,
    debuggerPort,
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  };
}
