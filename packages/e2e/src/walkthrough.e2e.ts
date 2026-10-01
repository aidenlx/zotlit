import { rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
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
  const measure=(cm)=>new Promise(resolve=>cm.requestMeasure({read:()=>null,write:resolve}));
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

  it("detects a late Companion installation without another focus event", async () => {
    const m = await import("@obsidian-messages");
    const profilePath = join(fixture, "zotero-profile");
    expect(
      await obEval(
        vaultId,
        "app.plugins.plugins.zotlit.services.zoteroPref.resolvedProfileDir",
      ),
    ).toBe(profilePath);
    await using cleanup = new AsyncDisposableStack();
    const addonsPath = join(profilePath, "extensions.json");
    await writeFile(addonsPath, JSON.stringify({ addons: [] }), { flag: "wx" });
    cleanup.defer(() => rm(addonsPath));
    const step = `(()=>{const content=app.workspace.getLeavesOfType('zotlit-welcome')[0]?.view.contentEl;const heading=[...content?.querySelectorAll('[role=heading]')??[]].find(el=>[${JSON.stringify(m.welcome_step_companion_title())},${JSON.stringify(m.welcome_step_companion_installed_title())}].includes(el.textContent));return heading?.parentElement;})()`;
    await obEval(
      vaultId,
      "for(const leaf of app.workspace.getLeavesOfType('zotlit-welcome'))leaf.detach();app.commands.executeCommandById('zotlit:open-welcome-view');true",
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(!!(${step})?.querySelector('button'))`,
        { expected: "true" },
      ),
    ).toBe(true);
    const result = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{
      ${browserWaits}
      const step=()=>${step};
      using events=new DisposableStack();
      const win=step().ownerDocument.defaultView;
      let focusEvents=0;
      const onFocus=()=>focusEvents++;
      win.addEventListener('focus',onFocus);
      events.defer(()=>win.removeEventListener('focus',onFocus));
      await require('node:fs/promises').writeFile(${JSON.stringify(addonsPath)},${JSON.stringify(JSON.stringify({ addons: [{ id: "zotlit@aidenlx.site", active: true }] }))});
      await waitFor(()=>!!step()?.previousElementSibling.querySelector('.lucide-check'),true,'Installed Companion step');
      const current=step();
      return JSON.stringify({title:current.querySelector('[role=heading]').textContent,description:current.querySelector('p').textContent,installAction:!!current.querySelector('button'),focusEvents});
    })()`,
      ),
    );
    expect(result).toEqual({
      title: m.welcome_step_companion_installed_title(),
      description: m.settings_db_companion_desc(),
      installAction: false,
      focusEvents: 0,
    });
  });

  it("shows Cited by counts only while following a literature note", async () => {
    const m = await import("@obsidian-messages");
    const result = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{
        ${browserWaits}
        await using cleanup=new AsyncDisposableStack();
        // Ioannidis is cited only in this Fixture chapter; other walkthroughs cite Rougier.
        const chapter=app.vault.getFileByPath('Thesis/Chapter 3 - Presenting the results.md');
        const original=await app.vault.read(chapter);
        cleanup.defer(()=>app.vault.modify(chapter,original));
        await app.vault.modify(chapter,'A chapter without citations.');
        const literature=cleanup.adopt(await app.vault.create('Uncited literature.md','---\\nzotero-key: DMIANART\\n---\\nA literature note.'),file=>app.vault.delete(file));
        const plain=cleanup.adopt(await app.vault.create('Ordinary note.md','An ordinary note.'),file=>app.vault.delete(file));
        const leaf=cleanup.adopt(app.workspace.getLeaf('tab'),leaf=>leaf.detach());
        await leaf.openFile(literature);app.workspace.setActiveLeaf(leaf,{focus:true});
        app.commands.executeCommandById('zotlit:show-cited-by');
        const content=()=>app.workspace.getLeavesOfType('zotlit-cited-by')[0]?.view.contentEl;
        const empty=()=>content()?.querySelector('[data-cited-by-empty]')?.textContent;
        const stats=()=>content()?.querySelector('[data-cited-by-stats]')?.textContent??null;
        await waitFor(empty,${JSON.stringify(m.cited_by_empty())},'Uncited literature note');
        const before=stats();
        await leaf.openFile(plain);app.workspace.setActiveLeaf(leaf,{focus:true});
        await waitFor(empty,${JSON.stringify(m.cited_by_open_literature_note())},'Ordinary note');
        const withoutTarget=stats();
        await leaf.openFile(literature);app.workspace.setActiveLeaf(leaf,{focus:true});
        await waitFor(empty,${JSON.stringify(m.cited_by_empty())},'Restored literature target');
        return JSON.stringify({before,withoutTarget,after:stats()});
      })()`,
      ),
    );
    const zeroCounts = `${m.cited_by_note_count({ count: 0 })} · ${m.cited_by_occurrence_count({ count: 0 })}`;
    expect(result).toEqual({
      before: zeroCounts,
      withoutTarget: null,
      after: zeroCounts,
    });
  });

  it("shows export destinations within the named vault when the format changes", async () => {
    const m = await import("@obsidian-messages");
    const vault = basename(path);
    const result = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{
        ${browserWaits}
        await using cleanup=new AsyncDisposableStack();
        const file=cleanup.adopt(await app.vault.create('Export display.md','A draft.'),file=>app.vault.delete(file));
        const leaf=cleanup.adopt(app.workspace.getLeaf('tab'),leaf=>leaf.detach());
        await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});
        const doc=leaf.view.containerEl.ownerDocument;
        const dialog=()=>[...doc.querySelectorAll('.modal')].find(el=>el.querySelector('.modal-title')?.textContent==='Export with citations');
        cleanup.defer(()=>dialog()?.parentElement.querySelector('.modal-bg')?.click());
        app.commands.executeCommandById('zotlit:pandoc-export');
        await waitFor(()=>!!dialog(),true,'Export dialog');
        const modal=dialog();
        const row=[...modal.querySelectorAll('.setting-item')].find(el=>el.querySelector('.setting-item-name')?.textContent==='Save to');
        const word=row.querySelector('.setting-item-description').textContent;
        const format=modal.querySelector('select');format.value='html';
        format.dispatchEvent(new format.ownerDocument.defaultView.Event('change',{bubbles:true}));
        return JSON.stringify({word,html:row.querySelector('.setting-item-description').textContent,vault:app.vault.getName(),absolutePathShown:modal.textContent.includes(app.vault.adapter.getBasePath())});
      })()`,
      ),
    );
    expect(result.word).toBe(
      m.pandoc_export_destination_in_vault({
        path: "Export display.docx",
        vault,
      }),
    );
    expect(result.html).toBe(
      m.pandoc_export_destination_in_vault({
        path: "Export display.html",
        vault,
      }),
    );
    expect(result.absolutePathShown).toBe(false);
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

  it("places a plain-click caret inside a formatted citation and keeps selections", async () => {
    const source = "Before [@rougier2014, p. 1] after\n\nEnd";
    await obEval(
      vaultId,
      `(async()=>{
        const file=await app.vault.create('Citation click.md',${JSON.stringify(source)});
        const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf,{focus:true});window.focus();
        leaf.view.editor.setCursor({line:2,ch:3});leaf.view.editor.focus();return true;
      })()`,
    );
    const view =
      "app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.file?.path==='Citation click.md').view";
    expect(
      await obEvalUntil(
        vaultId,
        `String(!!(${view}).contentEl.querySelector('.zt-citation'))`,
        { expected: "true" },
      ),
    ).toBe(true);
    const result = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{
          ${browserWaits}
          const view=${view},editor=view.editor;
          const debugger_=require('@electron/remote').getCurrentWebContents().debugger;
          const gesture=async(kind)=>{
            editor.setCursor({line:2,ch:3});editor.focus();
            await waitFor(()=>editor.cm.hasFocus&&!!view.contentEl.querySelector('.zt-citation'),true,'Citation widget');
            await measure(editor.cm);
            const element=view.contentEl.querySelector('.zt-citation');
            const box=element.getBoundingClientRect();
            const start={x:box.x+box.width/2,y:box.y+box.height/2};
            const end=kind==='drag'?{x:box.right+35,y:start.y}:start;
            const modifiers=kind==='extend'?8:0;
            await debugger_.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',clickCount:1,modifiers});
            if(kind==='drag')await debugger_.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...end,button:'left',buttons:1});
            await debugger_.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',...end,button:'left',clickCount:1,modifiers});
            await measure(editor.cm);
            return {cursor:editor.getCursor(),selection:editor.getSelection(),source:editor.getValue(),formatted:!!view.contentEl.querySelector('.zt-citation')};
          };
          return JSON.stringify({plain:await gesture('plain'),drag:await gesture('drag'),extend:await gesture('extend')});
        })()`,
      ),
    );
    expect(result.plain.cursor.line).toBe(0);
    expect(result.plain.cursor.ch).toBeGreaterThan(source.indexOf("["));
    expect(result.plain.cursor.ch).toBeLessThan(source.indexOf("]") + 1);
    expect(result.plain.selection).toBe("");
    expect(result.plain.formatted).toBe(false);
    expect(result.drag.selection.length).toBeGreaterThan(0);
    expect(result.extend.selection.length).toBeGreaterThan(0);
    for (const gesture of [result.plain, result.drag, result.extend]) {
      expect(gesture.source).toBe(source);
    }
    const navigation = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{
          ${browserWaits}
          const view=${view};
          const debugger_=require('@electron/remote').getCurrentWebContents().debugger;
          const service=app.plugins.plugins.zotlit.services.citekeyEditor;
          const tab=app.plugins.plugins.zotlit.settingTab;
          const previous=tab.getControlValue('citation.open-as-links');
          const original=service.openCitekey,requests=[];
          await using restore=new AsyncDisposableStack();
          restore.defer(async()=>{service.openCitekey=original;await tab.setControlValue('citation.open-as-links',previous);});
          service.openCitekey=async(...args)=>{requests.push(args);};
            for(const openAsLinks of [false,true]){
              await tab.setControlValue('citation.open-as-links',openAsLinks);
              view.editor.setCursor({line:2,ch:3});view.editor.focus();
              await waitFor(()=>view.editor.cm.hasFocus&&!!view.contentEl.querySelector('.zt-citation'),true,'Citation navigation widget');
              await measure(view.editor.cm);
              const box=view.contentEl.querySelector('.zt-citation').getBoundingClientRect();
              const modifiers=openAsLinks?0:process.platform==='darwin'?4:2;
              for(const type of ['mousePressed','mouseReleased'])await debugger_.sendCommand('Input.dispatchMouseEvent',{type,x:box.x+box.width/2,y:box.y+box.height/2,button:'left',clickCount:1,modifiers});
            }
            return JSON.stringify(requests);
        })()`,
      ),
    );
    expect(navigation).toEqual([
      ["rougier2014", "tab"],
      ["rougier2014", false],
    ]);
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

  it("keeps the viewport and unsaved writing when an update replaces multiple callouts", async () => {
    const notePath = "Scroll update.md";
    const source =
      "---\nzotero-key: DMRGRART\n---\n%%zt-managed%%\nstale\n%%/zt-managed%%\n";
    await obEval(
      vaultId,
      `(async()=>{
        const file=await app.vault.create(${JSON.stringify(notePath)},${JSON.stringify(source)});
        const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file,{state:{mode:'source',source:false}});
        app.workspace.setActiveLeaf(leaf,{focus:true});window.focus();return true;
      })()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(notePath)}))?.frontmatter?.['zotero-key']==='DMRGRART')`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `app.commands.executeCommandById('zotlit:update-note');true`,
    );
    const view = `app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.file?.path===${JSON.stringify(notePath)}).view`;
    expect(
      await obEvalUntil(
        vaultId,
        `String((${view}).editor.getValue().split('[!note]').length>2)`,
        { expected: "true" },
      ),
    ).toBe(true);
    const result = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{
          ${browserWaits}
          const view=${view},editor=view.editor,cm=editor.cm;
          let changed=0;
          const edited=editor.getValue().replaceAll('[!note]',()=>++changed<=2?'[!quote]':'[!note]')+'\\nUnsaved researcher text.';
          editor.setValue(edited);
          editor.setCursor({line:7,ch:0});await measure(cm);editor.scrollTo(null,600);await measure(cm);
          const before={top:cm.scrollDOM.scrollTop,height:cm.scrollDOM.scrollHeight,cursor:editor.getCursor()};
          const accepted=app.commands.executeCommandById('zotlit:update-note');
          await waitFor(()=>editor.getValue().includes('[!quote]'),false,'Updated callouts');
          await measure(cm);
          const after={top:cm.scrollDOM.scrollTop,height:cm.scrollDOM.scrollHeight,cursor:editor.getCursor()};
          const updated=editor.getValue();editor.undo();const undoMatches=editor.getValue()===edited;
          editor.redo();const redoMatches=editor.getValue()===updated;
          return JSON.stringify({accepted,before,after,undoMatches,redoMatches,updated:!updated.includes('[!quote]'),unsaved:updated.includes('Unsaved researcher text.')});
        })()`,
      ),
    );
    expect(result.accepted).toBe(true);
    expect(result.updated).toBe(true);
    expect(result.unsaved).toBe(true);
    expect(result.undoMatches).toBe(true);
    expect(result.redoMatches).toBe(true);
    expect(result.before.top).toBe(600);
    expect(result.after.cursor).toEqual(result.before.cursor);
    expect(result.after.height).toBe(result.before.height);
    expect(Math.abs(result.after.top - result.before.top)).toBeLessThan(2);
    expect(
      await obEvalUntil(
        vaultId,
        `(async()=>String((await app.vault.read(app.vault.getFileByPath(${JSON.stringify(notePath)}))).includes('Unsaved researcher text.')))()`,
        { expected: "true" },
      ),
    ).toBe(true);
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
  it("stores a typed property rule and note name that YAML has to quote as the text the reader typed", async () => {
    const m = await import("@obsidian-messages");
    const rule = 'zt.creators | map: "fullName"';
    const name = "{{ zt.title | replace: ':', '-' }}";
    const result = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{
          ${browserWaits}
          await using cleanup=new AsyncDisposableStack();
          const profile=app.plugins.plugins.zotlit.services.profile;
          await profile.materializeDefault();
          const file=app.vault.getFileByPath(profile.defaultDocumentPath);
          const original=await app.vault.read(file);
          cleanup.defer(async()=>{
            for(const type of ['zotlit-template-workbench','zotlit-template-data-explorer','zotlit-note-preview'])
              for(const leaf of app.workspace.getLeavesOfType(type))leaf.detach();
            await app.vault.modify(file,original);
          });
          // The built-in Profile writes its note name as a block scalar, which
          // YAML holds as written; a hand-written Profile quotes it.
          const lines=original.split('\\n');
          const at=lines.indexOf('filename: |');
          if(at<0)throw new Error('Block note name');
          lines.splice(at,2,"filename: '"+lines[at+1].trim().replaceAll("'","''")+"'");
          await app.vault.modify(file,lines.join('\\n'));
          const leaf=cleanup.adopt(app.workspace.getLeaf('tab'),leaf=>leaf.detach());
          await leaf.openFile(file);
          app.workspace.setActiveLeaf(leaf,{focus:true});
          app.commands.executeCommandById('zotlit:customize-profile');
          const view=()=>app.workspace.getLeavesOfType('zotlit-template-workbench')[0]?.view;
          await waitFor(()=>!!view()?.contentEl.querySelector('[role="tab"]'),true,'Profile Editor');
          const el=view().contentEl;
          const open=(label)=>Array.from(el.querySelectorAll('[role="tab"]')).find(tab=>tab.textContent===label).click();
          const type=(content,text)=>{
            const cm=content.cmTile.view;
            cm.focus();
            cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:text},selection:{anchor:text.length},userEvent:'input.type'});
            return ()=>cm.state.doc.toString();
          };
          open(${JSON.stringify(m.workbench_tab_properties())});
          const toggleOf=()=>Array.from(el.querySelectorAll('button[aria-controls][aria-expanded]')).find(button=>button.closest('li')?.innerText.startsWith('title\\n'));
          await waitFor(()=>!!toggleOf(),true,'Title property row');
          const toggle=toggleOf();
          toggle.click();
          const ruleEditor=()=>el.ownerDocument.getElementById(toggle.getAttribute('aria-controls'))?.querySelector('.cm-content');
          await waitFor(()=>!!ruleEditor(),true,'Title rule editor');
          const ruleShown=type(ruleEditor(),${JSON.stringify(rule)});
          const storedRule=${JSON.stringify(`expr: '${rule}'`)};
          await waitFor(()=>view().data.includes(storedRule),true,'Stored rule');
          open(${JSON.stringify(m.workbench_tab_name_and_folder())});
          const nameEditor=()=>Array.from(el.querySelectorAll('.cm-content')).find(content=>el.ownerDocument.getElementById(content.getAttribute('aria-labelledby'))?.textContent===${JSON.stringify(m.workbench_name_filename_label())});
          await waitFor(()=>!!nameEditor(),true,'Note name editor');
          const nameShown=type(nameEditor(),${JSON.stringify(name)});
          const storedName=${JSON.stringify(`filename: '${name.replaceAll("'", "''")}'`)};
          await waitFor(()=>view().data.includes(storedName),true,'Stored note name');
          return JSON.stringify({
            rule:ruleShown(),
            name:nameShown(),
            invalid:el.textContent.includes(${JSON.stringify(m.workbench_problem_invalid_manifest())}),
          });
        })()`,
      ),
    );
    expect(result).toEqual({ rule, name, invalid: false });
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

  it("keeps a switched note's subfolder under the target Profile's folder", async () => {
    const created = JSON.parse(
      await obEval(
        vaultId,
        `(async()=>{
          const {profile}=app.plugins.plugins.zotlit.services;
          const books=await profile.create({label:'Books',bindings:{folder:'books'}});
          const folder=profile.resolveProfile('default').bindings['note.literature-folder'].replace(/^\\/+|\\/+$/g,'');
          const dir=(folder?folder+'/':'')+'2024';
          if(!app.vault.getAbstractFileByPath(dir))await app.vault.createFolder(dir);
          const file=await app.vault.create(dir+'/Subfolder move.md','---\\nzotero-key: DMRGRART\\n---\\nMy reading notes\\n');
          const leaf=app.workspace.getLeaf('tab');
          await leaf.openFile(file);
          app.workspace.setActiveLeaf(leaf,{focus:true});
          return JSON.stringify({id:books.id,path:file.path});
        })()`,
      ),
    ) as { id: string; path: string };
    expect(
      await obEvalUntil(
        vaultId,
        `String(app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(created.path)}))?.frontmatter?.['zotero-key']==='DMRGRART')`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `app.commands.executeCommandById('zotlit:switch-literature-note-profile')`,
    );
    const target = "books/2024/Subfolder move.md";
    const row = `Array.from(Array.from(activeDocument.querySelectorAll('.prompt')).at(-1)?.querySelectorAll('.suggestion-item')??[]).find(el=>el.textContent.includes(${JSON.stringify(target)}))`;
    expect(
      await obEvalUntil(vaultId, `String(!!(${row}))`, { expected: "true" }),
    ).toBe(true);
    await obEval(vaultId, `(${row}).click();true`);
    const move = `(()=>{const modal=Array.from(activeDocument.querySelectorAll('.modal')).at(-1);return Array.from(modal?.querySelectorAll('input[type=checkbox]')??[]).find(input=>{for(let el=input.parentElement;el&&el!==modal;el=el.parentElement){if(el.querySelectorAll('input[type=checkbox]').length>1)return false;if(el.textContent.includes('Move to books/2024/'))return true;}return false;});})()`;
    expect(
      await obEvalUntil(vaultId, `String(!!${move})`, { expected: "true" }),
    ).toBe(true);
    await obEval(vaultId, `${move}.click();true`);
    expect(
      await obEvalUntil(
        vaultId,
        `(()=>{const modal=Array.from(activeDocument.querySelectorAll('.modal')).at(-1);const button=Array.from(modal?.querySelectorAll('button')??[]).find(el=>el.textContent.trim()==='Switch to “Books”');if(!button)return false;button.click();return true;})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await obEvalUntil(
        vaultId,
        `String(app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(target)}))?.frontmatter?.['zotlit-profile']??'')`,
        { expected: `Books (${created.id})` },
      ),
    ).toBe(true);
    expect(
      await obEval(
        vaultId,
        `(async()=>{
          const moved=app.vault.getFileByPath(${JSON.stringify(target)});
          const body=await app.vault.read(moved);
          const left=!!app.vault.getAbstractFileByPath(${JSON.stringify(created.path)});
          await app.vault.delete(moved);
          const {profile}=app.plugins.plugins.zotlit.services;
          await app.vault.delete(app.vault.getFileByPath(profile.profiles.find(p=>p.id===${JSON.stringify(created.id)}).path));
          app.workspace.detachLeavesOfType('empty');
          return String(!left&&body.includes('My reading notes'));
        })()`,
      ),
    ).toBe("true");
  });

  it("creates a Profile from a name alone in Add profile and opens it on Name and folder", async () => {
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
    const dialog = `Array.from(activeDocument.querySelectorAll('.modal')).find(el=>el.querySelector('.modal-title')?.textContent==='Add profile')`;
    const status = `(${dialog})?.querySelector('p[role="status"]')`;
    expect(
      await obEvalUntil(vaultId, `String((${status})?.textContent)`, {
        expected: "Enter a unique profile name whose filename is not default.",
      }),
    ).toBe(true);
    expect(
      await obEval(
        vaultId,
        `String((${status}).classList.contains('zt:text-(--text-error)'))`,
      ),
    ).toBe("false");
    const action = `Array.from((${dialog}).querySelectorAll('.modal-button-container button')).find(el=>el.textContent==='Add profile')`;
    expect(await obEval(vaultId, `String((${action}).disabled)`)).toBe("true");
    await obEval(
      vaultId,
      `(()=>{const input=Array.from((${dialog}).querySelectorAll('label')).find(el=>el.firstChild?.textContent==='Name').querySelector('input');input.value='Reading group';input.dispatchEvent(new input.ownerDocument.defaultView.Event('input',{bubbles:true}));return true;})()`,
    );
    expect(
      await obEvalUntil(vaultId, `String((${action}).disabled)`, {
        expected: "false",
      }),
    ).toBe(true);
    await obEval(vaultId, `(${action}).click();true`);
    const editor = `app.workspace.getLeavesOfType('zotlit-template-workbench').map(leaf=>leaf.view).find(view=>view.file?.name==='zotlit-profile.reading-group.md')`;
    expect(
      await obEvalUntil(vaultId, `String((${editor})?.store.getState().tab)`, {
        expected: "name",
      }),
    ).toBe(true);
    expect(
      await obEval(
        vaultId,
        `app.vault.read((${editor}).file).then(text=>String(/^folder:/m.test(text)))`,
      ),
    ).toBe("false");
  });
});
