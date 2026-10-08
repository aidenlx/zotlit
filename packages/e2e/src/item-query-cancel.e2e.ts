// Cancels a running Item Query through the two production commands, on a
// Stress Build large enough that an export of every Item is still running when
// a second CLI call arrives. The suite builds its own Fixture and vault, like
// every e2e file, and removes both at its end.

import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildFixture,
  discardFixture,
  getFixtureLayout,
} from "@zotlit/scripts/fixture";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { keepRendering } from "./background-throttling.ts";
import { cli, cliCommand, waitFor } from "./obsidian-cli.ts";
import {
  clearVault,
  e2eVaultDir,
  isObsidianReachable,
  vaultScript,
} from "./vault-script.ts";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const fixture = getFixtureLayout(
  join(workspaceRoot, ".scratch", "e2e-item-query-cancel-fixture"),
);
const vaultPath = e2eVaultDir(workspaceRoot, "item-query-cancel-vault");
const pluginBundleDir = join(workspaceRoot, "apps", "obsidian", "dist-dev");
const runVaultScript = vaultScript(workspaceRoot, fixture.root);
const reachable = await isObsidianReachable(workspaceRoot);

/** Items in My Library: an export of all of them runs for longer than a CLI call. */
const STRESS_ITEMS = 100_000;
const EXPORT_FIELDS = JSON.stringify([
  "title",
  "creators",
  "tags",
  "collections",
  "date",
  "dateAdded",
  "dateModified",
  "attachments",
]);
/** One `limit=all` export of the Stress Build. */
const EXPORT_TIMEOUT_MS = 120_000;

interface QueryAnswer {
  command: string;
  ok: boolean;
  returnedCount?: number;
  file?: { path: string };
  diagnostic?: { code: string; details?: { parameter: string } };
}

interface CancelAnswer {
  contractVersion: number;
  command: string;
  ok: boolean;
  id: string;
  cancelRequested: boolean;
}

describe.skipIf(!reachable)("Item Query cancel", () => {
  let vaultId = "";

  const query = (args: Record<string, string>) =>
    cliCommand(vaultId, "zotlit:item-query", {
      args: { library: "personal", fields: EXPORT_FIELDS, ...args },
      timeoutMs: EXPORT_TIMEOUT_MS,
    });
  const cancel = async (id: string) =>
    JSON.parse(
      await cliCommand(vaultId, "zotlit:item-query-cancel", { args: { id } }),
    ) as CancelAnswer;

  beforeAll(async () => {
    await clearVault(runVaultScript, vaultPath);
    const pluginDir = join(vaultPath, ".obsidian", "plugins", "zotlit");
    await mkdir(pluginDir, { recursive: true });
    await cp(pluginBundleDir, pluginDir, { recursive: true });
    const created = await runVaultScript(["create", vaultPath]);
    vaultId = created.stdout.trim().split("\n")[0]!.trim();
    await keepRendering(vaultId);

    await cli([`vault=${vaultId}`, "plugin:disable", "id=zotlit"]);
    await buildFixture(fixture, {
      stressLibraryItemCount: STRESS_ITEMS,
      pluginBundleDir,
      linkedAttachmentVaultDir: vaultPath,
    });
    await cli([`vault=${vaultId}`, "plugin:enable", "id=zotlit"]);
    const ready = await waitFor(async () => {
      const answer = await query({ limit: "1", fields: "[]" }).catch(() => "");
      try {
        return (JSON.parse(answer) as QueryAnswer).ok;
      } catch {
        return false;
      }
    }, 240);
    expect(ready).toBe(true);
  }, 600_000);

  afterAll(async () => {
    await runVaultScript(["remove", vaultPath, "--purge"]);
    await discardFixture(fixture);
  }, 120_000);

  it("stops one named export from a second CLI call while another export continues", async () => {
    const exportsDir = join(fixture.root, "query-cancel-exports");
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(() => rm(exportsDir, { recursive: true, force: true }));
    const cancelledDir = join(exportsDir, "cancelled");
    const keptDir = join(exportsDir, "kept");
    await mkdir(cancelledDir, { recursive: true });
    await mkdir(keptDir, { recursive: true });
    const keptPath = join(keptDir, "items.json");

    const cancelled = query({
      id: "export-a",
      limit: "all",
      output: join(cancelledDir, "items.json"),
    }).then(
      (output) => ({ output }),
      (error: unknown) => ({ error }),
    );
    let keptSettled = false;
    const kept = query({ id: "export-b", limit: "all", output: keptPath });
    void kept.finally(() => (keptSettled = true));

    // The private file of export-a exists once it writes rows.
    const writing = await waitFor(
      async () =>
        (await readdir(cancelledDir)).some((name) => name.endsWith(".tmp")),
      400,
    );
    expect(writing).toBe(true);

    // A second query with the running id fails and leaves export-a running.
    const duplicate = JSON.parse(
      await query({ id: "export-a", limit: "1", fields: "[]" }),
    ) as QueryAnswer;
    expect(duplicate).toMatchObject({
      ok: false,
      diagnostic: { code: "query-id-in-use", details: { parameter: "id" } },
    });

    expect(await cancel("export-a")).toEqual({
      contractVersion: 1,
      command: "zotlit:item-query-cancel",
      ok: true,
      id: "export-a",
      cancelRequested: true,
    });
    expect(keptSettled).toBe(false);

    const stopped = await cancelled;
    expect(stopped).not.toHaveProperty("error");
    expect("output" in stopped && stopped.output).toBe(
      "Error: The query 'export-a' was cancelled by zotlit:item-query-cancel.",
    );
    expect(await readdir(cancelledDir)).toEqual([]);

    expect(JSON.parse(await kept)).toMatchObject({
      ok: true,
      returnedCount: STRESS_ITEMS,
      file: { path: keptPath },
    });

    // Both ids are free once their queries settle.
    expect(await cancel("export-a")).toMatchObject({
      ok: true,
      cancelRequested: false,
    });
    expect(await cancel("export-b")).toMatchObject({
      ok: true,
      cancelRequested: false,
    });
    expect(
      JSON.parse(await query({ id: "export-a", limit: "1", fields: "[]" })),
    ).toMatchObject({ ok: true, returnedCount: 1 });
  });
});
