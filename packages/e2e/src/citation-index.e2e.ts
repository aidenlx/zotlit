// The Citation Index keeps requested answers available while the worker
// rebuilds a large lookup index. The Stress Build is isolated from the Development Vault.
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildFixture,
  discardFixture,
  getFixtureLayout,
  ITEMS,
} from "@zotlit/scripts/fixture";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { prepareRunWindow } from "./background-throttling.ts";
import { cli, obEval, obEvalUntil, waitFor } from "./obsidian-cli.ts";
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

/** Each mutation owns a backup and restores both source data and held reads. */
async function preserveFixture(vaultId: string): Promise<AsyncDisposableStack> {
  await using cleanup = new AsyncDisposableStack();
  const path = `${fixture.databasePath}.before-test`;
  cleanup.defer(() => rm(path, { force: true }));
  {
    using source = new DatabaseSync(fixture.databasePath, { readOnly: true });
    await backup(source, path);
  }
  cleanup.defer(async () => {
    await cp(path, fixture.databasePath);
    await obEval(
      vaultId,
      `app.plugins.plugins.zotlit.services.zoteroReads.refresh().then(()=>true)`,
      120_000,
    );
    expect(
      await waitFor(
        async () =>
          (await obEval(
            vaultId,
            `app.plugins.plugins.zotlit.services.itemLookup.search(${JSON.stringify(item.key)},{limit:1}).then(hits=>String(hits[0]?.item.fields.title===${JSON.stringify(item.title)}))`,
          )) === "true",
        240,
      ),
    ).toBe(true);
  });
  return cleanup.move();
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
    await prepareRunWindow(vaultId);
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

  it("keeps all citation syntaxes and annotation embeds across a parse worker restart (#1695)", async () => {
    const note = "Scan pipeline smoke.md";
    const literature = "Scan pipeline source.md";
    const uri =
      "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2";
    const body = `[@rougierTenSimpleRules2014]\n\n[[Scan pipeline source]]\n\n[](${uri})\n\nDROP\n`;
    const state = "window.__zotlitScanSmoke";
    try {
      await obEval(
        vaultId,
        `(async()=>{
        const cleanup=new AsyncDisposableStack();
        const s=${state}={cleanup};
        const services=app.plugins.plugins.zotlit.services;
        const layout=app.workspace.getLayout();
        cleanup.defer(()=>app.workspace.changeLayout(layout));
        const settings=services.settings.current;
        const keys=['citation.pandoc-citations','citation.wikilink-citations','citation.annotation-citations'];
        cleanup.defer(()=>services.settings.update(Object.fromEntries(keys.map(key=>[key,settings[key]]))));
        services.settings.update(Object.fromEntries(keys.map(key=>[key,true])));
        const profilePath=services.profile.defaultDocumentPath;
        const existing=app.vault.getFileByPath(profilePath);
        const original=existing?await app.vault.read(existing):services.profile.getBuiltInSource();
        const header='--- zotlit:annotation ---';
        if(!original.includes(header))throw Error('Default profile has no annotation section');
        const source=original.slice(0,original.indexOf(header)+header.length)+${JSON.stringify("\n![]({{ zt.backlink }})\n")};
        if(existing){
          cleanup.defer(async()=>{await app.vault.modify(existing,original);await services.template.refresh();});
          await app.vault.modify(existing,source);
        }else{
          const folder=profilePath.slice(0,profilePath.lastIndexOf('/'));
          if(folder&&!app.vault.getFolderByPath(folder)){
            await app.vault.createFolder(folder);
            cleanup.defer(async()=>{const made=app.vault.getFolderByPath(folder);if(made&&made.children.length===0)await app.vault.delete(made);});
          }
          const created=await app.vault.create(profilePath,source);
          cleanup.defer(async()=>{await app.vault.delete(created);await services.template.refresh();});
        }
        await services.template.refresh();
        const literature=await app.vault.create(${JSON.stringify(literature)},${JSON.stringify("---\nzotero-key: RUGIER24\n---\n")});
        cleanup.defer(()=>app.vault.delete(literature));
        s.file=await app.vault.create(${JSON.stringify(note)},${JSON.stringify("An empty draft.\n")});
        cleanup.defer(()=>app.vault.delete(s.file));
        s.leaf=app.workspace.getLeaf('tab');
        await s.leaf.setViewState({type:'markdown',state:{file:s.file.path,mode:'source',source:true},active:true});
        cleanup.defer(async()=>{await s.leaf.view.save();s.leaf.detach();});
        s.editor=s.leaf.view.editor;
        s.editor.setValue(${JSON.stringify(body)});
        await s.leaf.view.save();
        s.annotations=app.workspace.getRightLeaf(false);
        await s.annotations.setViewState({type:'zotero-annotation-view',state:{followMode:'pinned',pinnedItemKey:'RUGIER24'}});
        await s.annotations.view.read;
        return true;
      })()`,
      );
      expect(
        await obEvalUntil(
          vaultId,
          `String(!!${state}.annotations.view.contentEl.querySelector('[data-zotero-annotation-key="FDRFQ7C2"] [draggable]'))`,
          { expected: "true" },
        ),
      ).toBe(true);
      await obEval(
        vaultId,
        `(()=>{
        const s=${state};
        const button=s.annotations.view.contentEl.querySelector('[data-zotero-annotation-key="FDRFQ7C2"] [draggable]');
        const win=button.ownerDocument.defaultView;
        const transfer=new win.DataTransfer();
        button.dispatchEvent(new win.DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));
        const position=s.editor.getValue().indexOf('DROP');
        s.editor.setSelection(s.editor.offsetToPos(position),s.editor.offsetToPos(position+4));
        const rect=s.editor.cm.coordsAtPos(position);
        if(!rect)throw Error('Annotation drop coordinates unavailable');
        const drop=new win.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:rect.left+1,clientY:(rect.top+rect.bottom)/2});
        app.workspace.trigger('editor-drop',drop,s.editor,s.leaf.view);
        if(!drop.defaultPrevented)throw Error('ZotLit did not accept the annotation drag');
        return true;
      })()`,
      );
      expect(
        await obEvalUntil(
          vaultId,
          `String(${state}.editor.getValue().includes(${JSON.stringify(`![](${uri})`)}))`,
          { expected: "true" },
        ),
      ).toBe(true);
      await obEval(
        vaultId,
        `(async()=>{
        const s=${state};await s.leaf.view.save();
        s.references=app.workspace.getRightLeaf(false);
        await s.references.setViewState({type:'zotlit-references'});
        app.workspace.setActiveLeaf(s.leaf,{focus:true});return true;
      })()`,
      );

      const readAnswers = async () => {
        const references = JSON.parse(
          await cli([`vault=${vaultId}`, "zotlit:references", `file=${note}`]),
        ) as {
          ok: boolean;
          entries: {
            kind: string;
            key: string;
            occurrences: {
              kind: string;
              position: { start: { offset: number } };
            }[];
          }[];
        };
        const uses = JSON.parse(
          await cli([
            `vault=${vaultId}`,
            "zotlit:annotation-uses",
            "key=FDRFQ7C2",
          ]),
        ) as {
          ok: boolean;
          groups: {
            path: string;
            occurrences: {
              form: string;
              position: { start: { offset: number } };
            }[];
          }[];
        };
        expect(references.ok).toBe(true);
        expect(references.entries).toHaveLength(1);
        expect(references.entries[0]).toMatchObject({
          kind: "resolved",
          key: "RUGIER24",
        });
        expect(
          references.entries[0]!.occurrences.map(
            (occurrence) => occurrence.kind,
          ),
        ).toEqual(["citekey", "wikilink", "annotation"]);
        expect(uses.ok).toBe(true);
        const group = uses.groups.find((group) => group.path === note);
        expect(group?.occurrences.map((occurrence) => occurrence.form)).toEqual(
          ["citation", "embed"],
        );
        expect(
          await obEvalUntil(
            vaultId,
            `String(Array.from(${state}.references.view.contentEl.querySelectorAll('li')).some(row=>row.textContent.includes('Ten Simple Rules for Better Figures')&&Array.from(row.querySelectorAll('[aria-hidden]')).some(badge=>badge.textContent==='3')))`,
            { expected: "true" },
          ),
        ).toBe(true);
        return { references: references.entries, uses: group!.occurrences };
      };
      await expect
        .poll(
          async () =>
            JSON.parse(
              await cli([
                `vault=${vaultId}`,
                "zotlit:references",
                `file=${note}`,
              ]),
            ).entries?.[0]?.occurrences?.length,
          { timeout: 15000 },
        )
        .toBe(3);
      const before = await readAnswers();
      // The error crosses the real worker boundary and starts production recovery.
      await obEval(
        vaultId,
        `(async()=>{
        const s=${state};
        const client=require('@electron/remote').getCurrentWebContents().debugger;
        const attached=client.isAttached();if(!attached)client.attach('1.3');
        s.sessions=[];
        const found=Promise.withResolvers();
        const listener=(_event,method,params)=>{
          if(method==='Target.attachedToTarget'&&params.targetInfo.title==='zotlit-citation-parse'){
            s.sessions.push(params.sessionId);found.resolve();
          }
        };
        client.on('message',listener);
        s.cleanup.defer(async()=>{
          await client.sendCommand('Target.setAutoAttach',{autoAttach:false,waitForDebuggerOnStart:false,flatten:true});
          client.removeListener('message',listener);if(!attached)client.detach();
        });
        await client.sendCommand('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true});
        let timer;
        try{await Promise.race([found.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Parse worker did not attach')),3000);})]);}finally{clearTimeout(timer);}
        if(s.sessions.length!==1)throw Error('Expected one parse worker');
        await client.sendCommand('Runtime.evaluate',{expression:"setTimeout(()=>{throw Error('Scan smoke worker restart');},0)"},s.sessions[0]);
        return true;
      })()`,
      );
      expect(
        await obEvalUntil(
          vaultId,
          `String(${state}.sessions.length===2&&${state}.sessions[0]!==${state}.sessions[1])`,
          { expected: "true" },
        ),
      ).toBe(true);
      expect(await readAnswers()).toEqual(before);
      // New offsets prove the replacement worker parsed a new edit, rather than serving held records alone.
      await obEval(
        vaultId,
        `(async()=>{const s=${state};s.editor.setValue(${JSON.stringify("After restart.\n\n")}+s.editor.getValue());await s.leaf.view.save();return true;})()`,
      );
      await expect
        .poll(
          async () =>
            JSON.parse(
              await cli([
                `vault=${vaultId}`,
                "zotlit:references",
                `file=${note}`,
              ]),
            ).entries?.[0]?.occurrences?.[0]?.position.start.offset,
          { timeout: 15000 },
        )
        .toBe(before.references[0]!.occurrences[0]!.position.start.offset + 16);
      const after = await readAnswers();
      expect(
        after.uses.map((occurrence) => occurrence.position.start.offset),
      ).toEqual(
        before.uses.map((occurrence) => occurrence.position.start.offset + 16),
      );
    } finally {
      await obEval(
        vaultId,
        `(async()=>{try{await ${state}?.cleanup.disposeAsync();}finally{delete ${state};}return true;})()`,
      );
    }
  }, 120_000);

  it("keeps requested answers and interactive reads responsive while refreshing 100,000 Items", async () => {
    // A delivered push over unchanged bytes must leave downstream indexes alone.
    const unchanged = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{
          const s=app.plugins.plugins.zotlit.services;
          const settled=Promise.withResolvers();
          let active=false,publications=0;
          using cleanup=new DisposableStack();
          cleanup.defer(s.zoteroReads.on('changed',()=>publications++));
          cleanup.defer(s.zoteroReads.on('refreshing',value=>{
            if(value)active=true;else if(active)settled.resolve();
          }));
          cleanup.adopt(setTimeout(()=>settled.reject(Error('Push did not settle')),10000),clearTimeout);
          s.zoteroReads.notifyExternalChange();
          await settled.promise;
          const hits=await s.itemLookup.search(${JSON.stringify(item.key)},{limit:1});
          return JSON.stringify({publications,itemID:hits[0]?.item.itemID});
        })()`,
        30_000,
      ),
    );
    expect(unchanged).toEqual({ publications: 0, itemID: item.itemID });

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
    await using _source = await preserveFixture(vaultId);
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
            using cleanup=new DisposableStack();
            const changed=Promise.withResolvers();
            cleanup.defer(s.zoteroReads.on('changed',()=>changed.resolve()));
            cleanup.adopt(setTimeout(()=>changed.reject(Error('Changed push did not publish')),60000),clearTimeout);
            let refreshed=false,maximum=0,samples=0,correct=true,fresh=false;
            const settled=changed.promise.then(()=>{refreshed=true;});
            s.zoteroReads.notifyExternalChange();
            const deadline=performance.now()+60000;
            do{
              const start=performance.now();
              const hits=await s.itemLookup.search(${JSON.stringify(item.key)},{limit:1});
              maximum=Math.max(maximum,performance.now()-start);samples++;
              correct&&=hits.length===1&&hits[0].item.itemID===${item.itemID};
              fresh=hits[0]?.item.fields.title===${JSON.stringify(title)};
              // Sampling cadence: each pass measures one search during the refresh.
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
    await using _source = await preserveFixture(vaultId);
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
