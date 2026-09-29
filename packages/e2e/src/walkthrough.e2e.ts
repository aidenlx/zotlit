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
