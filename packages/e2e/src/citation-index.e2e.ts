// The Citation Index keeps requested answers available while the worker
// rebuilds a large lookup index. The Stress Build is isolated from the Development Vault.
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
import { measureWorkerHeap } from "./worker-heap.ts";
import { measureWorkerResponsiveness } from "./worker-responsiveness.ts";

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
// Native edits measured 39–57 ms searches and 113–128 ms worker timer gaps.
const INTERACTIVE_MAX_MS = 100;
const WORKER_TIMER_MAX_MS = 250;

interface RefreshEvidence {
  gaps: number[];
  readMs: number[];
  citationReadMs: number[];
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
      // Shared Reading keeps Stress Items at both ends of the 100,000-Item corpus.
      stressItemCount: 100_000 - ITEMS.length,
      stressSparseLibraryID: 2,
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
      "(async()=>{const s=app.plugins.plugins.zotlit.services;await s.itemLookup.search('',{limit:1});await s.citationLookup.read({});return true;})()",
      120_000,
    );
  }, 600_000);

  afterAll(async () => {
    await runVaultScript(["remove", vaultPath, "--purge"]);
    await discardFixture(fixture);
  }, 120_000);

  it("keeps requested answers and interactive reads responsive while refreshing 100,000 Items", async () => {
    const { value: evidence, workerHeap } = await measureWorkerHeap(
      vaultId,
      async () => {
        const evidence: RefreshEvidence[] = [];
        for (let round = 0; round < 3; round += 1) {
          evidence.push(
            JSON.parse(
              await obEval(
                vaultId,
                `(async()=>{
              const s=app.plugins.plugins.zotlit.services,lookup=s.citationLookup;
              const gaps=[],readMs=[],citationReadMs=[];
              const key=${JSON.stringify(item.key)},expected=${JSON.stringify(item.citationKey)};
              const request={citekeys:[expected],indexedKeys:[key]};
              const held=await lookup.read(request);
              const first=Promise.withResolvers();
              let projection;
              projection=lookup.observe(()=>{if(projection?.current)first.resolve();});
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
                return await lookup.read(request);
              })().finally(()=>{refreshing=false;});
              // Every search crosses the interactive worker and hydrates its hit from SQLite.
              const reads=(async()=>{
                do {
                  const started=performance.now();
                  const hits=await s.itemLookup.search(${JSON.stringify(item.title)},{limit:1});
                  readMs.push(performance.now()-started);
                  readsCorrect&&=hits.length===1&&hits[0].item.itemID===${item.itemID}&&hits[0].item.fields.title===${JSON.stringify(item.title)};
                  if(refreshing)readsDuringRefresh++;
                } while(refreshing);
              })();
              const citationReads=(async()=>{
                do {
                  const started=performance.now();
                  await lookup.read(request);
                  citationReadMs.push(performance.now()-started);
                  // A held answer can resolve immediately; yield so refresh and search can progress.
                  await new Promise(resolve=>setTimeout(resolve,0));
                } while(refreshing);
              })();
              const [fresh]=await Promise.all([refresh,reads,citationReads]);
              sample();
              const unrequested=[
                ['unrequested-probe-key',()=>fresh.resolve('unrequested-probe-key')],
                ['UNREQUESTED',()=>fresh.citekeyOf('UNREQUESTED')],
              ].every(([key,read])=>{
                try{read();return false;}catch(error){return error instanceof Error&&error.message.includes(key);}
              });
              return JSON.stringify({gaps,readMs,citationReadMs,readsDuringRefresh,readsCorrect,heldThroughout,sameRevision:fresh.revision===held.revision,citekey:fresh.citekeyOf(key),unique:fresh.resolve(expected).kind==="unique",unrequested});
            })()`,
                120_000,
              ),
            ) as RefreshEvidence,
          );
        }
        return evidence;
      },
    );
    const gaps = evidence.flatMap(({ gaps }) => gaps).toSorted((a, b) => a - b);
    const p99 = gaps[Math.ceil(gaps.length * 0.99) - 1]!;
    const maximum = gaps.at(-1)!;
    const readMs = evidence
      .flatMap(({ readMs }) => readMs)
      .toSorted((a, b) => a - b);
    const readP99 = readMs[Math.ceil(readMs.length * 0.99) - 1]!;
    const readMaximum = readMs.at(-1)!;
    const citationReadMs = evidence
      .flatMap(({ citationReadMs }) => citationReadMs)
      .toSorted((a, b) => a - b);
    console.info("Citation Index refresh, 100,000 Items", {
      renderer: { p99, maximum },
      interactive: {
        p99: readP99,
        maximum: readMaximum,
        samples: readMs.length,
      },
      citationLookup: {
        p99: citationReadMs[Math.ceil(citationReadMs.length * 0.99) - 1]!,
        maximum: citationReadMs.at(-1)!,
        samples: citationReadMs.length,
      },
      workerHeap,
      readsDuringRefresh: evidence.map(
        ({ readsDuringRefresh }) => readsDuringRefresh,
      ),
    });
    expect(gaps.length).toBeGreaterThan(0);
    expect(readMs.length).toBeGreaterThan(0);
    expect(readMaximum).toBeLessThanOrEqual(INTERACTIVE_MAX_MS);
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

  it("serves searches and worker tasks while changed Items rebuild the 100,000-Item index", async () => {
    const { value: rounds, gaps } = await measureWorkerResponsiveness(
      vaultId,
      async () => {
        const rounds: {
          maximum: number;
          samples: number;
          correct: boolean;
          fresh: boolean;
        }[] = [];
        for (let round = 1; round <= 3; round++) {
          const title = `Updated Item search regression ${round}`;
          // A real source change moves the signature and forces an Item Index rebuild.
          // This Fixture has no running Zotero; only the test writes its source.
          {
            using sqlite = new DatabaseSync(fixture.databasePath);
            sqlite.exec("BEGIN IMMEDIATE");
            sqlite
              .prepare(`UPDATE itemDataValues SET value = ? WHERE valueID = (
              SELECT itemData.valueID FROM itemData JOIN fields USING (fieldID)
              WHERE itemID = ? AND fieldName = 'title'
            )`)
              .run(title, item.itemID);
            sqlite
              .prepare("UPDATE items SET dateModified = ? WHERE itemID = ?")
              .run(`2030-01-01 00:00:0${round}`, item.itemID);
            sqlite.exec("COMMIT");
          }
          rounds.push(
            JSON.parse(
              await obEval(
                vaultId,
                `(async()=>{
            const s=app.plugins.plugins.zotlit.services;
            const refresh=s.zoteroReads.refresh();
            let refreshed=false,maximum=0,samples=0,correct=true,fresh=false;
            const settled=refresh.then(()=>{refreshed=true;});
            const deadline=performance.now()+60000;
            do{
              const start=performance.now();
              const hits=await s.itemLookup.search(${JSON.stringify(item.key)},{limit:1});
              maximum=Math.max(maximum,performance.now()-start);samples++;
              correct&&=hits.length===1&&hits[0].item.itemID===${item.itemID};
              fresh=hits[0]?.item.fields.title===${JSON.stringify(title)};
              await new Promise(resolve=>setTimeout(resolve,50));
            }while((!refreshed||!fresh)&&performance.now()<deadline);
            await settled;
            return JSON.stringify({maximum,samples,correct,fresh});
          })()`,
                120_000,
              ),
            ),
          );
        }
        return rounds;
      },
    );
    console.info("Changed Item Index, 100,000 Items", {
      rounds,
      workerTimerMaximum: Math.max(...gaps),
    });
    expect(
      rounds.every(
        ({ correct, fresh, samples }) => correct && fresh && samples > 1,
      ),
    ).toBe(true);
    expect(
      Math.max(...rounds.map(({ maximum }) => maximum)),
    ).toBeLessThanOrEqual(INTERACTIVE_MAX_MS);
    expect(gaps.length).toBeGreaterThan(0);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(WORKER_TIMER_MAX_MS);
  }, 240_000);

  it("keeps the held search index when snapshot integrity validation fails", async () => {
    {
      using sqlite = new DatabaseSync(fixture.databasePath, {
        defensive: false,
      });
      sqlite.exec(`
        CREATE TABLE integrity_probe (value INTEGER);
        INSERT INTO integrity_probe VALUES (NULL);
        PRAGMA writable_schema = ON;
        UPDATE sqlite_schema SET sql = 'CREATE TABLE integrity_probe (value INTEGER NOT NULL)'
          WHERE name = 'integrity_probe';
      `);
    }
    const answer = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{
      const s=app.plugins.plugins.zotlit.services;
      let rejected=false;
      try{await s.zoteroReads.refresh();}catch{rejected=true;}
      const hits=await s.itemLookup.search(${JSON.stringify(item.key)},{limit:1});
      return JSON.stringify({rejected,itemID:hits[0]?.item.itemID});
    })()`,
        120_000,
      ),
    );
    expect(answer).toEqual({ rejected: true, itemID: item.itemID });
  }, 120_000);
});
