import { mkdir } from "node:fs/promises";
import { join } from "node:path";
// Real Annotation View menu insertion in the main window and a pop-out editor.
import { expect } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { cli, obEval, obEvalUntil } from "./obsidian-cli.ts";

export async function verifyAnnotationInsert(
  vaultId: string,
  host: "main" | "popout",
) {
  const state = "window.__zotlitInsertTrial";
  try {
    await obEval(
      vaultId,
      `(async()=>{
    const s=window.__zotlitInsertTrial={layout:app.workspace.getLayout()};
    const services=app.plugins.plugins.zotlit.services;
    s.services=services;s.original=services.noteFeature.prepareAnnotationInsert;
    s.link=app.fileManager.generateMarkdownLink;
    app.fileManager.generateMarkdownLink=function(file,...args){if(file.name?.startsWith('zotlit-excerpt-')&&!app.vault.getFileByPath(file.path))throw new Error('Excerpt link rendered before vault registration');return s.link.call(this,file,...args);};
    s.importEnabled=services.settings.current['attachment.import'];
    services.settings.update({'attachment.import':true});
    for(const leaf of app.workspace.getLeavesOfType('pdf'))leaf.detach();
    const file=app.vault.getFileByPath('Insert-${host}.md')??await app.vault.create('Insert-${host}.md','before TARGET after');
    s.file=file;s.otherFile=app.vault.getFileByPath('Insert-other-${host}.md')??await app.vault.create('Insert-other-${host}.md','other editor');
    s.leaf=app.workspace.getLeaf('tab');await s.leaf.openFile(file);
    ${host === "popout" ? "app.workspace.moveLeafToPopout(s.leaf);" : ""}
    const viewLeaf=app.workspace.getRightLeaf(false);s.viewLeaf=viewLeaf;
    await viewLeaf.setViewState({type:'zotero-annotation-view',state:{followMode:'pinned',pinnedItemKey:'RUGIER24'}});
    s.view=viewLeaf.view;await s.view.read;
    s.assets=app.vault.getFiles().filter(f=>f.name.startsWith('zotlit-excerpt-')).length;
    return true;
  })()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(!!${state}.view.snapshot.annotations?.some(a=>a.key==='FDRFQ7C2'))`,
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await obEval(
        vaultId,
        `String(${state}.leaf.view.editor.cm.dom.ownerDocument.defaultView===window)`,
      ),
    ).toBe(String(host === "main"));
    expect(
      await obEvalUntil(
        vaultId,
        `String(!!${state}.leaf.view.editor?.cm?.dom.isConnected)`,
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await obEval(
        vaultId,
        `String(app.vault.getFiles().filter(f=>f.name.startsWith('zotlit-excerpt-')).length===${state}.assets)`,
      ),
    ).toBe("true");
    for (const mode of [
      "success",
      "ink",
      "supersede",
      "edit",
      "escape",
      "switch",
      "disabled",
      "close",
    ] as const) {
      await obEval(
        vaultId,
        `(()=>{
        const s=${state};s.editor=s.leaf.view.editor;s.editor.setValue('before TARGET after');s.editor.setSelection({line:0,ch:7},{line:0,ch:13});
        app.workspace.setActiveLeaf(s.leaf,{focus:true});s.started=false;s.finished=0;s.error=null;
        s.services.settings.update({'attachment.import':${mode !== "disabled"}});
        s.gate=new Promise(resolve=>s.release=resolve);
        s.services.noteFeature.prepareAnnotationInsert=async options=>{s.started=true;s.options=options;await s.gate;try{return await s.original(options);}catch(e){s.error=String(e);throw e;}finally{s.finished++;}};
        const a=s.view.snapshot.annotations.find(a=>a.key==='${mode === "ink" ? "TYY6Z6ZF" : "FDRFQ7C2"}');
        const button=s.view.contentEl.querySelector('button');s.view.gestures.onMoreOptions({currentTarget:button},a);
        const menu=Array.from(s.view.contentEl.doc.querySelectorAll('.menu-item')).find(el=>el.textContent.trim()==='Insert into note');
        if(!menu||menu.classList.contains('is-disabled'))throw new Error('Insert menu unavailable');menu.click();return true;
      })()`,
      );
      expect(
        await obEvalUntil(vaultId, `String(${state}.started)`, {
          expected: "true",
        }),
      ).toBe(true);
      await obEval(
        vaultId,
        `(()=>{const s=${state};
        ${mode === "edit" ? "s.editor.cm.dispatch({changes:{from:0,insert:'user '}});s.editor.setCursor({line:0,ch:0});" : ""}
        ${mode === "supersede" ? "s.view.gestures.onMoreOptions({currentTarget:s.view.contentEl.querySelector('button')},s.view.snapshot.annotations.find(a=>a.key==='FDRFQ7C2'));Array.from(s.view.contentEl.doc.querySelectorAll('.menu-item')).find(el=>el.textContent.trim()==='Insert into note').click();" : ""}
        ${mode === "escape" ? "const win=s.editor.cm.dom.ownerDocument.defaultView;win.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));" : ""}
        ${mode === "switch" ? "s.other=app.workspace.getLeaf('tab');s.other.openFile(s.otherFile).then(()=>{app.workspace.setActiveLeaf(s.other,{focus:true});s.release();});return true;" : ""}
        ${mode === "close" ? "s.leaf.detach();" : ""}
        s.release();return true;})()`,
      );
      expect(
        await obEvalUntil(
          vaultId,
          `String(${state}.finished===${mode === "supersede" ? 2 : 1})`,
          {
            expected: "true",
          },
        ),
      ).toBe(true);
      const text =
        mode === "close"
          ? await obEval(vaultId, `app.vault.read(${state}.file)`)
          : (JSON.parse(
              await obEval(
                vaultId,
                `JSON.stringify(${state}.editor.getValue())`,
              ),
            ) as string);
      if (mode === "escape" || mode === "switch" || mode === "close") {
        expect(text).toBe("before TARGET after");
      } else if (mode === "disabled") {
        expect(text).toContain("zt-annotation=FDRFQ7C2");
        expect(text).not.toContain("![[");
      } else {
        expect(text).toContain("![[");
        expect(text).toContain("zotlit-excerpt-");
        expect(text.split("zotlit-excerpt-")).toHaveLength(2);
        expect(
          await obEvalUntil(
            vaultId,
            `String(Array.from(${state}.editor.cm.dom.querySelectorAll('img')).some(img=>img.src.includes('zotlit-excerpt-')&&img.complete&&img.naturalWidth>0))`,
            { expected: "true" },
          ),
        ).toBe(true);
        expect(
          text.startsWith(mode === "edit" ? "user before " : "before "),
        ).toBe(true);
        if (mode === "success") {
          const folder = join(
            await getWorkspaceRoot(import.meta.dirname),
            ".scratch/e2e-screenshots",
          );
          await mkdir(folder, { recursive: true });
          await cli([
            `vault=${vaultId}`,
            "dev:screenshot",
            `path=${join(folder, `1175-${host}.png`)}`,
          ]);
        }
        await obEval(vaultId, `${state}.editor.undo();true`);
        expect(await obEval(vaultId, `${state}.editor.getValue()`)).toBe(
          mode === "edit" ? "user before TARGET after" : "before TARGET after",
        );
      }
      if (mode === "switch")
        await obEval(vaultId, `${state}.other.detach();true`);
    }
  } finally {
    await obEval(
      vaultId,
      `(async()=>{const s=${state};if(!s)return true;try{s.release?.();if(s.original)s.services.noteFeature.prepareAnnotationInsert=s.original;if(s.link)app.fileManager.generateMarkdownLink=s.link;if(s.importEnabled!==undefined)s.services.settings.update({'attachment.import':s.importEnabled});}finally{try{if(s.layout)await app.workspace.changeLayout(s.layout);}finally{delete window.__zotlitInsertTrial;}}return true;})()`,
    );
  }
}
