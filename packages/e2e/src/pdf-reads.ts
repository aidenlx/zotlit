// Real PDF navigation, with the ledger and rendered Recent order as observers.
import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";

import { cli, obEval, obJson, obReadUntil } from "./obsidian-cli.ts";
import { PAGE } from "./page-gestures.ts";

const services = "app.plugins.plugins.zotlit.services";
const path = "attachments/rougier-2014.pdf";
const itemKey = "RUGIER24";
const attachmentKey = "RGRPDF24";

// Failure modes: an open route misses its parent; restoration counts as a read;
// page renders count as turns; close is missed; a standalone PDF records a Use.
export async function verifyPdfReads(
  vaultId: string,
  databasePath: string,
  reloadWindow: () => Promise<void>,
) {
  const run = (body: string) =>
    obEval(vaultId, `(async()=>{${PAGE}const s=${services};${body}})()`);
  const ledger = () =>
    obJson<Record<string, { kind: string; instant: string }>>(
      vaultId,
      `JSON.stringify(Object.fromEntries(Object.entries(${services}.bridge.runSync(${services}.useLedger.current)).map(([key,use])=>[key,{kind:use.kind,instant:Temporal.Instant.fromEpochMilliseconds(use.instant.epochMilliseconds).toString()}])))`,
    );
  const saved = await obEval(
    vaultId,
    `JSON.stringify({layout:app.workspace.getLayout(),settings:${services}.bridge.runSync(${services}.settings.current),ledger:app.loadLocalStorage('zotlit-use-ledger')??null})`,
  );
  using db = new DatabaseSync(databasePath);
  const attachment = db
    .prepare(
      "SELECT itemID,parentItemID FROM itemAttachments JOIN items USING(itemID) WHERE key=?",
    )
    .get(attachmentKey) as { itemID: number; parentItemID: number };
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(async () => {
    const restored = await obEval(
      vaultId,
      `(async()=>{app.workspace.requestActiveLeafEvents.run();const oldServices=app.plugins.plugins.zotlit.services;await app.plugins.disablePlugin('zotlit');for(let i=0;i<200&&(!oldServices.bridge.closed()||oldServices.bridge.runSync(oldServices.pdfAnnotationEditor.bindings).length>0);i++)await new Promise(r=>setTimeout(r,25));if((!oldServices.bridge.closed()||oldServices.bridge.runSync(oldServices.pdfAnnotationEditor.bindings).length>0))throw new Error('The ZotLit services did not close');app.saveLocalStorage('zotlit-use-ledger',JSON.parse(${JSON.stringify(saved)}).ledger);await app.plugins.enablePlugin('zotlit');return JSON.stringify(Object.fromEntries(Object.entries(app.plugins.plugins.zotlit.services.bridge.runSync(app.plugins.plugins.zotlit.services.useLedger.current)).map(([key,use])=>[key,{kind:use.kind,instant:Temporal.Instant.fromEpochMilliseconds(use.instant.epochMilliseconds).toString()}])));})()`,
    );
    expect(JSON.parse(restored)).toEqual(JSON.parse(saved).ledger ?? {});
  });
  cleanup.defer(async () => {
    db.prepare("UPDATE itemAttachments SET parentItemID=? WHERE itemID=?").run(
      attachment.parentItemID,
      attachment.itemID,
    );
    await run(
      `app.workspace.getLeavesOfType('pdf').forEach(l=>l.detach());const saved=JSON.parse(${JSON.stringify(saved)});s.bridge.runSync(s.settings.update({'library.document':saved.settings['library.document']??null}));await s.bridge.runPromise(s.settings.flush);await app.workspace.changeLayout(saved.layout);await s.bridge.runPromise(s.zoteroReads.refresh);return true;`,
    );
  });
  await run(
    "app.workspace.getLeavesOfType('pdf').forEach(l=>l.detach());app.workspace.getLeavesOfType('zotlit-library').forEach(l=>l.detach());s.bridge.runSync(s.settings.update({'library.document':null}));await s.bridge.runPromise(s.settings.flush);app.commands.executeCommandById('zotlit:open-library-view');await until('Recent',()=>app.workspace.getLeavesOfType('zotlit-library')[0]?.view.query);return true;",
  );
  const opened = () =>
    run(
      `await until('PDF and resolved Attachment',()=>{const leaf=app.workspace.getLeavesOfType('pdf').find(l=>l.view.file?.path==='${path}');return (leaf?.view.viewer?.child?.pdfViewer?.pdfViewer?.pagesCount??0)>0&&leaf.view.viewer.child.getPage(1)?.pdfPage&&s.bridge.runSync(s.pdfAnnotationEditor.bindings).find((b)=>b.filePath==='${path}')?.session?.target?.attachmentKey==='${attachmentKey}';},20000);return true;`,
    );
  const open = () =>
    run(`await app.workspace.openLinkText('${path}','',true);return true;`);
  const close = () =>
    run(
      "app.workspace.getLeavesOfType('pdf').forEach(l=>l.detach());app.workspace.requestActiveLeafEvents.run();return true;",
    );
  await run(
    `app.workspace.protocolHandler.handlers.get('zotlit/open-attachment')({action:'zotlit/open-attachment',item:'${attachment.itemID}','source-id':s.bridge.runSync(s.zoteroPrefService.current).sourceId});return true;`,
  );
  await opened();
  expect((await ledger())[itemKey]?.kind).toBe("read");
  await obReadUntil<string[]>(
    vaultId,
    `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0].view;await view.query.settled;return JSON.stringify([...view.contentEl.querySelectorAll('[data-query-papers-row]')].map(n=>n.getAttribute('data-query-papers-row')));})()`,
    { ready: (keys) => keys[0] === itemKey, what: "PDF read first in Recent" },
  );
  const reason = await obJson<string>(
    vaultId,
    `(()=>{const row=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl.querySelector('[data-query-papers-row="${itemKey}"]');return JSON.stringify(row.querySelector('[data-query-papers-title]').parentElement.lastElementChild.textContent);})()`,
  );
  expect(reason).toContain("read ");
  expect(reason.endsWith("in Obsidian")).toBe(true);
  await run(
    `app.commands.executeCommandById('zotlit:note-quick-switcher');await until('PDF parent first in quick switcher',()=>activeDocument.querySelector('.prompt .suggestion-item')?.textContent.includes('Ten Simple Rules for Better Figures'));activeDocument.querySelector('.prompt input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));return true;`,
  );
  const firstRead = (await ledger())[itemKey]!;
  // A real page transition reaches PDF.js's pagechanging event; rendering and
  // immediate turns stay inside the five-minute limit established by open.
  await run(
    `const view=app.workspace.getLeavesOfType('pdf')[0].view;const reader=view.viewer.child;window.__ztPageChanges=0;reader.on('pagechanging',()=>window.__ztPageChanges++);reader.applySubpath('#page=2');await until('real page change',()=>window.__ztPageChanges>0);return true;`,
  );
  expect((await ledger())[itemKey]).toEqual(firstRead);
  await cli([`vault=${vaultId}`, "plugin:reload", "id=zotlit"]);
  await opened();
  expect((await ledger())[itemKey]).toEqual(firstRead);
  await reloadWindow();
  await opened();
  expect((await ledger())[itemKey]).toEqual(firstRead);
  await run(
    `const reader=app.workspace.getLeavesOfType('pdf')[0].view.viewer.child;const page=reader.getPage(reader.pdfViewer.pdfViewer.currentPageNumber);page.reset();await page.draw();return true;`,
  );
  expect((await ledger())[itemKey]).toEqual(firstRead);
  // The restored reader may turn pages later. A fresh plugin has no page
  // throttle history, so this real transition proves the subscription records.
  await run(
    `const reader=app.workspace.getLeavesOfType('pdf')[0].view.viewer.child;reader.applySubpath(reader.pdfViewer.pdfViewer.currentPageNumber===1?'#page=2':'#page=1');await until('page read',()=>s.bridge.runSync(s.useLedger.get('${itemKey}'))?.instant.epochMilliseconds!==Temporal.Instant.from(${JSON.stringify(firstRead.instant)}).epochMilliseconds);return true;`,
  );
  const pageRead = (await ledger())[itemKey]!;
  await close();
  expect((await ledger())[itemKey]?.instant).not.toBe(pageRead.instant);
  const closed = (await ledger())[itemKey]!;
  await run(
    `const leaf=app.workspace.getLeavesOfType('file-explorer')[0];app.workspace.leftSplit.expand();await app.workspace.revealLeaf(leaf);leaf.view.revealInFolder(app.vault.getFileByPath('${path}'));const row=await until('PDF file explorer row',()=>leaf.view.fileItems['${path}']?.selfEl);row.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));return true;`,
  );
  await opened();
  expect((await ledger())[itemKey]?.instant).not.toBe(closed.instant);
  await close();
  // Turn the Fixture Attachment into a standalone one, then reload the plugin
  // to resolve it from the actual database rather than an old held path index.
  db.prepare("UPDATE itemAttachments SET parentItemID=NULL WHERE itemID=?").run(
    attachment.itemID,
  );
  await cli([`vault=${vaultId}`, "plugin:reload", "id=zotlit"]);
  const beforeStandalone = await ledger();
  await open();
  await opened();
  expect(
    await obJson(
      vaultId,
      `JSON.stringify(${services}.bridge.runSync(${services}.pdfAnnotationEditor.bindings).find((b)=>b.filePath==='${path}')?.session.target)`,
    ),
  ).toMatchObject({ attachmentKey, itemKey: null });
  await run(
    `app.workspace.getLeavesOfType('pdf')[0].view.viewer.child.applySubpath('#page=2');return true;`,
  );
  await close();
  expect(await ledger()).toEqual(beforeStandalone);
}
