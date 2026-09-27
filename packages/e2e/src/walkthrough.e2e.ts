import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { keepRendering } from "./background-throttling.ts";
import { obEval, obEvalUntil, WINDOW_DOCUMENTS } from "./obsidian-cli.ts";
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
    const prompt = `${WINDOW_DOCUMENTS}.map(doc=>doc.querySelector('.prompt')).find(Boolean)`;
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
    const status = `[document,app.setting.containerEl.ownerDocument].flatMap(doc=>Array.from(doc.querySelectorAll('p[role="status"]'))).find(el=>el.textContent==='Choose a different literature note folder to create a profile.')`;
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
