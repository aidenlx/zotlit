import { describe, expect, it } from "vitest";

import { ATTACHMENTS, ITEMS, LIBRARIES, NOTES } from "@zotlit/scripts/fixture";

import {
  annotationOpenKeys,
  annotationOpenSubpath,
} from "./annotation-open-subpath.ts";
import { reachable } from "./e2e-run-fixture.ts";
import {
  annotationAttachment,
  booksProfile,
  booksProfileTargetItem,
  positionDocumentItem,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { selectSuggestion } from "./e2e-run-note-helpers.ts";
import type { ItemQueryReport } from "./e2e-run-query-types.ts";
import { cliCommand, obEval, obEvalUntil, waitFor } from "./obsidian-cli.ts";
import { MENU_READY, PAGE } from "./page-gestures.ts";
import { raiseWindow } from "./reader-gestures.ts";
describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("switches a Fixture Query File view to Items and the Table, expands an Item into its Attachments, Annotations and Child Notes, and creates a Literature Note from its column", async () => {
    const path = "query-files/Reading annotations.zotquery";
    const layout = await obEval(
      run.vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const original = await obEval(
      run.vaultId,
      `app.vault.read(app.vault.getFileByPath(${JSON.stringify(path)}))`,
    );
    const created: string[] = [];
    await using cleanup = new AsyncDisposableStack();
    // The tab closes before the text goes back, so no pending save of the
    // tab writes over it.
    cleanup.defer(async () => {
      // Teardown closes a popover a failed step left open; not a reader's press.
      await obEval(
        run.vaultId,
        `(async()=>{for(const popup of activeDocument.querySelectorAll('[popover]:popover-open'))popup.hidePopover();for(const leaf of app.workspace.getLeavesOfType('zotlit-query-file'))leaf.detach();await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(path)}),${JSON.stringify(original)});for(const path of ${JSON.stringify(created)}){const file=app.vault.getFileByPath(path);if(file)await app.vault.delete(file);}await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    const tab = "app.workspace.getMostRecentLeaf().view";
    await obEval(
      run.vaultId,
      `(async()=>{const leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getFileByPath(${JSON.stringify(path)}));app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );
    expect(
      await obEvalUntil(
        run.vaultId,
        `(async()=>{const view=${tab};if(view.getViewType()!=='zotlit-query-file')return 'none';await view.query.settled;return String(view.contentEl.querySelectorAll('.zt-annot-card').length>0);})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    /** What the Table shows once its query settled. */
    const readTable = `(async()=>{const view=${tab};if(view.getViewType()!=='zotlit-query-file'||view.file?.path!==${JSON.stringify(path)})return 'null';await view.query.settled;const el=view.contentEl;const keys=kind=>[...el.querySelectorAll('[data-query-table-row="'+kind+'"]')].map(n=>n.getAttribute('data-query-key'));return JSON.stringify({header:[...el.querySelectorAll('[data-query-table] thead th')].map(n=>n.textContent),rows:[...el.querySelectorAll('[data-query-table-row]')].map(n=>[n.getAttribute('data-query-table-row'),n.getAttribute('data-query-key')]),items:keys('item'),attachments:keys('attachment'),annotations:keys('annotation'),childNotes:[...el.querySelectorAll('[data-query-table-row="note"]')].map(n=>[n.getAttribute('data-query-key'),n.textContent]),notes:Object.fromEntries([...el.querySelectorAll('[data-query-note]')].map(n=>[n.closest('tr').getAttribute('data-query-key'),n.getAttribute('data-query-note')])),create:[...el.querySelectorAll('[data-query-create-note]')].map(n=>n.getAttribute('data-query-create-note'))});})()`;
    interface Table {
      header: string[];
      /** Every row of the Table in screen order, as its kind and key. */
      rows: [string, string][];
      items: string[];
      attachments: string[];
      annotations: string[];
      childNotes: [string, string][];
      notes: Record<string, string>;
      create: string[];
    }
    const tableWhen = async (ready: (table: Table) => boolean) => {
      let table: Table | null = null;
      const settled = await waitFor(async () => {
        table = JSON.parse(
          await obEval(run.vaultId, readTable),
        ) as Table | null;
        return table !== null && ready(table);
      }, 120);
      if (!settled)
        throw new Error(`Query File Table: ${JSON.stringify(table)}`);
      return table!;
    };
    const query = async (args: Record<string, string>) => {
      const report = JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", { args }),
      ) as ItemQueryReport;
      expect(report.ok).toBe(true);
      return report.rows!;
    };

    // Configure view switches the view's rows to Items. The Layout picker
    // then offers the layouts of Items, with the Table chosen. The grouping
    // by Item, which Items lack, stays in the file, and the view says it does
    // not use it.
    await obEval(
      run.vaultId,
      `(()=>{${tab}.contentEl.querySelector('[data-query-view-menu]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));return true;})()`,
    );
    // The Configure view page this view's menu opened.
    const configurePage =
      "activeDocument.querySelector('[data-query-view-list]:popover-open [data-chooser-page]')";
    expect(
      await obEvalUntil(
        run.vaultId,
        `String(${configurePage}?.querySelector('[data-query-view-name]')?.value===${JSON.stringify("All annotations")})`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      run.vaultId,
      `(()=>{const select=${configurePage}.querySelector('[data-query-view-dataset]');select.value='items';select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
    );
    expect(
      await obEvalUntil(
        run.vaultId,
        `JSON.stringify([...${configurePage}.querySelectorAll('[data-query-view-layout] option')].map(n=>[n.textContent,n.selected]))`,
        {
          expected: JSON.stringify([
            [run.m.query_view_layout_table(), true],
            [run.m.query_view_layout_list(), false],
            [run.m.query_view_layout_cards(), false],
            [run.m.query_view_layout_papers(), false],
          ]),
        },
      ),
    ).toBe(true);
    expect(
      await obEvalUntil(
        run.vaultId,
        `String(${tab}.contentEl.querySelector('[data-query-unused]')?.textContent)`,
        {
          expected: run.m.query_view_unused({
            dataset: run.m.query_view_dataset_items(),
            properties: run.m.query_view_property_parent_item(),
          }),
        },
      ),
    ).toBe(true);
    await obEval(
      run.vaultId,
      `(()=>{${PAGE}press(${configurePage}.querySelector('[data-chooser-page-close]'),'Close');return true;})()`,
    );
    // The view saves as a Table of Items, and keeps its grouping.
    expect(
      await obEvalUntil(
        run.vaultId,
        `(async()=>{const text=await app.vault.read(app.vault.getFileByPath(${JSON.stringify(path)}));const first=text.split('name: Figures')[0];return String(first.includes(${JSON.stringify("  - type: table\n    name: All annotations\n    from: items\n")})&&first.includes('groupBy'));})()`,
        { expected: "true" },
      ),
    ).toBe(true);

    // The rows are the Items ZotLit Query gives for the view, in its order.
    const items = await query({
      from: "items",
      fields: "title",
      limit: "100",
    });
    const shown = await tableWhen((table) => table.items.length > 0);
    expect(shown.items).toEqual(items.map((row) => row.indexedKey));
    expect(shown.header.at(-1)).toBe(run.m.query_view_table_literature_note());

    // The Item expands into its Attachments, and an Attachment with
    // Annotations into those Annotations, as ZotLit Query lists them.
    const item = ITEMS.find(
      ({ itemID }) => itemID === annotationAttachment.parentItemID,
    )!.key;
    const attachments = await query({
      from: "attachments",
      filter: `item.indexedKey == "${item}"`,
      fields: "title",
      limit: "all",
    });
    const annotations = await query({
      from: "annotations",
      filter: `attachment.indexedKey == "${annotationAttachment.key}"`,
      fields: "text,pageIndex",
      sort: "sortIndex",
      limit: "all",
    });
    expect(annotations.length).toBeGreaterThan(0);
    const click = (selector: string) =>
      obEval(
        run.vaultId,
        `(()=>{${PAGE}press(${tab}.contentEl.querySelector(${JSON.stringify(selector)}),${JSON.stringify(selector)});return true;})()`,
      );
    await click(`[data-query-expand="item:${item}"]`);
    await tableWhen((table) => table.attachments.length === attachments.length);
    await click(`[data-query-expand="attachment:${annotationAttachment.key}"]`);
    const expanded = await tableWhen(
      (table) => table.annotations.length === annotations.length,
    );
    expect(expanded.attachments).toEqual(
      attachments.map((row) => row.indexedKey),
    );
    expect(expanded.annotations).toEqual(
      annotations.map((row) => row.indexedKey),
    );

    // An Attachment link opens the PDF in Obsidian's reader as an Obsidian
    // link does: a Cmd/Ctrl click and a middle click each in a new tab, so
    // the Table stays open in its own.
    // A new tab takes the focus from the Table, so the links are read off
    // the Query File's own leaf.
    const queryLeaf = "app.workspace.getLeavesOfType('zotlit-query-file')[0]";
    const link = (kind: string, key: string) =>
      `${queryLeaf}.view.contentEl.querySelector('[data-query-table-row="${kind}"][data-query-key="${key}"] [data-query-open="${kind}"]')`;
    /** A click on `el` with the buttons and keys `init` names, as an eval statement. */
    const pointer = (el: string, type: string, init: string) =>
      `{const el=${el};el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('${type}',{bubbles:true,cancelable:true,...${init}}));}`;
    const MOD_CLICK =
      "{button:0,metaKey:process.platform==='darwin',ctrlKey:process.platform!=='darwin'}";
    const MIDDLE_CLICK = "{button:1}";
    const pdfName = annotationAttachment.path!.split("/").pop()!;
    const pdfTabs = `app.workspace.getLeavesOfType('pdf').filter(l=>l.view.file?.name===${JSON.stringify(pdfName)}).length`;
    const before = Number(await obEval(run.vaultId, `String(${pdfTabs})`));
    await obEval(
      run.vaultId,
      `(()=>{${pointer(link("attachment", annotationAttachment.key), "click", MOD_CLICK)}return true;})()`,
    );
    expect(
      await obEvalUntil(run.vaultId, `String(${pdfTabs})`, {
        expected: String(before + 1),
      }),
    ).toBe(true);
    await obEval(
      run.vaultId,
      `(()=>{${pointer(link("attachment", annotationAttachment.key), "auxclick", MIDDLE_CLICK)}return true;})()`,
    );
    expect(
      await obEvalUntil(run.vaultId, `String(${pdfTabs})`, {
        expected: String(before + 2),
      }),
    ).toBe(true);
    expect(
      await obEval(
        run.vaultId,
        `String(app.workspace.getLeavesOfType('zotlit-query-file').length)`,
      ),
    ).toBe("1");

    // An Annotation link opens the PDF at the Annotation's page, with the
    // Annotation Anchor that lands on its mark.
    const anchored = annotations.find(
      (row) => typeof row.values.pageIndex === "number",
    )!;
    expect(anchored, "an Annotation has a PDF page").toBeDefined();
    expect(
      JSON.parse(
        await obEval(
          run.vaultId,
          `(async()=>{${PAGE}${annotationOpenSubpath(pointer(link("annotation", anchored.indexedKey), "auxclick", MIDDLE_CLICK))}})()`,
        ),
      ),
    ).toEqual(
      annotationOpenKeys({
        page: (anchored.values.pageIndex as number) + 1,
        annotation: anchored.indexedKey,
        attachment: annotationAttachment.key,
      }),
    );

    await obEval(
      run.vaultId,
      `(()=>{app.workspace.setActiveLeaf(${queryLeaf},{focus:true});return true;})()`,
    );

    // An Attachment Obsidian's reader cannot host, such as a web snapshot,
    // opens in Zotero's reader through its Zotero link.
    const snapshot = ATTACHMENTS.find(({ key }) => key === "HTMLSNAP")!;
    expect(snapshot.parentItemID).toBe(positionDocumentItem.itemID);
    await click(`[data-query-expand="item:${positionDocumentItem.key}"]`);
    await tableWhen((table) => table.attachments.includes(snapshot.key));
    expect(
      await obEval(
        run.vaultId,
        `(async()=>{${PAGE}const native=window.open;let opened=null;window.open=url=>{opened=String(url);return null;};try{press(${link("attachment", snapshot.key)},'snapshot link');return await until('Zotero opens the snapshot',()=>opened,10000);}finally{window.open=native;}})()`,
      ),
    ).toBe(`zotero://open/library/items/${snapshot.key}`);

    // An Item with Child Notes expands into them with their titles; its
    // trashed Child Note stays out.
    const noted = ITEMS.find(({ itemID }) => itemID === 1)!.key;
    const live = NOTES.filter(
      (note) => note.parentItemID === 1 && !note.trashed,
    );
    expect(
      NOTES.some((note) => note.parentItemID === 1 && note.trashed),
      "the Fixture Item has a trashed Child Note",
    ).toBe(true);
    await click(`[data-query-expand="item:${noted}"]`);
    const withNotes = await tableWhen(
      (table) => table.childNotes.length === live.length,
    );
    expect(withNotes.childNotes).toEqual(
      live.map((note) => [note.key, note.title]),
    );

    // An Item with both Attachments and a Child Note lists its notes after
    // its Attachments.
    const both = ITEMS.find(({ itemID }) => itemID === 57)!;
    const bothNotes = NOTES.filter(
      (note) => note.parentItemID === both.itemID && !note.trashed,
    );
    const bothAttachments = await query({
      from: "attachments",
      filter: `item.indexedKey == "${both.key}"`,
      fields: "title",
      limit: "all",
    });
    expect(bothNotes.length, "the Fixture Item has a Child Note").toBe(1);
    expect(
      bothAttachments.length,
      "the Fixture Item has Attachments",
    ).toBeGreaterThan(0);
    await click(`[data-query-expand="item:${both.key}"]`);
    const childRows = (table: Table) => {
      const start = table.rows.findIndex(
        ([kind, key]) => kind === "item" && key === both.key,
      );
      const end = table.rows.findIndex(
        ([kind], index) => index > start && kind === "item",
      );
      return table.rows.slice(start + 1, end === -1 ? undefined : end);
    };
    const withBoth = await tableWhen(
      (table) =>
        childRows(table).length === bothAttachments.length + bothNotes.length,
    );
    expect(childRows(withBoth)).toEqual([
      ...bothAttachments.map((row) => ["attachment", row.indexedKey]),
      ...bothNotes.map((note) => ["note", note.key]),
    ]);

    // "Create" asks for a Profile where more than one fits; the new
    // Literature Note, made with the Profile chosen, then shows as a link in
    // the column.
    const book = shown.create.find(
      (key) =>
        key === booksProfileTargetItem.key ||
        key.startsWith(`${booksProfileTargetItem.key}g`),
    )!;
    expect(book, "the Item has no Literature Note yet").toBeDefined();
    await click(`[data-query-create-note="${book}"]`);
    expect(await selectSuggestion(run.vaultId, booksProfile.label)).toContain(
      booksProfile.label,
    );
    await obEval(
      run.vaultId,
      "activeDocument.querySelector('.prompt input').dispatchEvent(new activeWindow.KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));true",
    );
    const linked = await tableWhen((table) => book in table.notes);
    created.push(linked.notes[book]!);
    expect(linked.create).not.toContain(book);
    expect(linked.notes[book]).toMatch(/^books\//);
    expect(
      await obEval(
        run.vaultId,
        `String(app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(linked.notes[book])}))?.frontmatter?.['zotero-key'])`,
      ),
    ).toBe(book);
  }, 180000);

  // Vault properties of Items edit in place in the Table, with trusted
  // input: a click anywhere in a cell, an empty one too, enters edit; focus
  // that leaves a list editor from an item commits it; the first edit of a
  // row with no note creates it; a vault sort and filter run (#1531).
  it("edits vault properties in the Table with real input, creates a note on a first edit, and sorts and filters by them", async () => {
    const path = "query-files/Vault properties.zotquery";
    // Two My Library Items that tie on their date, each with its seeded
    // Literature Note, and a Lab Archive Item with no note.
    const [tieFirst, tieSecond] = [11, 12].map(
      (itemID) => ITEMS.find((item) => item.itemID === itemID)!.key,
    ) as [string, string];
    const lab = LIBRARIES.find(({ libraryID }) => libraryID === 3)!;
    const fresh = `${ITEMS.find((item) => item.itemID === 9)!.key}g${lab.groupID}`;
    const notePath = (key: string) => `literatures/${key}.md`;
    const keys = JSON.stringify([tieFirst, tieSecond, fresh]);
    const viewText = (extra: string) =>
      `${[
        "views:",
        "  - type: table",
        "    name: Vault properties",
        "    from: items",
        "    filters:",
        "      and:",
        `        - '${keys}.contains(indexedKey)'`,
        extra,
        "    order:",
        "      - title",
        "      - vault.zt-status",
        "      - vault.zt-done",
        "      - vault.zt-projects",
        "      - vault.zt-rank",
        "      - vault.zt-due",
        "",
      ]
        .filter((line) => line !== "")
        .join("\n")}\n`;
    const layout = await obEval(
      run.vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const seeded = [notePath(tieFirst), notePath(tieSecond)];
    const originals = JSON.parse(
      await obEval(
        run.vaultId,
        `(async()=>JSON.stringify(await Promise.all(${JSON.stringify(seeded)}.map(path=>app.vault.read(app.vault.getFileByPath(path))))))()`,
      ),
    ) as string[];
    const created: string[] = [path];
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{for(const leaf of app.workspace.getLeavesOfType('zotlit-query-file'))leaf.detach();for(const path of ${JSON.stringify(created)}){const file=app.vault.getFileByPath(path);if(file)await app.vault.delete(file);}const originals=${JSON.stringify(originals)};for(const [at,path] of ${JSON.stringify(seeded)}.entries())await app.vault.modify(app.vault.getFileByPath(path),originals[at]);await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    await obEval(
      run.vaultId,
      `(async()=>{const set=(path,props)=>app.fileManager.processFrontMatter(app.vault.getFileByPath(path),fm=>Object.assign(fm,props));await set(${JSON.stringify(notePath(tieFirst))},{'zt-status':'unread','zt-done':false,'zt-projects':['a'],'zt-rank':1,'zt-due':'2024-05-01'});await set(${JSON.stringify(notePath(tieSecond))},{'zt-done':true,'zt-rank':2});await app.vault.create(${JSON.stringify(path)},${JSON.stringify(viewText(""))});return true;})()`,
    );
    const noteIndex = "app.plugins.plugins.zotlit.services.noteIndex";
    let indexed = "";
    expect(
      await waitFor(async () => {
        indexed = await obEval(
          run.vaultId,
          `JSON.stringify([${JSON.stringify(tieFirst)},${JSON.stringify(tieSecond)}].map(key=>[key,${noteIndex}.getNotesByItemKey(key).map(file=>file.path),app.metadataCache.getCache('literatures/'+key+'.md')?.frontmatter?.['zt-rank']??null]))`,
        );
        return (JSON.parse(indexed) as [string, string[], unknown][]).every(
          ([key, paths, rank]) =>
            paths.join() === notePath(key) && rank !== null,
        );
      }),
      indexed,
    ).toBe(true);
    await obEval(
      run.vaultId,
      `(async()=>{const leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getFileByPath(${JSON.stringify(path)}));app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );
    await raiseWindow(run.vaultId);
    const tab = "app.workspace.getLeavesOfType('zotlit-query-file')[0].view";
    /** The rows of the Table, and the state and text of each vault cell. */
    const readTable = `(async()=>{const view=${tab};if(!view)return 'null';await view.query.settled;const el=view.contentEl;return JSON.stringify({rows:[...el.querySelectorAll('[data-query-table-row="item"]')].map(n=>n.getAttribute('data-query-key')),editing:!!el.querySelector('[data-query-vault-input]'),cells:Object.fromEntries([...el.querySelectorAll('[data-query-vault-cell]')].map(n=>[n.closest('tr').getAttribute('data-query-key')+'/'+n.getAttribute('data-query-vault-name'),n.textContent]))});})()`;
    interface Table {
      rows: string[];
      editing: boolean;
      cells: Record<string, string>;
    }
    const tableWhen = async (ready: (table: Table) => boolean) => {
      let table: Table | null = null;
      const settled = await waitFor(async () => {
        table = JSON.parse(
          await obEval(run.vaultId, readTable),
        ) as Table | null;
        return table !== null && ready(table);
      }, 80);
      if (!settled) throw new Error(`Vault Table: ${JSON.stringify(table)}`);
      return table!;
    };
    await tableWhen((table) => table.rows.length === 3);
    const frontmatter = async (path: string) =>
      JSON.parse(
        await obEval(
          run.vaultId,
          `JSON.stringify(app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(path)}))?.frontmatter??null)`,
        ),
      ) as Record<string, unknown> | null;
    const frontmatterWhen = async (
      path: string,
      ready: (properties: Record<string, unknown>) => boolean,
    ) => {
      let properties: Record<string, unknown> | null = null;
      const settled = await waitFor(async () => {
        properties = await frontmatter(path);
        return properties !== null && ready(properties);
      }, 80);
      if (!settled)
        throw new Error(`${path} frontmatter: ${JSON.stringify(properties)}`);
      return properties!;
    };
    const cell = (key: string, name: string) =>
      `${tab}.contentEl.querySelector('[data-query-key="${key}"] [data-query-vault-cell][data-query-vault-name="${name}"]')`;
    /** A trusted click, of the `button` given, at the centre of the element `target` evaluates to. */
    const click = async (target: string, button: "left" | "right" = "left") =>
      expect(
        await obEval(
          run.vaultId,
          `(function(){const target=${target};if(!target)return 'missing';target.scrollIntoView({block:"center",inline:"nearest",behavior:"instant"});const rect=target.getBoundingClientRect();const zoom=require('electron').webFrame.getZoomFactor();const x=Math.round((rect.left+rect.width/2)*zoom),y=Math.round((rect.top+rect.height/2)*zoom);const contents=require('@electron/remote').getCurrentWebContents();contents.sendInputEvent({type:'mouseMove',x,y});contents.sendInputEvent({type:'mouseDown',x,y,button:${JSON.stringify(button)},clickCount:1});contents.sendInputEvent({type:'mouseUp',x,y,button:${JSON.stringify(button)},clickCount:1});return 'clicked';})()`,
        ),
      ).toBe("clicked");
    /** A trusted key press, with the modifiers held. */
    const key = async (keyCode: string, modifiers: string[] = []) =>
      obEval(
        run.vaultId,
        `(function(){const contents=require('@electron/remote').getCurrentWebContents();contents.sendInputEvent({type:'keyDown',keyCode:${JSON.stringify(keyCode)},modifiers:${JSON.stringify(modifiers)}});contents.sendInputEvent({type:'keyUp',keyCode:${JSON.stringify(keyCode)},modifiers:${JSON.stringify(modifiers)}});return true;})()`,
      );
    /** Text typed into the focused field, as the keyboard types it. */
    const typeText = async (text: string) =>
      obEval(
        run.vaultId,
        `(function(){require('@electron/remote').getCurrentWebContents().insertText(${JSON.stringify(text)});return true;})()`,
      );
    const focusedInput = `String(activeDocument.activeElement?.matches('[data-query-vault-input]')??false)`;

    // An empty cell is a click target across the whole cell, so the first
    // value of a property goes in with one click (bug A).
    await click(`${cell(tieSecond, "zt-status")}.closest('td')`);
    expect(
      await obEvalUntil(run.vaultId, focusedInput, { expected: "true" }),
    ).toBe(true);
    await typeText("to-read");
    await key("Enter");
    await frontmatterWhen(
      notePath(tieSecond),
      (properties) => properties["zt-status"] === "to-read",
    );

    // A cell edits its value in place, its first line where it was at rest,
    // for each type of property (#1531).
    /**
     * The top of the first line of a vault cell, from the top of its row: of
     * its first item for a list, of the field's content box for a field
     * (and a date at rest, a native field too), else of its first text.
     */
    const firstLine = (name: string) =>
      `(function(){const el=${cell(tieFirst, name)};const row=el.closest('tr').getBoundingClientRect().top;const editor=el.querySelector('[data-query-vault-editor]');const chip=(editor??el).querySelector('[data-query-vault-chip]');if(chip)return String(chip.getBoundingClientRect().top-row);const field=editor?editor.querySelector('textarea,input'):el.querySelector('[data-query-vault-date]');if(field){const style=getComputedStyle(field);return String(field.getBoundingClientRect().top+parseFloat(style.borderTopWidth)+parseFloat(style.paddingTop)-row);}const walker=activeDocument.createTreeWalker(el,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.textContent.trim()?1:3});const text=walker.nextNode();const range=activeDocument.createRange();range.selectNodeContents(text);const rect=range.getClientRects()[0];return String(rect.top-(parseFloat(getComputedStyle(text.parentElement).lineHeight)-rect.height)/2-row);})()`;
    const editing = `String(!!activeDocument.querySelector('[data-query-vault-editor]'))`;
    /** Open the edit of the cell `name`, and compare its first line with the cell's at rest. */
    const sameLine = async (name: string) => {
      const restLine = Number(await obEval(run.vaultId, firstLine(name)));
      await click(cell(tieFirst, name));
      expect(
        await obEvalUntil(run.vaultId, focusedInput, { expected: "true" }),
      ).toBe(true);
      const editLine = Number(await obEval(run.vaultId, firstLine(name)));
      expect(
        Math.abs(editLine - restLine),
        `${name}: first line ${restLine} at rest, ${editLine} editing`,
      ).toBeLessThan(0.5);
    };
    // A number, a date and a list, each left unchanged: Escape closes the
    // suggestions of a list first, then ends the edit, writing nothing.
    expect(
      await obEval(
        run.vaultId,
        `${JSON.stringify(["zt-rank", "zt-due", "zt-projects"])}.map(name=>${tab}.contentEl.querySelector('[data-query-key="${tieFirst}"] [data-query-vault-name="'+name+'"]')?.getAttribute('data-query-vault-type')).join()`,
      ),
    ).toBe("number,date,multitext");
    for (const name of ["zt-rank", "zt-due", "zt-projects"]) {
      await sameLine(name);
      await key("Escape");
      if (
        await obEvalUntil(run.vaultId, editing, { expected: "false", tries: 5 })
      )
        continue;
      await key("Escape");
      expect(
        await obEvalUntil(run.vaultId, editing, { expected: "false" }),
      ).toBe(true);
    }
    await sameLine("zt-status");
    // The vault's values for the property show as the edit starts, before
    // a key is typed, as in a Bases cell (#1531): those that match the text.
    expect(
      await obEvalUntil(
        run.vaultId,
        `[...activeDocument.querySelectorAll('.suggestion-container .suggestion-item')].map(item=>item.textContent).join('|')`,
        { expected: "unread" },
      ),
    ).toBe(true);
    // The field's text, selected, is replaced by what is typed; it matches
    // vault values, and Shift+Enter keeps the text over the highlighted one.
    await obEval(
      run.vaultId,
      "(()=>{activeDocument.activeElement.select();return true;})()",
    );
    await typeText("read");
    await key("Enter", ["shift"]);
    await frontmatterWhen(
      notePath(tieFirst),
      (properties) => properties["zt-status"] === "read",
    );

    // A checkbox toggles with one click on it.
    await click(
      `${cell(tieFirst, "zt-done")}.querySelector('[data-query-vault-checkbox]')`,
    );
    await frontmatterWhen(
      notePath(tieFirst),
      (properties) => properties["zt-done"] === true,
    );

    // A list commits when focus leaves the editor from an item, as a click
    // outside the Table takes it (bug B). Backspace in the empty field
    // selects the last item, as in a Bases list cell.
    await click(cell(tieFirst, "zt-projects"));
    expect(
      await obEvalUntil(run.vaultId, focusedInput, { expected: "true" }),
    ).toBe(true);
    await typeText("c");
    await key("Enter");
    await key("Backspace");
    expect(
      await obEvalUntil(
        run.vaultId,
        `String(activeDocument.activeElement?.matches('[data-query-vault-chip="c"]')??false)`,
        { expected: "true" },
      ),
    ).toBe(true);
    // A chip edits in place from its menu, as in a Bases list cell: a
    // right click opens it, Edit makes the chip's text a field, and a comma
    // stays inside the item.
    await click(
      `${cell(tieFirst, "zt-projects")}.querySelector('[data-query-vault-chip="c"]')`,
      "right",
    );
    const editEntry = `[...activeDocument.querySelectorAll('body > .menu .menu-item')].find(entry=>entry.textContent===${JSON.stringify(run.m.query_view_vault_chip_edit())})`;
    expect(
      await obEvalUntil(run.vaultId, `String(!!${editEntry})`, {
        expected: "true",
      }),
    ).toBe(true);
    expect(await obEval(run.vaultId, MENU_READY)).toBe("ready");
    await click(editEntry);
    expect(
      await obEvalUntil(
        run.vaultId,
        `String(activeDocument.activeElement?.matches('[data-query-vault-chip-input]')??false)`,
        { expected: "true" },
      ),
    ).toBe(true);
    await typeText(", d");
    expect(
      await obEvalUntil(
        run.vaultId,
        `String(activeDocument.activeElement?.matches('[data-query-vault-chip-input]')&&activeDocument.activeElement.value)`,
        { expected: "c, d" },
      ),
    ).toBe(true);
    await key("Enter");
    expect(
      await obEvalUntil(
        run.vaultId,
        `String(activeDocument.activeElement?.matches('[data-query-vault-chip="c, d"]')??false)`,
        { expected: "true" },
      ),
    ).toBe(true);
    // A click on an empty spot of the view, outside the Table.
    expect(
      await obEval(
        run.vaultId,
        `(function(){const el=${tab}.contentEl;const table=el.querySelector('[data-query-table]');const box=el.getBoundingClientRect();let x=0,y=0,found=false;for(let dy=8;dy<box.height&&!found;dy+=8)for(let dx=8;dx<box.width&&!found;dx+=16){x=box.left+dx;y=box.bottom-dy;const hit=activeDocument.elementFromPoint(x,y);found=!!hit&&el.contains(hit)&&!table.contains(hit)&&!hit.closest('button,input,select,a,[role],[tabindex],[popover]');}if(!found)return 'no empty space';const zoom=require('electron').webFrame.getZoomFactor();const point={x:Math.round(x*zoom),y:Math.round(y*zoom)};const contents=require('@electron/remote').getCurrentWebContents();contents.sendInputEvent({type:'mouseMove',...point});contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});return 'clicked';})()`,
      ),
    ).toBe("clicked");
    await frontmatterWhen(notePath(tieFirst), (properties) =>
      ["a", "c, d"].every((item) =>
        (properties["zt-projects"] as string[] | undefined)?.includes(item),
      ),
    );
    await tableWhen((table) => !table.editing);

    // The first edit of a row with no note creates the note, then writes
    // the value to it.
    await click(`${cell(fresh, "zt-status")}.closest('td')`);
    expect(
      await obEvalUntil(run.vaultId, focusedInput, { expected: "true" }),
    ).toBe(true);
    await typeText("queued");
    await key("Enter");
    // Where several Profiles fit the Item, the prompt asks; its first
    // choice takes it.
    let createdPath: string | null = null;
    expect(
      await waitFor(async () => {
        const found = await obEval(
          run.vaultId,
          `(()=>{const note=${noteIndex}.getNotesByItemKey(${JSON.stringify(fresh)})[0];if(note)return note.path;const prompt=activeDocument.querySelector('.prompt input');if(prompt)prompt.dispatchEvent(new activeWindow.KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));return 'none';})()`,
        );
        if (found !== "none") createdPath = found;
        return found !== "none";
      }, 80),
    ).toBe(true);
    created.push(createdPath!);
    await frontmatterWhen(
      createdPath!,
      (properties) => properties["zt-status"] === "queued",
    );

    // A vault filter keeps the Items whose note passes it, and a vault sort
    // breaks the tie of their dates: the higher rank first.
    await obEval(
      run.vaultId,
      `(async()=>{await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(path)}),${JSON.stringify(viewText(["        - 'vault[\"zt-done\"] == true'", "    sort:", "      - property: date", "        direction: ASC", "      - property: vault.zt-rank", "        direction: DESC"].join("\n")))});return true;})()`,
    );
    const sorted = await tableWhen(
      (table) =>
        table.rows.length === 2 &&
        table.rows.join() === [tieSecond, tieFirst].join(),
    );
    expect(sorted.rows).toEqual([tieSecond, tieFirst]);
  }, 180000);

  // A List or Cards view of Items gathers its rows by a grouping whose
  // fields it does not show, as the Table does (#1495).
  it("groups a List and Cards view of Items by item type, Collection and tag, as the Table does", async () => {
    const layout = await obEval(
      run.vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const paths: string[] = [];
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{for(const leaf of app.workspace.getLeavesOfType('zotlit-query-file'))leaf.detach();for(const path of ${JSON.stringify(paths)}){const file=app.vault.getFileByPath(path);if(file)await app.vault.delete(file);}await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    const itemTypes = [
      "Book",
      "Book Section",
      "Conference Paper",
      "Journal Article",
      "Letter",
      "Preprint",
      "Thesis",
    ];
    const none = run.m.query_view_group_none();
    const cases: {
      name: string;
      type: "list" | "cards" | "table";
      group: string;
      order?: string[];
      headings: string[];
      unused?: string;
    }[] = [
      {
        name: "List by item type",
        type: "list",
        group: "itemType",
        order: ["title"],
        headings: itemTypes,
      },
      {
        name: "Cards by Collection",
        type: "cards",
        group: "collections[]",
        headings: [
          "Personal only",
          "Personal only/Personal child",
          "Shared key",
          none,
        ],
      },
      {
        name: "List by tag",
        type: "list",
        group: "tags[]",
        headings: [
          "fixture-core",
          "methodology",
          "read-later",
          "research-practice",
          "visualization",
          none,
        ],
      },
      {
        name: "List by tag showing tags",
        type: "list",
        group: "tags[]",
        order: ["title", "tags"],
        headings: [
          "fixture-core",
          "methodology",
          "read-later",
          "research-practice",
          "visualization",
          none,
        ],
        unused: run.m.query_view_unshown({
          dataset: run.m.query_view_dataset_items(),
          properties: run.m.query_view_property_tag(),
        }),
      },
      {
        name: "Table by item type",
        type: "table",
        group: "itemType",
        order: ["title"],
        headings: itemTypes,
      },
    ];
    for (const { name, type, group, order, headings, unused } of cases) {
      const path = `query-files/${name}.zotquery`;
      paths.push(path);
      const text = [
        "views:",
        `  - type: ${type}`,
        `    name: ${name}`,
        "    from: items",
        "    groupBy:",
        `      property: ${group}`,
        "      direction: ASC",
        ...(order ? ["    order:", ...order.map((p) => `      - ${p}`)] : []),
        "    limit: 100",
        "",
      ].join("\n");
      await obEval(
        run.vaultId,
        `(async()=>{const file=await app.vault.create(${JSON.stringify(path)},${JSON.stringify(text)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
      );
      const read = `(async()=>{const view=app.workspace.getMostRecentLeaf().view;if(view.getViewType()!=='zotlit-query-file'||view.file?.path!==${JSON.stringify(path)})return 'null';await view.query.settled;const el=view.contentEl;return JSON.stringify({rows:el.querySelectorAll('[data-query-row], [data-query-table-row="item"]').length,headings:[...el.querySelectorAll('[data-query-group]')].map(n=>n.textContent),unused:el.querySelector('[data-query-unused]')?.textContent??null});})()`;
      let shown: {
        rows: number;
        headings: string[];
        unused: string | null;
      } | null = null;
      const settled = await waitFor(async () => {
        shown = JSON.parse(await obEval(run.vaultId, read)) as typeof shown;
        return shown !== null && shown.rows > 0;
      }, 120);
      if (!settled) throw new Error(`${name}: ${JSON.stringify(shown)}`);
      expect({ name, ...shown! }).toMatchObject({
        name,
        headings,
        unused: unused ?? null,
      });
    }
  }, 180000);
});
