// Citation scan smoke and renderer budget on the shared run Fixture (#1695).
import { describe, expect, it } from "vitest";

import { measureCitationScan } from "./citation-scan-measure.ts";
import { reachable } from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { cli, obEval, obEvalUntil } from "./obsidian-cli.ts";

describe.skipIf(!reachable)("Citation scan pipeline", () => {
  registerEndToEndRunHooks();

  it("keeps all citation syntaxes and annotation embeds across a parse worker restart (#1695)", async () => {
    const { vaultId } = run;
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
        const keys=['citation.pandoc-citations','citation.wikilink-citations','citation.annotation-citations','attachment.import'];
        cleanup.defer(()=>services.settings.update(Object.fromEntries(keys.map(key=>[key,settings[key]]))));
        services.settings.update(Object.fromEntries(keys.map(key=>[key,key!=='attachment.import'])));
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
        // Pin before any tab cites the Item: a pin that follows an active-tab load
        // of the same Item stays "Loading…" (#1701).
        s.annotations=app.workspace.getRightLeaf(false);
        cleanup.defer(()=>s.annotations.detach());
        await s.annotations.setViewState({type:'zotero-annotation-view',state:{followMode:'pinned',pinnedItemKey:'RUGIER24'}});
        await s.annotations.view.read;
        const literature=await app.vault.create(${JSON.stringify(literature)},${JSON.stringify("---\nzotero-key: RUGIER24\n---\n")});
        cleanup.defer(()=>app.vault.delete(literature));
        s.file=await app.vault.create(${JSON.stringify(note)},${JSON.stringify("An empty draft.\n")});
        cleanup.defer(()=>app.vault.delete(s.file));
        s.leaf=app.workspace.getLeaf('tab');
        cleanup.defer(()=>s.leaf.detach());
        await s.leaf.setViewState({type:'markdown',state:{file:s.file.path,mode:'source',source:true},active:true});
        cleanup.defer(()=>s.leaf.view.save());
        s.editor=s.leaf.view.editor;
        s.editor.setValue(${JSON.stringify(body)});
        await s.leaf.view.save();
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
        s.cleanup.defer(()=>s.references.detach());
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
      // Agreed budget for PR #1696: ADR 0080 aimed for 2 ms; the desktop renderer
      // measured 4.9 ms dense and 2.2 ms sparse at max, harness IPC included.
      // #1702 brings both back to 2 ms.
      const measurements = await measureCitationScan(vaultId);
      for (const measurement of measurements) {
        console.info(
          "Citation scan renderer CPU, 100k characters",
          measurement,
        );
        // The 90th percentile, not the maximum: the single slowest of 15
        // samples crossed 3 ms sparse in about one baseline run in five.
        expect
          .soft(measurement.p90Ms, measurement.density)
          .toBeLessThan(measurement.density === "dense" ? 6 : 3);
      }
    } finally {
      await obEval(
        vaultId,
        `(async()=>{try{await ${state}?.cleanup.disposeAsync();}finally{delete ${state};}return true;})()`,
      );
    }
  }, 120_000);
});
