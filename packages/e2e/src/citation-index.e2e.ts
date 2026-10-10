// The Citation Index keeps requested answers available while the worker
// rebuilds a large lookup index. The Stress Build is isolated from the Development Vault.
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
import { cli, obEval, waitFor } from "./obsidian-cli.ts";
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
// Renderer limits from origin/feat/zotlit-query:packages/e2e/src/query-record.ts
// (spec #1314, THRESHOLDS.slice).
const RENDERER_BUDGET = { p99Ms: 16, maxMs: 32 };

interface RefreshEvidence {
  gaps: number[];
  readMs: number[];
  readsDuringRefresh: number;
  readsCorrect: boolean;
  heldThroughout: boolean;
  sameRevision: boolean;
  citekey: string;
  unique: boolean;
  unrequested: boolean;
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
      // next's additive corpus fills all Fixture Libraries to 100,000 total Items.
      stressItemCount: 100_000 - ITEMS.length,
      pluginBundleDir,
      linkedAttachmentVaultDir: vaultPath,
    });
    await cli([`vault=${vaultId}`, "plugin:enable", "id=zotlit"]);
    expect(
      await waitFor(async () => {
        const answer = await obEval(
          vaultId,
          `app.plugins.plugins.zotlit.services.itemLookup.search(${JSON.stringify(item.title)},{limit:1}).then(hits=>String(hits[0]?.item.itemID===${item.itemID}))`,
        ).catch(() => "");
        return answer === "true";
      }, 240),
    ).toBe(true);
    await obEval(
      vaultId,
      "(async()=>{const s=app.plugins.plugins.zotlit.services;await s.itemLookup.search('',{limit:1});await s.citationIndex.readLookup({});return true;})()",
      120_000,
    );
  }, 600_000);

  afterAll(async () => {
    await runVaultScript(["remove", vaultPath, "--purge"]);
    await discardFixture(fixture);
  }, 120_000);

  it("keeps requested answers and interactive reads responsive while refreshing 100,000 Items", async () => {
    const evidence: RefreshEvidence[] = [];
    for (let round = 0; round < 3; round += 1) {
      evidence.push(
        JSON.parse(
          await obEval(
            vaultId,
            `(async()=>{
              const s=app.plugins.plugins.zotlit.services,index=s.citationIndex;
              const gaps=[],readMs=[];
              const key=${JSON.stringify(item.key)},expected=${JSON.stringify(item.citationKey)};
              const request={citekeys:[expected],indexedKeys:[key]};
              const held=await index.readLookup(request);
              const first=Promise.withResolvers();
              let projection;
              projection=index.observeLookup(()=>{if(projection?.current)first.resolve();});
              using disposeProjection=projection;
              projection.set(request);
              await first.promise;
              let previous=performance.now(),heldThroughout=true;
              using cleanup=new DisposableStack();
              const changed=Promise.withResolvers();
              cleanup.defer(s.zoteroReads.on('changed',()=>changed.resolve()));
              const sample=()=>{const now=performance.now();gaps.push(now-previous);previous=now;heldThroughout&&=projection.current?.value.citekeyOf(key)===expected;};
              cleanup.adopt(setInterval(sample,4),clearInterval);
              let refreshing=true,readsDuringRefresh=0,readsCorrect=true;
              const refresh=(async()=>{
                await s.zoteroReads.refresh();
                await changed.promise;
                return await index.readLookup(request);
              })().finally(()=>{refreshing=false;});
              // Every search crosses the interactive worker and hydrates its hit from SQLite.
              const reads=(async()=>{
                do {
                  const started=performance.now();
                  const hits=await s.itemLookup.search(${JSON.stringify(item.title)},{limit:1});
                  readMs.push(performance.now()-started);
                  readsCorrect&&=hits.length===1&&hits[0].item.itemID===${item.itemID}&&hits[0].item.title===${JSON.stringify(item.title)};
                  if(refreshing)readsDuringRefresh++;
                } while(refreshing);
              })();
              const [fresh]=await Promise.all([refresh,reads]);
              sample();
              return JSON.stringify({gaps,readMs,readsDuringRefresh,readsCorrect,heldThroughout,sameRevision:fresh.revision===held.revision,citekey:fresh.citekeyOf(key),unique:fresh.resolve(expected)?.kind==="unique",unrequested:fresh.resolve("unrequested-probe-key")===null&&fresh.citekeyOf("UNREQUESTED")===undefined});
            })()`,
            120_000,
          ),
        ) as RefreshEvidence,
      );
    }
    const gaps = evidence.flatMap(({ gaps }) => gaps).toSorted((a, b) => a - b);
    const p99 = gaps[Math.ceil(gaps.length * 0.99) - 1]!;
    const maximum = gaps.at(-1)!;
    const readMs = evidence
      .flatMap(({ readMs }) => readMs)
      .toSorted((a, b) => a - b);
    const readP99 = readMs[Math.ceil(readMs.length * 0.99) - 1]!;
    const readMaximum = readMs.at(-1)!;
    console.info("Citation Index refresh, 100,000 Items", {
      renderer: { p99, maximum },
      interactive: {
        p99: readP99,
        maximum: readMaximum,
        samples: readMs.length,
      },
      readsDuringRefresh: evidence.map(
        ({ readsDuringRefresh }) => readsDuringRefresh,
      ),
    });
    expect(gaps.length).toBeGreaterThan(0);
    expect(readMs.length).toBeGreaterThan(0);
    expect(evidence.every(({ readsCorrect }) => readsCorrect)).toBe(true);
    expect(
      evidence.every(({ readsDuringRefresh }) => readsDuringRefresh > 0),
    ).toBe(true);
    expect(evidence.every(({ heldThroughout }) => heldThroughout)).toBe(true);
    expect(evidence.every(({ sameRevision }) => sameRevision)).toBe(true);
    expect(
      evidence.every(({ unique, unrequested }) => unique && unrequested),
    ).toBe(true);
    expect(evidence.map(({ citekey }) => citekey)).toEqual([
      item.citationKey,
      item.citationKey,
      item.citationKey,
    ]);
    expect(p99).toBeLessThanOrEqual(RENDERER_BUDGET.p99Ms);
    expect(maximum).toBeLessThanOrEqual(RENDERER_BUDGET.maxMs);
  }, 120_000);
});
