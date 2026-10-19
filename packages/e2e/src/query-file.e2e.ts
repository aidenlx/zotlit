import { describe, expect, it } from "vitest";

import { LIBRARIES } from "@zotlit/scripts/fixture";

import { reachable } from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { byItem, itemsByModified } from "./e2e-run-query-types.ts";
import type {
  ItemQueryReport,
  LibraryScopeReport,
} from "./e2e-run-query-types.ts";
import { cliCommand, obEval, waitFor } from "./obsidian-cli.ts";
import { MENU_READY, PAGE, pickQueryView } from "./page-gestures.ts";
describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("opens a Query File in a tab with cards grouped by Item, with Zotero closed", async () => {
    const layout = await obEval(
      run.vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    const scratchFiles: string[] = [];
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{for(const path of ${JSON.stringify(scratchFiles)}){const file=app.vault.getFileByPath(path);if(file)await app.vault.delete(file);}return true;})()`,
      );
    });
    /** What the active Query File tab shows, once its query settled. */
    const readTab = `(async()=>{const view=app.workspace.getMostRecentLeaf().view;if(view.getViewType()!=='zotlit-query-file')return 'null';await view.query.settled;const el=view.contentEl;const cards=[...el.querySelectorAll('.zt-annot-card')].map(n=>n.getAttribute('data-zotero-annotation-key'));const headings=[...el.querySelectorAll('[data-query-group]')].map(n=>n.textContent);const rows=[...el.querySelectorAll('tr[data-query-table-row="item"]')].map(n=>n.getAttribute('data-query-key'));const columns=[...el.querySelectorAll('th[data-query-column]')].map(n=>({path:n.getAttribute('data-query-column'),label:n.textContent}));return JSON.stringify({file:view.file?.path,view:el.querySelector('[data-query-view-menu]')?.textContent??null,rows,columns,count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,cards,headings,diagnostic:el.querySelector('[data-query-diagnostic]')?.getAttribute('data-query-diagnostic')??null,problems:el.querySelector('[data-query-problems]')?.textContent??null,unresolved:el.querySelector('[data-query-unresolved]')?.textContent??null});})()`;
    interface Tab {
      file: string;
      view: string | null;
      count: string | null;
      cards: string[];
      headings: string[];
      /** The Indexed Key of each Item row of the Table. */
      rows: string[];
      /** The Table's columns: each property path and its header text. */
      columns: { path: string; label: string }[];
      diagnostic: string | null;
      problems: string | null;
      unresolved: string | null;
    }
    const tabWhen = async (ready: (tab: Tab) => boolean): Promise<Tab> => {
      let tab: Tab | null = null;
      const settled = await waitFor(async () => {
        tab = JSON.parse(await obEval(run.vaultId, readTab)) as Tab | null;
        return tab !== null && ready(tab);
      }, 120);
      if (!settled) throw new Error(`Query File tab: ${JSON.stringify(tab)}`);
      return tab!;
    };
    /** The rows ZotLit Query gives for a view, through the CLI. */
    const queryRows = async (filter?: string) => {
      const report = JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", {
          args: {
            from: "annotations",
            fields: "item.title",
            limit: "100",
            ...(filter === undefined ? {} : { filter }),
          },
        }),
      ) as ItemQueryReport;
      expect(report.ok).toBe(true);
      return report.rows!;
    };

    // "New query file" from the command palette writes a Table of the
    // library's Items, newest first, and opens it in a tab.
    const before = JSON.parse(
      await obEval(
        run.vaultId,
        "JSON.stringify(app.vault.getFiles().map(f=>f.path))",
      ),
    ) as string[];
    await obEval(
      run.vaultId,
      "app.commands.executeCommandById('zotlit:new-query-file');true",
    );
    const created = await tabWhen((tab) => tab.rows.length > 0);
    expect(before).not.toContain(created.file);
    scratchFiles.push(created.file);
    expect(created.file).toMatch(/\.zotquery$/);
    // The Items of the Libraries of the Library Scope, from the seed.
    const scope = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:library-scope"),
    ) as LibraryScopeReport;
    const newest = itemsByModified(
      (scope.available ?? []).map(
        (entry) =>
          LIBRARIES.find((library) => library.libraryID === entry.libraryID)!,
      ),
    ).slice(0, 100);
    expect(newest.length).toBeGreaterThan(1);
    expect(created).toMatchObject({
      view: run.m.query_file_items_view_name(),
      count: String(newest.length),
      rows: newest,
      columns: [
        // Zotero's own label for the title field.
        { path: "title", label: expect.stringContaining("Title") },
        {
          path: "creators",
          label: expect.stringContaining(run.m.query_view_property_creators()),
        },
        {
          path: "date.year",
          label: expect.stringContaining(run.m.query_view_property_year()),
        },
        {
          path: "vault.literatureNote",
          label: expect.stringContaining(
            run.m.query_view_table_literature_note(),
          ),
        },
      ],
      diagnostic: null,
      problems: null,
      unresolved: null,
    });

    // Its second view is the Annotations of the whole library: the cards
    // come grouped by Item under its title, in query order inside a group,
    // and the count is the query's own. No Zotero answers this vault.
    const annotationsView = run.m.query_file_annotations_view_name();
    await obEval(
      run.vaultId,
      `(async()=>{${PAGE}${pickQueryView("app.workspace.getMostRecentLeaf().view", annotationsView)}return true;})()`,
    );
    const all = await queryRows();
    expect(all.length).toBeGreaterThan(0);
    const annotations = await tabWhen(
      (tab) => tab.view === annotationsView && tab.count !== null,
    );
    expect(annotations).toMatchObject({
      file: created.file,
      count: String(all.length),
      ...byItem(all),
      diagnostic: null,
      problems: null,
      unresolved: null,
    });

    // The view menu of the Fixture's Query File lists its views and switches.
    await obEval(
      run.vaultId,
      `(async()=>{const leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getFileByPath('query-files/Reading annotations.zotquery'));app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );
    await tabWhen(
      (tab) => tab.view === "All annotations" && tab.count !== null,
    );
    const menu = JSON.parse(
      await obEval(
        run.vaultId,
        `(async()=>{${PAGE}const view=app.workspace.getMostRecentLeaf().view;press(view.contentEl.querySelector('[data-query-view-menu]'),'View menu');const rows=await until('view menu rows',()=>{const found=[...view.contentEl.querySelectorAll('[data-query-view-list]:popover-open [data-query-view-row]')];return found.length>0&&found;});const titles=rows.map(n=>n.getAttribute('data-query-view-row'));press(rows.find(n=>n.getAttribute('data-query-view-row')==='Figures'),'Figures');return JSON.stringify(titles);})()`,
      ),
    ) as string[];
    expect(menu).toEqual(["All annotations", "Figures"]);
    const figureRows = await queryRows('tags.contains("figure")');
    expect(figureRows.length).toBeGreaterThan(0);
    const figures = await tabWhen((tab) => tab.view === "Figures");
    expect(figures).toMatchObject({
      count: String(figureRows.length),
      ...byItem(figureRows),
    });
    expect(
      await obEval(
        run.vaultId,
        "app.workspace.getMostRecentLeaf().getViewState().state.view",
      ),
    ).toBe("Figures");

    // A filter that reads `this` shows the diagnostic: a tab has no Query
    // Context. A bad expression and an unknown field open and say so too.
    for (const [name, filter, code] of [
      ["this", "item == this.item", "unbound-context"],
      ["bad", "colorName ==", "invalid-filter"],
      ["unknown", "nosuchfield == 1", "unknown-field"],
    ] as const) {
      const path = `query-files/${name}.zotquery`;
      scratchFiles.push(path);
      await obEval(
        run.vaultId,
        `(async()=>{const file=await app.vault.create(${JSON.stringify(path)},${JSON.stringify(`views:\n  - type: annotations\n    name: Broken\n    from: annotations\n    filters: ${filter}\n`)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
      );
      const broken = await tabWhen(
        (tab) => tab.file === path && tab.diagnostic !== null,
      );
      expect(broken).toMatchObject({
        diagnostic: code,
        cards: [],
        count: null,
      });
    }

    // "New query file" stands in a folder's menu in the file explorer.
    const folderMenu = JSON.parse(
      await obEval(
        run.vaultId,
        `(async()=>{${PAGE}app.workspace.leftSplit.expand();const explorer=app.workspace.getLeavesOfType('file-explorer')[0];await app.workspace.revealLeaf(explorer);const title=explorer.view.containerEl.querySelector('.nav-folder-title[data-path="query-files"]');title.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:10,clientY:10}));await until('folder menu opens',()=>activeDocument.querySelector('.menu .menu-item-title'));const titles=[...activeDocument.querySelectorAll('.menu .menu-item-title')].map(n=>n.textContent);await ${MENU_READY};activeDocument.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await until('folder menu closes',()=>!activeDocument.querySelector('.menu'));return JSON.stringify(titles);})()`,
      ),
    ) as string[];
    expect(folderMenu).toContain(run.m.query_file_new());
  }, 180000);

  // The pill patches Obsidian's internal empty view and copies its pills'
  // markup, so an Obsidian upgrade that moves either shows up here.
  it("shows New Zotero query table with its hotkey after Obsidian's New pills on a new tab, and creates a Query File there ready to rename", async () => {
    const command = "zotlit:new-query-file";
    const layout = await obEval(
      run.vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const hotkeys = await obEval(
      run.vaultId,
      `JSON.stringify(app.hotkeyManager.getHotkeys(${JSON.stringify(command)})??null)`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const id=${JSON.stringify(command)};const saved=${hotkeys};if(saved)app.hotkeyManager.setHotkeys(id,saved);else app.hotkeyManager.removeHotkeys(id);await app.hotkeyManager.save();return true;})()`,
      );
    });
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    const scratchFiles: string[] = [];
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{for(const path of ${JSON.stringify(scratchFiles)}){const file=app.vault.getFileByPath(path);if(file)await app.vault.delete(file);}return true;})()`,
      );
    });

    const printed = await obEval(
      run.vaultId,
      `(()=>{const id=${JSON.stringify(command)};app.hotkeyManager.setHotkeys(id,[{modifiers:['Mod','Shift'],key:'Q'}]);return app.hotkeyManager.printHotkeyForCommand(id);})()`,
    );
    expect(printed).not.toBe("");
    await obEval(
      run.vaultId,
      "app.commands.executeCommandById('workspace:new-tab');true",
    );
    /** Each pill of the active empty tab: its icon, label, hotkey and classes. */
    const readPills = `(()=>{const view=app.workspace.getMostRecentLeaf().view;if(view.getViewType()!=='empty')return 'null';return JSON.stringify([...view.actionListEl.children].map(b=>({icon:[...b.querySelector('.text-button-icon svg')?.classList??[]].find(c=>c.startsWith('lucide-'))??null,label:b.querySelector('.text-button-label')?.textContent??null,hotkey:b.querySelector('.empty-state-hotkey')?.textContent??null,classes:[...b.classList].filter(c=>c!=='zt-empty-state-new-query').sort(),ours:b.classList.contains('zt-empty-state-new-query')})));})()`;
    interface Pill {
      icon: string | null;
      label: string | null;
      hotkey: string | null;
      classes: string[];
      ours: boolean;
    }
    let pills: Pill[] = [];
    const shown = await waitFor(async () => {
      pills = (JSON.parse(await obEval(run.vaultId, readPills)) ??
        []) as Pill[];
      return pills.some((pill) => pill.ours);
    });
    expect(shown, JSON.stringify(pills)).toBe(true);
    // Right after New note, New base and New canvas, before Go to file.
    expect(pills.map((pill) => pill.icon)).toEqual([
      "lucide-square-pen",
      "lucide-layout-list",
      "lucide-layout-dashboard",
      "lucide-list-filter",
      "lucide-search",
    ]);
    const ours = pills.find((pill) => pill.ours)!;
    const newNote = pills[0]!;
    expect(ours).toMatchObject({
      label: run.m.empty_state_new_query(),
      // Printed the way Obsidian prints New note's own hotkey.
      hotkey: ` ${printed}`,
      classes: newNote.classes,
    });
    expect(newNote.hotkey).toMatch(/^ \S/);

    // A click opens a new Query File in this tab, its title selected to rename.
    const opened = await obEval(
      run.vaultId,
      `(async()=>{${PAGE}const leaf=app.workspace.getMostRecentLeaf();press(leaf.view.actionListEl.querySelector('.zt-empty-state-new-query'),'New Zotero query table');await until('Query File opens',()=>leaf.view.getViewType()==='zotlit-query-file'&&leaf.view.file,10000);const view=leaf.view;const title=view.titleEl;const selection=title.win.getSelection();return JSON.stringify({sameTab:app.workspace.getMostRecentLeaf()===leaf,file:view.file.path,title:title.textContent,focused:title.doc.activeElement===title,selected:title.contains(selection.anchorNode)?selection.toString():null});})()`,
    );
    const created = JSON.parse(opened) as {
      sameTab: boolean;
      file: string;
      title: string;
      focused: boolean;
      selected: string | null;
    };
    scratchFiles.push(created.file);
    expect(created.file).toMatch(/\.zotquery$/);
    expect(created).toMatchObject({
      sameTab: true,
      title: created.file.replace(/^.*\//, "").replace(/\.zotquery$/, ""),
      focused: true,
      selected: created.title,
    });
  }, 120000);
});
