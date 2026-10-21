import { cp, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect } from "vitest";

import { prepareRunWindow } from "./background-throttling.ts";
import { assertDevBundleFresh } from "./bundle-freshness.ts";
import {
  e2eVaultPath,
  runVaultScript,
  workspaceRoot,
} from "./e2e-run-fixture.ts";
import { availableLoopbackPort } from "./e2e-run-helpers.ts";
import { obEval, obEvalUntil } from "./obsidian-cli.ts";
import { MENU_READY, PAGE } from "./page-gestures.ts";
import { clearVault } from "./vault-script.ts";

/** Shared End-to-end Run vault state for every area file. */
export const run = {
  vaultId: "",
  m: undefined as unknown as typeof import("@obsidian-messages"),
  booksNotePath: "",
  offlineZotero: createServer((socket) => socket.destroy()),
};

let initPromise: Promise<void> | null = null;
let refCount = 0;

async function bootstrap(): Promise<void> {
  run.m = await import("@obsidian-messages");
  await assertDevBundleFresh(workspaceRoot);
  await clearVault(runVaultScript, e2eVaultPath);
  const pluginBundleDir = join(workspaceRoot, "apps", "obsidian", "dist-dev");
  const e2ePluginDir = join(e2eVaultPath, ".obsidian", "plugins", "zotlit");
  await mkdir(e2ePluginDir, { recursive: true });
  await cp(pluginBundleDir, e2ePluginDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    run.offlineZotero.once("error", reject);
    run.offlineZotero.listen(0, "127.0.0.1", resolve);
  });
  const address = run.offlineZotero.address();
  if (address === null || typeof address === "string")
    throw new Error("Offline Zotero endpoint did not receive a TCP port");
  const created = await runVaultScript([
    "open",
    e2eVaultPath,
    `--zotero-http-port=${address.port}`,
  ]);
  run.vaultId = created.stdout.trim().split("\n")[0]!.trim();
  await obEval(run.vaultId, "app.vault.setConfig('nativeMenus',false);true");
  await prepareRunWindow(run.vaultId);
  const serverPort = await availableLoopbackPort();
  await obEval(
    run.vaultId,
    `app.plugins.plugins.zotlit.services.settings.update({'server.enabled':false,'server.port':${serverPort}});true`,
  );
  expect(
    await obEvalUntil(
      run.vaultId,
      `String(!app.plugins.plugins.zotlit.services.localServer.available&&app.plugins.plugins.zotlit.services.settings.current['server.port']===${serverPort})`,
      { expected: "true" },
    ),
  ).toBe(true);
  await obEval(
    run.vaultId,
    "app.plugins.plugins.zotlit.services.settings.update({'server.enabled':true});true",
  );
  expect(
    await obEvalUntil(
      run.vaultId,
      `String(app.plugins.plugins.zotlit.services.localServer.available&&app.plugins.plugins.zotlit.services.settings.current['server.port']===${serverPort})`,
      { expected: "true" },
    ),
  ).toBe(true);
}

async function teardown(): Promise<void> {
  await using _offlineZotero = run.offlineZotero;
  try {
    await runVaultScript(["remove", e2eVaultPath, "--purge"]);
  } catch (error) {
    console.warn(
      `obsidian-vault remove --purge failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** One vault per run: area files share bootstrap and teardown. */
export function registerEndToEndRunHooks(): void {
  beforeAll(async () => {
    refCount++;
    if (!initPromise) initPromise = bootstrap();
    await initPromise;
  }, 180000);

  afterAll(async () => {
    refCount--;
    if (refCount === 0 && initPromise) {
      await teardown();
      initPromise = null;
    }
  }, 120000);

  afterEach(async () => {
    const left = await obEval(
      run.vaultId,
      `(async()=>{${PAGE}const docs=()=>[document,...app.workspace.floatingSplit.children.map(split=>split.win.document)];const open=()=>docs().flatMap(doc=>[...doc.querySelectorAll('.menu, .modal-container, :popover-open')]);const left=open().map(el=>(el.matches(':popover-open')?'popover':el.classList.contains('menu')?'menu':'dialog')+': '+el.textContent.trim().slice(0,60));for(const el of open())if(el.matches(':popover-open'))el.hidePopover();await until('menus and dialogs close',async()=>{if(open().length===0)return true;await ${MENU_READY};activeDocument.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return false;},5000);return JSON.stringify(left);})()`,
    );
    expect(
      JSON.parse(left),
      "menus, dialogs and popovers the case left open",
    ).toEqual([]);
  });
}
