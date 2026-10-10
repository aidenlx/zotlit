// The Citation Index keeps a complete answer while a large refresh yields to
// renderer tasks. The Stress Build is isolated from the Development Vault.
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildFixture,
  discardFixture,
  getFixtureLayout,
  ITEMS,
} from "@zotlit/scripts/fixture";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { keepRendering } from "./background-throttling.ts";
import { cli, cliCommand, obEval, waitFor } from "./obsidian-cli.ts";
import { THRESHOLDS } from "./query-record.ts";
import {
  clearVault,
  e2eVaultDir,
  isObsidianReachable,
  vaultScript,
} from "./vault-script.ts";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const fixture = getFixtureLayout(
  join(workspaceRoot, ".scratch", "e2e-citation-index-fixture"),
);
const vaultPath = e2eVaultDir(workspaceRoot, "citation-index-vault");
const pluginBundleDir = join(workspaceRoot, "apps", "obsidian", "dist-dev");
const runVaultScript = vaultScript(workspaceRoot, fixture.root);
const reachable = await isObsidianReachable(workspaceRoot);
const item = ITEMS.find(({ itemID }) => itemID === 1)!;

interface RefreshEvidence {
  gaps: number[];
  heldThroughout: boolean;
  sameSnapshot: boolean;
  citekey: string;
}

describe.skipIf(!reachable)("Citation Index renderer responsiveness", () => {
  let vaultId = "";

  beforeAll(async () => {
    await clearVault(runVaultScript, vaultPath);
    await mkdir(join(vaultPath, ".obsidian", "plugins", "zotlit"), {
      recursive: true,
    });
    await cp(
      pluginBundleDir,
      join(vaultPath, ".obsidian", "plugins", "zotlit"),
      {
        recursive: true,
      },
    );
    const created = await runVaultScript(["create", vaultPath]);
    vaultId = created.stdout.trim().split("\n")[0]!.trim();
    await keepRendering(vaultId);
    await cli([`vault=${vaultId}`, "plugin:disable", "id=zotlit"]);
    await buildFixture(fixture, {
      stressLibraryItemCount: 100_000,
      pluginBundleDir,
      linkedAttachmentVaultDir: vaultPath,
    });
    await cli([`vault=${vaultId}`, "plugin:enable", "id=zotlit"]);
    expect(
      await waitFor(async () => {
        const answer = await cliCommand(vaultId, "zotlit:query", {
          args: { library: "personal", fields: "[]", limit: "1" },
        }).catch(() => "");
        try {
          return (JSON.parse(answer) as { ok: boolean }).ok;
        } catch {
          return false;
        }
      }, 240),
    ).toBe(true);
    await obEval(
      vaultId,
      "(async()=>{const s=app.plugins.plugins.zotlit.services;await s.itemLookup.search('',{limit:1});await s.citationIndex.readSnapshot();return true;})()",
      120_000,
    );
  }, 600_000);

  afterAll(async () => {
    await runVaultScript(["remove", vaultPath, "--purge"]);
    await discardFixture(fixture);
  }, 120_000);

  it("keeps a 100,000-Item snapshot available while refreshing within the renderer budget", async () => {
    const evidence: RefreshEvidence[] = [];
    for (let round = 0; round < 3; round += 1) {
      evidence.push(
        JSON.parse(
          await obEval(
            vaultId,
            `(async()=>{
              const s=app.plugins.plugins.zotlit.services,index=s.citationIndex;
              const held=await index.readSnapshot(),gaps=[];
              const key=${JSON.stringify(item.key)},expected=${JSON.stringify(item.citationKey)};
              let previous=performance.now(),heldThroughout=true;
              using cleanup=new DisposableStack();
              const changed=Promise.withResolvers();
              cleanup.defer(s.zoteroReads.on('changed',()=>changed.resolve()));
              const sample=()=>{const now=performance.now();gaps.push(now-previous);previous=now;heldThroughout&&=index.citekeyOf(key)===expected;};
              cleanup.adopt(setInterval(sample,4),clearInterval);
              await s.zoteroReads.refresh();
              await changed.promise;
              const fresh=await index.readSnapshot();
              sample();
              return JSON.stringify({gaps,heldThroughout,sameSnapshot:fresh===held,citekey:fresh.citekeyOf(key)});
            })()`,
            120_000,
          ),
        ) as RefreshEvidence,
      );
    }
    const gaps = evidence.flatMap(({ gaps }) => gaps).toSorted((a, b) => a - b);
    const p99 = gaps[Math.ceil(gaps.length * 0.99) - 1]!;
    const maximum = gaps.at(-1)!;
    console.info("Citation Index refresh, 100,000 Items", { p99, maximum });
    expect(gaps.length).toBeGreaterThan(0);
    expect(evidence.every(({ heldThroughout }) => heldThroughout)).toBe(true);
    expect(evidence.every(({ sameSnapshot }) => sameSnapshot)).toBe(true);
    expect(evidence.map(({ citekey }) => citekey)).toEqual([
      item.citationKey,
      item.citationKey,
      item.citationKey,
    ]);
    expect(p99).toBeLessThanOrEqual(THRESHOLDS.slice.p99Ms);
    expect(maximum).toBeLessThanOrEqual(THRESHOLDS.slice.maxMs);
  }, 120_000);
});
