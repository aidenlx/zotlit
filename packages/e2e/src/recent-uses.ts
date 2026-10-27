// Uses observed through real note navigation, Recent, empty search and Query CLI.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import {
  cli,
  cliCommand,
  obEval,
  obEvalUntil,
  obJson,
  obReadUntil,
} from "./obsidian-cli.ts";
import { PAGE } from "./page-gestures.ts";

const services = "app.plugins.plugins.zotlit.services";
const target = "AAAAAAAA";
const targetPath = "literatures/AAAAAAAA.md";
const sourcePath = "Use navigation.md";
const targetTitle = "Alpha of the personal library";
const targetCitekey = "personalAlpha2024";
const sourceText = "[[literatures/AAAAAAAA]]\n\n[@personalAlpha2024]\n";

/** Failure modes: a route misses a Use, browsing records one, or restore reorders. */
export async function verifyRecentUses(
  vaultId: string,
  vaultPath: string,
  reloadWindow: () => Promise<void>,
) {
  const m = await import("@obsidian-messages");
  const run = (body: string) =>
    obEval(vaultId, `(async()=>{${PAGE}const s=${services};${body}})()`);
  const originalNote = await readFile(join(vaultPath, targetPath), "utf8");
  const saved = await obEval(
    vaultId,
    `JSON.stringify({layout:app.workspace.getLayout(),settings:${services}.bridge.runSync(${services}.settings.current),ledger:app.loadLocalStorage('zotlit-use-ledger')??null})`,
  );
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(async () => {
    const restored = await obEval(
      vaultId,
      `(async()=>{app.workspace.requestActiveLeafEvents.run();const oldServices=app.plugins.plugins.zotlit.services;await app.plugins.disablePlugin('zotlit');for(let i=0;i<200&&(!oldServices.bridge.closed()||oldServices.bridge.runSync(oldServices.pdfAnnotationEditor.bindings).length>0);i++)await new Promise(r=>setTimeout(r,25));if((!oldServices.bridge.closed()||oldServices.bridge.runSync(oldServices.pdfAnnotationEditor.bindings).length>0))throw new Error('The ZotLit services did not close');app.saveLocalStorage('zotlit-use-ledger',JSON.parse(${JSON.stringify(saved)}).ledger);await app.plugins.enablePlugin('zotlit');return JSON.stringify(Object.fromEntries(Object.entries(app.plugins.plugins.zotlit.services.bridge.runSync(app.plugins.plugins.zotlit.services.useLedger.current)).map(([key,use])=>[key,{kind:use.kind,instant:Temporal.Instant.fromEpochMilliseconds(use.instant.epochMilliseconds).toString()}])));})()`,
    );
    expect(JSON.parse(restored)).toEqual(JSON.parse(saved).ledger ?? {});
  });
  cleanup.defer(async () => {
    await run(
      `await app.vault.modify(app.vault.getFileByPath('${targetPath}'),${JSON.stringify(originalNote)});const saved=JSON.parse(${JSON.stringify(saved)});s.bridge.runSync(s.settings.update({'library.document':saved.settings['library.document']??null,'citation.pandoc-citations':saved.settings['citation.pandoc-citations'],'citation.open-as-links':saved.settings['citation.open-as-links']}));await s.bridge.runPromise(s.settings.flush);await app.workspace.changeLayout(saved.layout);const file=app.vault.getFileByPath(${JSON.stringify(sourcePath)});if(file)await app.vault.delete(file);return true;`,
    );
  });
  await run(
    `app.workspace.getLeavesOfType('zotlit-library').forEach(l=>l.detach());s.bridge.runSync(s.settings.update({'library.document':null,'citation.pandoc-citations':true,'citation.open-as-links':true}));await s.bridge.runPromise(s.settings.flush);await app.vault.create(${JSON.stringify(sourcePath)},${JSON.stringify(sourceText)});app.commands.executeCommandById('zotlit:open-library-view');await until('Recent view',()=>app.workspace.getLeavesOfType('zotlit-library')[0]?.view.query);return true;`,
  );

  const timeline = async () => {
    const envelope = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: {
          from: "items",
          fields: "indexedKey,lastActivity",
          sort: "-lastActivity",
          limit: "all",
        },
      }),
    ) as {
      ok: boolean;
      rows: { indexedKey: string; values: { lastActivity: string | null } }[];
    };
    expect(envelope.ok).toBe(true);
    return envelope.rows;
  };
  const source = (mode = "source") =>
    run(
      `const leaf=app.workspace.getLeaf(false);await leaf.openFile(app.vault.getFileByPath(${JSON.stringify(sourcePath)}),{state:{mode:${JSON.stringify(mode)},source:${mode === "source"}}});app.workspace.setActiveLeaf(leaf,{focus:true});app.workspace.requestActiveLeafEvents.run();return true;`,
    );
  const first = async (key: string, reason = "opened") => {
    await obReadUntil<string[]>(
      vaultId,
      `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;if(!view?.query)return '[]';await view.query.settled;return JSON.stringify([...view.contentEl.querySelectorAll('[data-query-papers-row]')].map(n=>n.getAttribute('data-query-papers-row')));})()`,
      { ready: (rows) => rows[0] === key, what: `Recent to put ${key} first` },
    );
    expect(
      await obJson(
        vaultId,
        `(async()=>JSON.stringify((await ${services}.itemLookup.search('',{limit:1})).map(h=>h.item.indexedKey)))()`,
      ),
    ).toEqual([key]);
    expect((await timeline())[0]?.indexedKey).toBe(key);
    const metadata = await obJson<string>(
      vaultId,
      `(()=>{const row=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl.querySelector('[data-query-papers-row="${key}"]');return JSON.stringify(row.querySelector('[data-query-papers-title]').parentElement.lastElementChild.textContent);})()`,
    );
    expect(metadata).toContain(`${reason} `);
    expect(metadata.endsWith("in Obsidian")).toBe(true);
  };
  const quick = async (choose: boolean, alt = false) => {
    await run(
      `app.commands.executeCommandById('zotlit:note-quick-switcher');const input=await until('quick switcher',()=>activeDocument.querySelector('.prompt input'));${choose ? "input.value='Alpha of the personal library';input.dispatchEvent(new Event('input',{bubbles:true}));" : ""}const row=await until('Alpha suggestion',()=>[...activeDocument.querySelectorAll('.prompt .suggestion-item')].find(n=>n.textContent.includes('Alpha of the personal library')));${choose ? "row.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}));" : "if(row!==activeDocument.querySelector('.prompt .suggestion-item'))throw Error('Empty quick switcher did not put Alpha first');"}input.dispatchEvent(new KeyboardEvent('keydown',{key:'${choose ? "Enter" : "Escape"}',code:'${choose ? "Enter" : "Escape"}',keyCode:${choose ? 13 : 27},which:${choose ? 13 : 27},altKey:${alt},bubbles:true}));await until('switcher closes',()=>!activeDocument.querySelector('.prompt'));return true;`,
    );
  };
  /** Open an empty Citation Suggester and assert its first paper. */
  const emptyCitationFirst = (cited = false) =>
    run(
      `const leaf=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path===${JSON.stringify(sourcePath)});await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});const editor=leaf.view.editor;editor.setValue(${JSON.stringify(cited ? `[@${targetCitekey}]\n\n` : "")});await leaf.view.save();${cited ? `await until('document citations',async()=>(await s.bridge.runPromise(s.citationIndex.getDocumentCitationSet(leaf.view.file))).citations.some(c=>c.indexedKey==='${target}'));` : ""}editor.setCursor(editor.offsetToPos(editor.getValue().length));editor.focus();const cm=editor.cm;cm.dispatch(cm.state.replaceSelection('[@'),{userEvent:'input.type'});const popup=await until('Citation Suggester',()=>[...activeDocument.querySelectorAll('.suggestion-container')].at(-1));const row=await until('first citation',()=>popup.querySelector('.suggestion-item'));if(!row.textContent.includes(${JSON.stringify(targetTitle)}))throw Error('Empty Citation Suggester did not put Alpha first: '+row.textContent);${cited ? `if(![...row.querySelectorAll('.zt-suggestion-flair-inline,.zt-suggestion-flair-text')].some(el=>el.checkVisibility()&&el.textContent===${JSON.stringify(m.citation_suggester_cited_in_note())}))throw Error('Cited paper has no visible label');` : ""}activeWindow.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));await until('Citation Suggester closes',()=>!popup.isConnected);return true;`,
    );

  for (const route of [
    "quick switcher",
    "Library row",
    "wikilink",
    "file explorer",
    "citekey",
  ] as const) {
    await run(
      `await app.workspace.openLinkText('literatures/CCCC3333.md','');app.workspace.requestActiveLeafEvents.run();return true;`,
    );
    await first("CCCC3333");
    await source(route === "wikilink" ? "preview" : "source");
    if (route === "quick switcher") await quick(true);
    if (route === "Library row")
      await run(
        `const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});await leaf.view.query.settled;const row=await until('Alpha row',()=>leaf.view.contentEl.querySelector('[data-query-item-row="AAAAAAAA"]'));row.click();row.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return true;`,
      );
    if (route === "wikilink")
      await run(
        `const link=await until('wikilink',()=>app.workspace.activeLeaf.view.containerEl.querySelector('a.internal-link[data-href="literatures/AAAAAAAA"]'));link.click();return true;`,
      );
    if (route === "file explorer")
      await run(
        `const leaf=app.workspace.getLeavesOfType('file-explorer')[0];app.workspace.leftSplit.expand();await app.workspace.revealLeaf(leaf);leaf.view.revealInFolder(app.vault.getFileByPath('${targetPath}'));const row=await until('explorer file row',()=>leaf.view.fileItems['${targetPath}'].selfEl.isConnected&&leaf.view.fileItems['${targetPath}'].selfEl);row.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));return true;`,
      );
    if (route === "citekey")
      await run(
        `app.workspace.activeLeaf.view.editor.setCursor({line:2,ch:8});app.commands.executeCommandById('zotlit:open-citekey');return true;`,
      );
    await first(target);
    await quick(false);
  }

  // The tab stays open while another note is used, then becomes active again.
  await run(
    `const target=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path==='${targetPath}');const other=app.workspace.getLeaf('tab');await other.openFile(app.vault.getFileByPath('literatures/CCCC3333.md'));app.workspace.requestActiveLeafEvents.run();await app.workspace.revealLeaf(target);app.workspace.setActiveLeaf(target,{focus:true});app.workspace.requestActiveLeafEvents.run();return true;`,
  );
  await first(target);
  const beforeReload = await timeline();
  const ledger = await obEval(
    vaultId,
    `JSON.stringify(Object.fromEntries(Object.entries(${services}.bridge.runSync(${services}.useLedger.current)).map(([key,use])=>[key,{kind:use.kind,instant:Temporal.Instant.fromEpochMilliseconds(use.instant.epochMilliseconds).toString()}])))`,
  );
  const local = await obEval(
    vaultId,
    "JSON.stringify(app.loadLocalStorage('zotlit-use-ledger'))",
  );
  expect(JSON.parse(local)).toMatchObject({ AAAAAAAA: { kind: "opened" } });
  const pluginData = await readFile(
    join(vaultPath, ".obsidian/plugins/zotlit/data.json"),
    "utf8",
  );
  expect(pluginData).not.toContain("zotlit-use-ledger");
  for (const use of Object.values(JSON.parse(ledger)) as { instant: string }[])
    expect(pluginData).not.toContain(use.instant);
  await cli([`vault=${vaultId}`, "plugin:reload", "id=zotlit"]);
  expect(
    await obEvalUntil(vaultId, `String(!!${services})`, { expected: "true" }),
  ).toBe(true);
  expect(await timeline()).toEqual(beforeReload);
  expect(
    await obEval(
      vaultId,
      `JSON.stringify(Object.fromEntries(Object.entries(${services}.bridge.runSync(${services}.useLedger.current)).map(([key,use])=>[key,{kind:use.kind,instant:Temporal.Instant.fromEpochMilliseconds(use.instant.epochMilliseconds).toString()}])))`,
    ),
  ).toBe(ledger);
  await reloadWindow();
  expect(await timeline()).toEqual(beforeReload);
  expect(
    await obEval(
      vaultId,
      `JSON.stringify(Object.fromEntries(Object.entries(${services}.bridge.runSync(${services}.useLedger.current)).map(([key,use])=>[key,{kind:use.kind,instant:Temporal.Instant.fromEpochMilliseconds(use.instant.epochMilliseconds).toString()}])))`,
    ),
  ).toBe(ledger);
  await run(
    "const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});return true;",
  );
  await first(target);

  // Selecting a Citation Suggester result records the cited paper after the
  // editor accepts its text. Recent and the next empty suggester both agree.
  await run(
    `await app.workspace.openLinkText('literatures/CCCC3333.md','');app.workspace.requestActiveLeafEvents.run();return true;`,
  );
  await first("CCCC3333");
  await source();
  await run(
    `const leaf=app.workspace.activeLeaf;const editor=leaf.view.editor;editor.setValue('');editor.focus();const cm=editor.cm;for(const ch of ${JSON.stringify(`[@${targetTitle}`)}){cm.dispatch(cm.state.replaceSelection(ch),{userEvent:'input.type'});await new Promise(resolve=>setTimeout(resolve,70));}const popup=await until('Citation Suggester',()=>[...activeDocument.querySelectorAll('.suggestion-container')].at(-1));const row=await until('Alpha citation',()=>[...popup.querySelectorAll('.suggestion-item')].find(n=>!n.closest('[aria-busy]')&&n.textContent.includes(${JSON.stringify(targetTitle)})));row.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}));row.dispatchEvent(new MouseEvent('click',{bubbles:true}));await until('citation inserted',()=>editor.getValue()===${JSON.stringify(`[@${targetCitekey}]`)});return true;`,
  );
  await first(target, "cited");
  await emptyCitationFirst();
  await run(
    `await app.workspace.openLinkText('literatures/CCCC3333.md','');app.workspace.requestActiveLeafEvents.run();return true;`,
  );
  await first("CCCC3333");
  // A paper the note cites leads the empty suggester over a newer paper.
  await source();
  await emptyCitationFirst(true);

  // Dragging a Library row into the note runs the same successful insert
  // decision. The Use is visible through Recent and an empty suggester.
  await run(
    `await app.workspace.openLinkText('literatures/CCCC3333.md','');app.workspace.requestActiveLeafEvents.run();return true;`,
  );
  await first("CCCC3333");
  await run(
    `const note=app.workspace.getLeaf('split');await note.openFile(app.vault.getFileByPath(${JSON.stringify(sourcePath)}),{state:{mode:'source',source:true}});const editor=note.view.editor;editor.setValue('');const cm=editor.cm;const library=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(library);await library.view.query.settled;const row=await until('Alpha row',()=>library.view.contentEl.querySelector('[data-query-item-row="${target}"]'));row.scrollIntoView({block:'center',behavior:'instant'});const transfer=new DataTransfer();row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));const at=cm.coordsAtPos(0);if(!at)throw Error('Citation destination is not visible');cm.contentDOM.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:Math.floor(at.left+1),clientY:Math.floor((at.top+at.bottom)/2)}));row.dispatchEvent(new DragEvent('dragend',{bubbles:true}));await until('dragged citation inserted',()=>editor.getValue()===${JSON.stringify(`[@${targetCitekey}]`)});return true;`,
  );
  await first(target, "cited");
  await emptyCitationFirst();
  await run(
    `const leaves=app.workspace.getLeavesOfType('markdown').filter(l=>l.view.file?.path===${JSON.stringify(sourcePath)});for(const leaf of leaves)leaf.view.editor.setValue(${JSON.stringify(sourceText)});for(const leaf of leaves)await leaf.view.save();return true;`,
  );

  // Annotation follow, row selection and the Reading Card consume no Use.
  const beforeBrowse = await timeline();
  await run(
    `app.commands.executeCommandById('zotlit:open-annot-view');app.commands.executeCommandById('zotlit:annot-view-follow-active-tab');const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});await leaf.view.query.settled;leaf.view.contentEl.querySelector('[data-query-item-row="CCCC3333"]').click();await until('Reading Card',()=>leaf.view.contentEl.querySelector('[data-library-card]')?.checkVisibility());return true;`,
  );
  expect(await timeline()).toEqual(beforeBrowse);
  await source("preview");
  await run(
    `const leaf=app.workspace.activeLeaf;const targetEl=await until('preview link',()=>leaf.view.containerEl.querySelector('a.internal-link'));const rect=targetEl.getBoundingClientRect();app.workspace.trigger('hover-link',{event:new MouseEvent('mouseover',{clientX:rect.left+5,clientY:rect.top+5,ctrlKey:true,metaKey:true}),source:'preview',hoverParent:leaf.view,targetEl,linktext:'literatures/AAAAAAAA',sourcePath:'${sourcePath}'});await until('Literature Note preview',()=>activeDocument.querySelector('.hover-popover .markdown-embed'),10000);const popover=leaf.view.hoverPopover;if(popover)typeof popover.hide==='function'?popover.hide():popover.unload();return true;`,
  );
  expect(await timeline()).toEqual(beforeBrowse);
  await quick(true, true);
  expect(await timeline()).toEqual(beforeBrowse);

  // Call the registered handlers that receive the Companion's URI, keeping
  // its update navigation while excluding that operation's activation only.
  await source();
  const beforeUpdate = await timeline();
  await run(
    `const file=app.vault.getFileByPath('${targetPath}');const modified=file.stat.mtime;app.workspace.protocolHandler.handlers.get('zotlit/update')({action:'zotlit/update',item:'1','source-id':s.bridge.runSync(s.zoteroPrefService.current).sourceId,scope:'metadata'});await until('Companion update',()=>file.stat.mtime!==modified,10000);return true;`,
  );
  expect(await timeline()).toEqual(beforeUpdate);
  await source();
  await run(
    `app.workspace.protocolHandler.handlers.get('zotlit/open')({action:'zotlit/open',item:'1','source-id':s.bridge.runSync(s.zoteroPrefService.current).sourceId});await until('Companion open',()=>app.workspace.getActiveFile()?.path==='${targetPath}');app.workspace.requestActiveLeafEvents.run();return true;`,
  );
  const afterOpen = await timeline();
  expect(afterOpen[0]?.indexedKey).toBe(target);
  expect(afterOpen[0]?.values.lastActivity).not.toBe(
    beforeUpdate[0]?.values.lastActivity,
  );
}
