import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { keepRendering } from "./background-throttling.ts";
import { obEval, obEvalUntil } from "./obsidian-cli.ts";
import {
  clearVault,
  e2eVaultDir,
  isObsidianReachable,
  vaultScript,
} from "./vault-script.ts";

const root = await getWorkspaceRoot(import.meta.dirname);
const fixture = join(root, ".scratch/e2e-walkthrough-fixture");
const path = e2eVaultDir(root, "walkthrough-vault");
const run = vaultScript(root, fixture);
const reachable = await isObsidianReachable(root);

// These callbacks run inside Obsidian. Poll only arrivals with no completion
// promise; CodeMirror layout and native suggestion updates have their own signals.
const browserWaits = `
  const waitFor=async(read,expected,label)=>{
    using timers=new DisposableStack();
    let lastError;
    for(let attempt=0;attempt<200;attempt++){
      const actual=read();
      if(JSON.stringify(actual)===JSON.stringify(expected))return actual;
      lastError=new Error(label+': expected '+JSON.stringify(expected)+', received '+JSON.stringify(actual));
      await new Promise(resolve=>timers.adopt(setTimeout(resolve,25),clearTimeout));
    }
    throw lastError;
  };
  const pressKey=async(debugger_,key,code)=>{
    await debugger_.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code});
    await debugger_.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code});
  };
`;

describe.skipIf(!reachable)("Walkthrough regressions", () => {
  let vaultId = "";
  beforeAll(async () => {
    await clearVault(run, path);
    const opened = await run(["open", path, "--vault-case", "demo"]);
    vaultId = opened.stdout.trim().split("\n")[0]!.trim();
    await keepRendering(vaultId);
  }, 180_000);

  afterAll(async () => {
    await run(["remove", path, "--purge"]);
    await rm(fixture, { recursive: true, force: true });
  }, 120_000);

  it("starts the demo with Sync disabled", async () => {
    expect(
      await obEval(vaultId, `String(app.internalPlugins.plugins.sync.enabled)`),
    ).toBe("false");
    expect(
      await obEval(
        vaultId,
        `String(Array.from(document.querySelectorAll('.status-bar [aria-label]')).some(el=>el.getAttribute('aria-label')==='Uninitialized'))`,
      ),
    ).toBe("false");
  });

  it("opens Welcome beside the active note and reuses its tab", async () => {
    const notePath = "Welcome navigation.md";
    const noteId = await obEval(
      vaultId,
      `(async()=>{
        for(const leaf of app.workspace.getLeavesOfType('zotlit-welcome'))leaf.detach();
        const file=await app.vault.create(${JSON.stringify(notePath)},'Keep this note open.');
        const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf,{focus:true});
        app.commands.executeCommandById('zotlit:open-welcome-view');return leaf.id;
      })()`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{const leaf=app.workspace.getLeafById(${JSON.stringify(noteId)});leaf?.detach();const file=app.vault.getFileByPath(${JSON.stringify(notePath)});if(file)await app.vault.delete(file);return true;})()`,
      );
    });
    expect(
      await obEvalUntil(
        vaultId,
        `String(app.workspace.activeLeaf?.view.getViewType()==='zotlit-welcome')`,
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await obEval(
        vaultId,
        `app.workspace.getLeafById(${JSON.stringify(noteId)}).view.file?.path??'<no file>'`,
      ),
    ).toBe(notePath);
    const welcomeId = await obEval(vaultId, "app.workspace.activeLeaf.id");
    await obEval(
      vaultId,
      `app.workspace.setActiveLeaf(app.workspace.getLeafById(${JSON.stringify(noteId)}),{focus:true});app.commands.executeCommandById('zotlit:open-welcome-view');true`,
    );
    expect(
      await obEvalUntil(vaultId, "app.workspace.activeLeaf?.id", {
        expected: welcomeId,
      }),
    ).toBe(true);
    expect(
      await obEval(
        vaultId,
        "String(app.workspace.getLeavesOfType('zotlit-welcome').length)",
      ),
    ).toBe("1");
  });

  it("reuses an open literature note when searching from Welcome", async () => {
    const notePath = "Search existing note.md";
    const leafId = await obEval(
      vaultId,
      `(async()=>{
        const file=await app.vault.create(${JSON.stringify(notePath)},'---\\nzotero-key: DMRGRART\\n---\\nExisting literature note');
        const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);
        const welcome=app.workspace.getLeavesOfType('zotlit-welcome')[0]??app.workspace.getLeaf('tab');
        await welcome.setViewState({type:'zotlit-welcome',active:true});
        app.workspace.setActiveLeaf(welcome,{focus:true});return leaf.id;
      })()`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        vaultId,
        `(async()=>{for(const leaf of app.workspace.getLeavesOfType('markdown'))if(leaf.view.file?.path===${JSON.stringify(notePath)})leaf.detach();const file=app.vault.getFileByPath(${JSON.stringify(notePath)});if(file)await app.vault.delete(file);return true;})()`,
      );
    });
    expect(
      await obEvalUntil(
        vaultId,
        `String(app.plugins.plugins.zotlit.services.noteIndex.getNotesByItemKey('DMRGRART').some(file=>file.path===${JSON.stringify(notePath)}))`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(()=>{app.commands.executeCommandById('zotlit:note-quick-switcher');const input=activeDocument.querySelector('.prompt-input');input.value='ten simple';input.dispatchEvent(new input.ownerDocument.defaultView.Event('input',{bubbles:true}));return true;})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(activeDocument.querySelector('.prompt-results')?.textContent.includes('Ten Simple Rules for Better Figures'))`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(async()=>{${browserWaits}
          const debugger_=activeWindow.require('@electron/remote').getCurrentWebContents().debugger;
          await pressKey(debugger_,'Enter',13);return true;
        })()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(app.workspace.activeLeaf?.view.file?.path===${JSON.stringify(notePath)})`,
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      JSON.parse(
        await obEval(
          vaultId,
          `JSON.stringify({count:app.workspace.getLeavesOfType('markdown').filter(leaf=>leaf.view.file?.path===${JSON.stringify(notePath)}).length,active:app.workspace.activeLeaf.id})`,
        ),
      ),
    ).toEqual({ count: 1, active: leafId });
  });

  it("keeps the citation suggester closed while entering a page locator", async () => {
    await obEval(
      vaultId,
      `(async()=>{
        const file=await app.vault.create('Citation locator.md','');
        const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf,{focus:true});window.focus();leaf.view.editor.focus();
        await require('@electron/remote').getCurrentWebContents().debugger.sendCommand('Input.insertText',{text:'[@ten'});
        return true;
      })()`,
    );
    const suggester =
      "app.workspace.editorSuggest.suggests.find(suggest=>suggest.constructor.name==='CitationEditorSuggest')";
    expect(
      await obEvalUntil(
        vaultId,
        `String((${suggester}).isOpen&&(${suggester}).suggestEl.textContent.includes('Ten Simple Rules for Better Figures'))`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(async()=>{${browserWaits}
        const debugger_=activeWindow.require('@electron/remote').getCurrentWebContents().debugger;
        await pressKey(debugger_,'Enter',13);return true;
      })()`,
    );
    const editor =
      "app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.file?.path==='Citation locator.md').view.editor";
    expect(
      await obEvalUntil(vaultId, `(${editor}).getValue()`, {
        expected: "[@rougier2014]",
      }),
    ).toBe(true);
    const result = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{
          ${browserWaits}
          const debugger_=require('@electron/remote').getCurrentWebContents().debugger;
          const editor=${editor},suggest=${suggester},manager=app.workspace.editorSuggest;
          const originalTrigger=manager.trigger,originalShow=suggest.showSuggestions;
          const updated=Promise.withResolvers();
          using hooks=new DisposableStack();
          hooks.defer(()=>{manager.trigger=originalTrigger;suggest.showSuggestions=originalShow;});
          hooks.adopt(setTimeout(()=>updated.reject(new Error('Native citation suggestion update did not finish')),5000),clearTimeout);
          let triggering=false,shown=false;
          const entered=()=>editor.getValue()==='[@rougier2014, p]'&&editor.getCursor().ch===16;
          manager.trigger=function(...args){
            const relevant=args[0]===editor&&entered();
            if(relevant)triggering=true;
            const result=originalTrigger.apply(this,args);
            if(relevant){triggering=false;if(suggest.context===null||shown)updated.resolve();}
            return result;
          };
          suggest.showSuggestions=function(...args){
            const result=originalShow.apply(this,args);
            if(entered()&&suggest.context?.query==='rougier2014, p'){
              shown=true;if(!triggering)updated.resolve();
            }
            return result;
          };
          await pressKey(debugger_,'ArrowLeft',37);
          await debugger_.sendCommand('Input.insertText',{text:', p'});
          await updated.promise;
          const open=suggest.isOpen,before=editor.getValue();
          await pressKey(debugger_,'Enter',13);
          return JSON.stringify({open,before,after:editor.getValue()});
        })()`,
      ),
    );
    expect(result.before).toBe("[@rougier2014, p]");
    expect(result.open).toBe(false);
    expect(result.after).toContain(", p");
  });

  it("refreshes and closes citation settings without cleanup errors", async () => {
    const result = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{
          ${browserWaits}
          app.setting.close();
          const tab=app.plugins.plugins.zotlit.settingTab;
          const controls=[['Pandoc citations','citation.pandoc-citations'],['Wikilink citations','citation.wikilink-citations']];
          const previous=controls.map(([,key])=>tab.getControlValue(key));
          const popout=app.vault.getConfig('settingsPopoutWindow');
          const originalError=console.error;
          const errors=[];
          await using restore=new AsyncDisposableStack();
          restore.defer(async()=>{
            app.setting.close();console.error=originalError;
            for(let i=0;i<controls.length;i++)await tab.setControlValue(controls[i][1],previous[i]);
            app.vault.setConfig('settingsPopoutWindow',popout);
          });
          console.error=(...args)=>{errors.push(args.map(value=>value instanceof Error?value.message:String(value)).join(' '));originalError(...args);};
            app.vault.setConfig('settingsPopoutWindow',false);
            app.setting.open();app.setting.openTabById('zotlit');
            const row=(name)=>Array.from(app.setting.containerEl.querySelectorAll('.setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent===name);
            row('Citations').click();
            const tutorial=!!row('Pandoc citation tutorial')?.querySelector('button');
            const changed=[];
            for(const [name,key] of controls){
              const initial=tab.getControlValue(key);
              for(const expected of [!initial,initial]){
                const tutorialButton=row('Pandoc citation tutorial').querySelector('button');
                row(name).querySelector('.checkbox-container').click();
                await waitFor(()=>({value:tab.getControlValue(key),refreshed:row('Pandoc citation tutorial').querySelector('button')!==tutorialButton}),{value:expected,refreshed:true},'Citation settings refresh');
                changed.push(tab.getControlValue(key)===expected);
              }
            }
            app.setting.close();
            return JSON.stringify({tutorial,changed,errors});
        })()`,
      ),
    );
    expect(result.tutorial).toBe(true);
    expect(result.changed).toEqual([true, true, true, true]);
    expect(result.errors).toEqual([]);
  });

  it("updates the active literature note from its editor, title, and Properties", async () => {
    const initial =
      "---\nzotero-key: DMRGRART\n---\n%%zt-managed%%\nstale\n%%/zt-managed%%";
    await obEval(
      vaultId,
      `(async()=>{
        const file=await app.vault.create('Focus update.md',${JSON.stringify(initial)});
        const leaf=app.workspace.getLeaf('tab');
        await leaf.openFile(file,{state:{mode:'source',source:false}});
        app.workspace.setActiveLeaf(leaf,{focus:true});return true;
      })()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(app.metadataCache.getFileCache(app.vault.getFileByPath('Focus update.md'))?.frontmatter?.['zotero-key']==='DMRGRART')`,
        { expected: "true" },
      ),
    ).toBe(true);
    for (const selector of [
      ".cm-content",
      ".inline-title",
      ".metadata-property-key-input",
    ]) {
      const result = JSON.parse(
        await obEval(
          vaultId,
          `(async()=>{
            ${browserWaits}
            const view=app.workspace.getActiveFileView(), editor=view.editor;
            editor.setValue(editor.getValue().replace('%%zt-managed%%','%%zt-managed%%\\nFOCUS_UPDATE_SENTINEL'));
            const target=view.containerEl.querySelector(${JSON.stringify(selector)});
            if(!target)throw Error('Missing focus target');
            target.focus();
            const focused=target===target.ownerDocument.activeElement;
            const accepted=app.commands.executeCommandById('zotlit:update-note');
            await waitFor(()=>editor.getValue().includes('FOCUS_UPDATE_SENTINEL'),false,'Literature note update');
            return JSON.stringify({focused,accepted,updated:!editor.getValue().includes('FOCUS_UPDATE_SENTINEL')});
          })()`,
        ),
      );
      expect(result, selector).toEqual({
        focused: true,
        accepted: true,
        updated: true,
      });
    }
  });

  it.each(["built-in", "customized"])(
    "opens the %s template in its popout without displaying a main-window Workbench tab",
    async (kind) => {
      const notePath = `Popout ${kind}.md`;
      await obEval(
        vaultId,
        `(async()=>{
          for(const type of ['zotlit-template-workbench','zotlit-template-data-explorer','zotlit-note-preview'])
            for(const leaf of app.workspace.getLeavesOfType(type))leaf.detach();
          const profile=app.plugins.plugins.zotlit.services.profile;
          ${kind === "built-in" ? "await profile.restoreDefault();" : "await profile.materializeDefault();"}
          const file=await app.vault.create(${JSON.stringify(notePath)},'---\\nzotero-key: DMRGRART\\n---\\n# Popout');
          const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);
          app.workspace.setActiveLeaf(leaf,{focus:true});return true;
        })()`,
      );
      expect(
        await obEvalUntil(
          vaultId,
          `String(app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(notePath)}))?.frontmatter?.['zotero-key']==='DMRGRART')`,
          { expected: "true" },
        ),
      ).toBe(true);
      const result = JSON.parse(
        await obEval(
          vaultId,
          `(async()=>{
            ${browserWaits}
            const editors=()=>app.workspace.getLeavesOfType('zotlit-template-workbench');
            let mainSamples=0;
            const sample=()=>{for(const leaf of editors()){
              const el=leaf.view.containerEl;
              if(el.ownerDocument===document&&el.isConnected&&el.getBoundingClientRect().width>0)mainSamples++;
            }};
            using resources=new DisposableStack();
            const observer=resources.adopt(new MutationObserver(sample),value=>value.disconnect());
            observer.observe(document.body,{childList:true,subtree:true});
            resources.adopt(setInterval(sample,10),clearInterval);
              const accepted=app.commands.executeCommandById('zotlit:customize-note-template');
              const ready=()=>editors().some(leaf=>leaf.view.file&&leaf.view.containerEl.ownerDocument!==document)
                &&app.workspace.getLeavesOfType('zotlit-note-preview').length>0
                &&app.workspace.getLeavesOfType('zotlit-template-data-explorer').length>0;
              await waitFor(ready,true,'Template Workbench and companion views');
              sample();
              return JSON.stringify({accepted,ready:ready(),mainSamples,
                customized:!!app.vault.getFileByPath(app.plugins.plugins.zotlit.services.profile.defaultDocumentPath)});
          })()`,
        ),
      );
      expect(result).toEqual({
        accepted: true,
        ready: true,
        mainSamples: 0,
        customized: true,
      });
    },
  );

  it("finds a paper in Choose item and previews its callouts with native paragraph styling", async () => {
    await obEval(
      vaultId,
      `(async()=>{
      const profile=app.plugins.plugins.zotlit.services.profile;
      await profile.materializeDefault();
      const leaf=app.workspace.getLeaf('tab');
      await leaf.openFile(app.vault.getFileByPath(profile.defaultDocumentPath));
      app.workspace.setActiveLeaf(leaf,{focus:true});
      app.commands.executeCommandById('zotlit:customize-profile');return true;
    })()`,
    );
    const editor =
      "app.workspace.getLeavesOfType('zotlit-template-workbench')[0]?.view";
    expect(
      await obEvalUntil(
        vaultId,
        `String(!!(${editor})?.contentEl.querySelector('.zt-selection-trigger'))`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(${editor}).contentEl.querySelector('.zt-selection-trigger').click();true`,
    );
    const prompt = "activeDocument.querySelector('.prompt')";
    expect(
      await obEvalUntil(
        vaultId,
        `String(!!(${prompt})?.querySelector('input'))`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(()=>{const input=(${prompt}).querySelector('input');input.value='rougier';input.dispatchEvent(new input.ownerDocument.defaultView.Event('input',{bubbles:true}));return true;})()`,
    );
    const result = `Array.from((${prompt})?.querySelectorAll('.suggestion-item')??[]).find(row=>row.textContent.includes('Ten Simple Rules for Better Figures'))`;
    expect(
      await obEvalUntil(vaultId, `String(!!(${result}))`, { expected: "true" }),
    ).toBe(true);
    await obEval(
      vaultId,
      `(()=>{const row=${result};row.dispatchEvent(new row.ownerDocument.defaultView.MouseEvent('mousemove',{bubbles:true}));row.click();return true;})()`,
    );
    const preview =
      "app.workspace.getLeavesOfType('zotlit-note-preview')[0]?.view.contentEl";
    expect(
      await obEvalUntil(
        vaultId,
        `String((${preview})?.querySelectorAll('.callout').length>0&&!(${preview}).querySelector('[data-zotlit-preview-pending]'))`,
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await obEval(
        vaultId,
        `String(Array.from((${preview}).querySelectorAll('.callout p')).some(p=>p.classList.contains('zt:bg-accent')))`,
      ),
    ).toBe("false");
  });
  it("keeps Annotation fields and preview when Customize reopens its workbench", async () => {
    await obEval(
      vaultId,
      `(async()=>{
        const file=await app.vault.create('Reopen workbench.md','---\\nzotero-key: DMRGRART\\n---\\n# Workbench context');
        const leaf=app.workspace.getLeaf('tab');
        await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});return true;
      })()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(app.metadataCache.getFileCache(app.vault.getFileByPath('Reopen workbench.md'))?.frontmatter?.['zotero-key']==='DMRGRART')`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `app.commands.executeCommandById('zotlit:customize-note-template');true`,
    );
    const editor =
      "app.workspace.getLeavesOfType('zotlit-template-workbench')[0]?.view";
    expect(
      await obEvalUntil(
        vaultId,
        `String(!!(${editor})?.contentEl.querySelector('[role="tab"]'))`,
        { expected: "true" },
      ),
    ).toBe(true);
    await keepRendering(vaultId);
    await obEval(
      vaultId,
      `Array.from((${editor}).contentEl.querySelectorAll('[role="tab"]')).find(tab=>tab.textContent==='Annotation').click();true`,
    );
    const contexts = `(()=>({
      tab:(${editor}).store.getState().tab,
      editor:(${editor}).store.getState().root,
      preview:app.workspace.getLeavesOfType('zotlit-note-preview')[0]?.view.getState().root,
      fields:app.workspace.getLeavesOfType('zotlit-template-data-explorer')[0]?.view.getState().root
    }))()`;
    const expected = {
      tab: "annotation",
      editor: "annotation",
      preview: "annotation",
      fields: "annotation",
    };
    expect(
      await obEvalUntil(
        vaultId,
        `String(JSON.stringify(${contexts})===${JSON.stringify(JSON.stringify(expected))})`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(async()=>{
        const note=app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.file?.path==='Reopen workbench.md');
        await app.workspace.revealLeaf(note);app.workspace.setActiveLeaf(note,{focus:true});
        return app.commands.executeCommandById('zotlit:customize-note-template');
      })()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(app.workspace.activeLeaf===(${editor}).leaf)`,
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      JSON.parse(await obEval(vaultId, `JSON.stringify(${contexts})`)),
    ).toEqual(expected);
  });

  it("shows the initial Add profile requirement as a neutral folder hint", async () => {
    await obEval(
      vaultId,
      `app.vault.setConfig('settingsPopoutWindow',false);app.setting.open();true`,
    );
    await obEval(vaultId, `app.setting.openTabById('zotlit');true`);
    await obEval(
      vaultId,
      `app.setting.navigateToSearchResult({tab:app.setting.activeTab,pagePath:['settings_page_profiles']});true`,
    );
    const add = `app.setting.containerEl.querySelector('[aria-label="Add profile"]')`;
    expect(
      await obEvalUntil(vaultId, `String(!!(${add}))`, { expected: "true" }),
    ).toBe(true);
    await obEval(vaultId, `(${add}).click();true`);
    const status = `Array.from(activeDocument.querySelectorAll('p[role="status"]')).find(el=>el.textContent==='Choose a different literature note folder to create a profile.')`;
    expect(
      await obEvalUntil(vaultId, `String(!!(${status}))`, { expected: "true" }),
    ).toBe(true);
    expect(
      await obEval(
        vaultId,
        `String((${status}).classList.contains('zt:text-(--text-error)'))`,
      ),
    ).toBe("false");
  });
});
