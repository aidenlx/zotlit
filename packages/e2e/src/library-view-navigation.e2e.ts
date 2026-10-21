import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ATTACHMENTS,
  COLLECTIONS,
  ITEMS,
  LIBRARIES,
  LIBRARY_SCOPE_SETTING_KEY,
} from "@zotlit/scripts/fixture";
import type { FixtureItem } from "@zotlit/scripts/fixture";

import { reachable } from "./e2e-run-fixture.ts";
import {
  LIBRARY_HEADING,
  MY_LIBRARY_DOCUMENT,
  annotationAttachment,
  annotationItem,
  booksProfile,
  booksProfileTargetItem,
  e2eFixture,
  positionDocumentItem,
  readingState,
  workspaceRoot,
} from "./e2e-run-fixture.ts";
import { activeTab, pdfOpened, unreadOf } from "./e2e-run-helpers.ts";
import type { ActiveTab } from "./e2e-run-helpers.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import {
  pressPromptKey,
  selectItemSuggestion,
  selectSuggestion,
} from "./e2e-run-note-helpers.ts";
import * as suite from "./e2e-run-suite-helpers.ts";
import {
  clearNotices,
  cli,
  obEval,
  obEvalUntil,
  obReadUntil,
  readUntil,
  waitFor,
} from "./obsidian-cli.ts";
import { PAGE } from "./page-gestures.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("swaps the Reading Card from one paper to the next in one step, by the arrow keys and by a click, beside a wide list and over a narrow one, with its Annotations closed and open, whether ZotLit Query answers at once or late, with Zotero closed", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      run.vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{delete window.zotlitE2EBeside;const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document});await settings.flush();await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    await suite.wideWindow(cleanup);
    await obEval(
      run.vaultId,
      `(async()=>{${PAGE}app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)}});await settings.flush();app.commands.executeCommandById('zotlit:open-library-view');await until('library',()=>app.workspace.getLeavesOfType('zotlit-library')[0],10000);return true;})()`,
    );

    interface Frame {
      /** The title's text; `null` with no title element. */
      title: string | null;
      /** The top of the Open PDF button, from the card's top; `null` with no button. */
      top: number | null;
      /** The keys of the Annotation Cards drawn. */
      cards: string[];
      /** Whether the card shows at all. */
      shown: boolean;
    }
    interface Switch {
      from: string;
      to: string;
      /** The card just before the switch, then as each animation frame draws it. */
      frames: Frame[];
      /** The title's text after each batch of mutations of the card. */
      mutations: (string | null)[];
    }
    /**
     * Select the row `from`, or none for `null`, wait for its card, then move
     * the selection to the row `to` by `how`: the arrow key, a click, or the selection set
     * as "Show in Library" sets it, with each ZotLit Query run held `delay` ms
     * first, and read each frame the window draws until half a second after
     * that.
     */
    const switchCard = async (
      how: "key" | "click" | "show",
      [from, to]: readonly [string | null, string],
      delay: number,
    ) =>
      JSON.parse(
        await obEval(
          run.vaultId,
          `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];const view=leaf.view;await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});await view.query.settled;const el=view.contentEl;const card=el.querySelector('[data-library-card]');const row=key=>el.querySelector('[data-query-item-row="'+key+'"]');const frame=()=>new Promise(r=>requestAnimationFrame(r));const title=()=>card.querySelector('[data-library-card-title]');await until('rows',()=>row(${JSON.stringify(to)}),10000);${
            from === null
              ? "view.selection.setState({key:null,card:false});await until('no card',()=>!card.checkVisibility(),10000);await view.card.settled;await frame();await frame();"
              : `view.selection.setState({key:${JSON.stringify(from)},card:true});await until('card',()=>card.checkVisibility()&&title()?.textContent,10000);await view.card.settled;await frame();await frame();row(${JSON.stringify(from)}).focus({preventScroll:true});`
          }const sample=()=>{const button=card.querySelector('[data-library-card-action="pdf"]');const box=card.getBoundingClientRect();return{title:title()?title().textContent:null,top:button&&card.checkVisibility()?Math.round(button.getBoundingClientRect().top-box.top):null,cards:[...card.querySelectorAll('.zt-annot-card[data-zotero-annotation-key]')].map(n=>n.getAttribute('data-zotero-annotation-key')),shown:card.checkVisibility()};};const mutations=[];const observer=new MutationObserver(()=>mutations.push(title()?title().textContent:null));observer.observe(card,{childList:true,subtree:true,characterData:true});const frames=[sample()];const service=${services}.query;const run=service.run;if(${delay}>0)service.run=function(...args){return new Promise(r=>setTimeout(r,${delay})).then(()=>run.apply(this,args));};try{${
            {
              key: "activeDocument.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));",
              click: `press(row(${JSON.stringify(to)}),'row');`,
              // As "Show in Library" does for a row the list shows.
              show: `view.selection.setState({key:${JSON.stringify(to)},card:true});`,
            }[how]
          }const start=performance.now();while(performance.now()-start<${delay}+600){await frame();frames.push(sample());}await view.card.settled;await frame();frames.push(sample());}finally{service.run=run;observer.disconnect();}return JSON.stringify({from:frames[0].title,to:frames.at(-1).title,frames,mutations});})()`,
        ),
      ) as Switch;

    /**
     * The card goes from the first paper to the second in one step: its
     * title is never gone or empty and reads the old title, then the new
     * one; its buttons move once, and not at all between headers of one
     * height; and the Annotation Cards of one paper never show under the
     * other's title.
     */
    const oneStep = (what: string, step: Switch) => {
      const titles = [step.from, step.to];
      expect.soft(step.from, what).toBeTruthy();
      expect.soft(step.to, what).toBeTruthy();
      expect.soft(step.from, what).not.toBe(step.to);
      // Over a narrow list a click puts the card away while it waits out a
      // double click: the frames it is away count for nothing.
      const frames = step.frames.filter(({ shown }) => shown);
      expect
        .soft(
          frames.filter(({ title }) => !title),
          what,
        )
        .toEqual([]);
      expect
        .soft(
          step.mutations.filter((title) => !title),
          what,
        )
        .toEqual([]);
      const seen = <T>(list: T[]) =>
        list.filter((value, at) => at === 0 || value !== list[at - 1]);
      expect.soft(seen(frames.map(({ title }) => title)), what).toEqual(titles);
      expect
        .soft(seen(step.mutations), what)
        .toEqual(seen(step.mutations)[0] === step.from ? titles : [step.to]);
      const top = frames[0]!.top;
      const settled = frames.at(-1)!.top;
      expect
        .soft(seen(frames.map(({ top }) => top)), what)
        .toEqual(top === settled ? [top] : [top, settled]);
      // The old paper's Annotation Cards stay until its title goes, and
      // only the new paper's come under its title, once read.
      const under = (title: string | null) =>
        frames.filter((frame) => frame.title === title);
      expect
        .soft(
          under(step.from).filter(
            ({ cards }) => cards.join() !== frames[0]!.cards.join(),
          ),
          `${what}: Annotation Cards under ${step.from}`,
        )
        .toEqual([]);
      const last = frames.at(-1)!.cards;
      expect
        .soft(
          under(step.to).filter(
            ({ cards }, at, list) =>
              cards.some((key) => !last.includes(key)) ||
              (at > 0 && cards.length < list[at - 1]!.cards.length),
          ),
          `${what}: Annotation Cards under ${step.to}`,
        )
        .toEqual([]);
    };

    /**
     * The card opens on the paper whole: no frame shows it without its
     * title, and its buttons stay where its header puts them.
     */
    const opens = (what: string, step: Switch) => {
      const frames = step.frames.filter(({ shown }) => shown);
      expect.soft(step.to, what).toBeTruthy();
      expect.soft(step.frames[0]!.shown, what).toBe(false);
      expect
        .soft(
          frames.filter(({ title }) => !title),
          what,
        )
        .toEqual([]);
      const seen = <T>(list: T[]) =>
        list.filter((value, at) => at === 0 || value !== list[at - 1]);
      expect
        .soft(seen(frames.map(({ title }) => title)), what)
        .toEqual([step.to]);
      expect.soft(seen(frames.map(({ top }) => top)), what).toHaveLength(1);
    };

    /** The keys of the first rows of the list, and the row of the paper with Annotations. */
    const { rows, listed } = JSON.parse(
      await obEval(
        run.vaultId,
        `(async()=>{${PAGE}const view=app.workspace.getLeavesOfType('zotlit-library')[0].view;await view.query.settled;const el=view.contentEl;await until('rows',()=>el.querySelectorAll('[data-query-item-row]').length>6,10000);const keys=[...el.querySelectorAll('[data-query-item-row]')].map(n=>n.getAttribute('data-query-item-row'));return JSON.stringify({rows:keys.slice(0,7),listed:keys.find(k=>k.endsWith(${JSON.stringify(annotationItem.key)}))??null});})()`,
      ),
    ) as { rows: string[]; listed: string | null };
    expect(listed).not.toBeNull();

    const switches = async (where: string, narrow: boolean) => {
      for (const delay of [0, 400]) {
        const pace = delay === 0 ? "fast read" : "slow read";
        // From no selection, the card opens on the paper.
        opens(
          `${where}, opens on 3, ${pace}`,
          await switchCard(narrow ? "show" : "click", [null, rows[3]!], delay),
        );
        // Down the first rows by the arrow keys, then by a click; over a
        // narrow list those put the card away, so the selection moves as
        // "Show in Library" moves it.
        if (!narrow)
          for (let at = 0; at + 1 < 5; at++)
            oneStep(
              `${where}, ↓ ${at}, ${pace}`,
              await switchCard("key", [rows[at]!, rows[at + 1]!], delay),
            );
        for (const [a, b] of [
          [4, 1],
          [1, 2],
          [2, 6],
        ] as const)
          oneStep(
            `${where}, ${narrow ? "show" : "click"} ${a} → ${b}, ${pace}`,
            await switchCard(
              narrow ? "show" : "click",
              [rows[a]!, rows[b]!],
              delay,
            ),
          );
      }
    };

    // Beside a wide list, with the Annotations closed.
    await switches("wide", false);

    // With the Annotations open, to and from the paper that has some.
    const other = rows.find((key) => key !== listed)!;
    const disclose = (open: boolean) =>
      obEval(
        run.vaultId,
        `(()=>{app.workspace.getLeavesOfType('zotlit-library')[0]?.view.card.disclose('annotations',${open});return true;})()`,
      );
    await disclose(true);
    cleanup.defer(async () => {
      await disclose(false);
    });
    for (const delay of [0, 400]) {
      const pace = delay === 0 ? "fast read" : "slow read";
      const there = await switchCard("click", [other, listed!], delay);
      oneStep(`Annotations open, to the paper, ${pace}`, there);
      expect.soft(there.frames.at(-1)!.cards.length, pace).toBeGreaterThan(0);
      oneStep(
        `Annotations open, from the paper, ${pace}`,
        await switchCard("click", [listed!, other], delay),
      );
    }
    await disclose(false);

    // Over a narrow list.
    await obEval(
      run.vaultId,
      `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];const beside=window.zotlitE2EBeside??=app.workspace.createLeafBySplit(leaf,'vertical');leaf.parent.setDimension(30);beside.parent.setDimension(70);const card=leaf.view.contentEl.querySelector('[data-library-card]');leaf.view.selection.setState({key:${JSON.stringify(rows[0])},card:true});await until('card over the list',()=>card.checkVisibility()&&getComputedStyle(card).position==='absolute',5000);return true;})()`,
    );
    await switches("narrow", true);
  }, 240000);

  it("swaps the sidebar Annotation View from one Item to the next in one step, as it follows the active tab from one Literature Note to another and as the Item picker pins another Item, whether ZotLit Query answers at once or late, with Zotero closed", async () => {
    const layout = await obEval(
      run.vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const view=app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view;if(view?.getState().followMode==='pinned')app.commands.executeCommandById('zotlit:annot-view-unpin');app.commands.executeCommandById('zotlit:annot-view-follow-active-tab');await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    await suite.wideWindow(cleanup);
    // Two Literature Notes of Items whose Annotations differ.
    const items = [annotationItem, positionDocumentItem];
    const notes = items.map(
      (item) => `literatures/${item.literatureNoteName ?? item.key}.md`,
    );
    await obEval(
      run.vaultId,
      `(async()=>{const leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getFileByPath(${JSON.stringify(notes[0])}));app.workspace.setActiveLeaf(leaf,{focus:true});app.commands.executeCommandById('zotlit:open-annot-view');app.commands.executeCommandById('zotlit:annot-view-follow-active-tab');app.workspace.rightSplit.expand();return true;})()`,
    );

    interface Frame {
      /** The Item the header names, `null` while it names none. */
      title: string | null;
      /** The keys of the cards drawn. */
      cards: string[];
      /** Whether the body says it is loading. */
      loading: boolean;
      /** Milliseconds since the step began; none for the settled view before it. */
      at?: number;
    }
    interface Step {
      /** The view settled before the step, then as each animation frame draws it. */
      frames: Frame[];
      /** The view after each batch of mutations of it. */
      mutations: Frame[];
    }
    const sidebar =
      "app.workspace.getLeavesOfType('zotero-annotation-view')[0].view";
    /**
     * Settle the view after `prepare`, then run `trigger`, with each ZotLit
     * Query run held `delay` ms first, and read each frame the window draws
     * until 600 ms after that and the view settles.
     */
    const step = async (prepare: string, trigger: string, delay: number) =>
      JSON.parse(
        await obEval(
          run.vaultId,
          `(async()=>{${PAGE}const view=${sidebar};${prepare}await until('cards',()=>view.contentEl.querySelector('.zt-annot-card'),10000);await view.read;const frame=()=>new Promise(r=>requestAnimationFrame(r));await frame();await frame();const el=view.contentEl;const cards=()=>[...el.querySelectorAll('.zt-annot-card[data-zotero-annotation-key]')].map(n=>n.getAttribute('data-zotero-annotation-key'));const sample=()=>({title:el.querySelector('[data-annot-header-title]')?.textContent??null,cards:cards(),loading:!!el.querySelector('[data-annot-view-loading]')});const mutations=[];let start=performance.now();const observer=new MutationObserver(()=>mutations.push({...sample(),at:Math.round(performance.now()-start)}));observer.observe(el,{childList:true,subtree:true});const frames=[sample()];const service=${"app.plugins.plugins.zotlit.services"}.query;const run=service.run;if(${delay}>0)service.run=function(...args){return new Promise(r=>setTimeout(r,${delay})).then(()=>run.apply(this,args));};try{start=performance.now();${trigger}const first=frames[0].cards.join();const moved=()=>{const now=frames.at(-1);return now.cards.length>0&&now.cards.join()!==first;};while(performance.now()-start<${delay}+600||(!moved()&&performance.now()-start<5000)){await frame();frames.push({...sample(),at:Math.round(performance.now()-start)});}await view.read;await frame();frames.push({...sample(),at:Math.round(performance.now()-start)});}finally{service.run=run;observer.disconnect();}return JSON.stringify({frames,mutations});})()`,
        ),
      ) as Step;

    /**
     * The view goes from one Item to the next in one step: the last Item's
     * cards stay until the next Item's are read, and never show under the
     * next one's name; the next one's show whole. A read that takes longer
     * than 150 ms may show the next Item's name over a loading body first.
     */
    const oneStep = (
      what: string,
      { frames, mutations }: Step,
      { named, slow }: { named: boolean; slow: boolean },
    ) => {
      const before = frames[0]!;
      const after = frames.at(-1)!;
      // A read held past 150 ms shows the next Item over its cards loading.
      expect
        .soft(
          !slow ||
            frames.some(
              ({ loading, title }) =>
                loading && (!named || title === after.title),
            ),
          `${what}: the next Item loading`,
        )
        .toBe(true);
      expect.soft(before.cards.length, what).toBeGreaterThan(0);
      expect.soft(after.cards.length, what).toBeGreaterThan(0);
      expect.soft(after.cards.join(), what).not.toBe(before.cards.join());
      const seen = <T>(list: T[]) =>
        list.filter((value, at) => at === 0 || value !== list[at - 1]);
      const shown = (cards: string[]) =>
        cards.length === 0
          ? "none"
          : cards.join() === before.cards.join()
            ? "last"
            : cards.join() === after.cards.join()
              ? "next"
              : `other: ${cards.join()}`;
      for (const [kind, samples] of [
        ["frames", frames],
        ["mutations", mutations],
      ] as const) {
        const where = `${what}, ${kind}`;
        // The cards go from the last Item's to the next Item's, with at
        // most a loading body between, once the read has taken 150 ms.
        expect
          .soft(
            [
              ["last", "next"],
              ["last", "none", "next"],
            ],
            where,
          )
          .toContainEqual(
            seen([before, ...samples].map(({ cards }) => shown(cards))),
          );
        expect
          .soft(
            samples.filter(
              ({ cards, loading, at }) =>
                cards.length === 0 && (!loading || (at ?? 0) < 150),
            ),
            `${where}: no cards before 150 ms, or with no loading body`,
          )
          .toEqual([]);
        if (!named) continue;
        // The header names one Item at a time, never goes blank, and never
        // names one Item over the other's cards.
        expect
          .soft(
            samples.filter(({ title }) => !title),
            where,
          )
          .toEqual([]);
        expect
          .soft(seen([before, ...samples].map(({ title }) => title)), where)
          .toEqual([before.title, after.title]);
        expect
          .soft(
            samples.filter(
              ({ title, cards }) =>
                (title === before.title && shown(cards) !== "last") ||
                (title === after.title && shown(cards) === "last"),
            ),
            `${where}: cards under another Item's name`,
          )
          .toEqual([]);
      }
      if (!named) return;
      expect.soft(before.title, what).toBeTruthy();
      expect.soft(before.title, what).not.toBe(after.title);
    };

    for (const delay of [0, 400]) {
      const pace = delay === 0 ? "fast read" : "slow read";
      // Following the active tab from one Literature Note to the other.
      for (const [from, to] of [
        [notes[0]!, notes[1]!],
        [notes[1]!, notes[0]!],
      ] as const)
        oneStep(
          `active tab, ${from} → ${to}, ${pace}`,
          await step(
            `if(view.getState().followMode!=='active-tab'){app.commands.executeCommandById('zotlit:annot-view-unpin');app.commands.executeCommandById('zotlit:annot-view-follow-active-tab');await until('active tab',()=>view.getState().followMode==='active-tab');}const leaf=app.workspace.getMostRecentLeaf(app.workspace.rootSplit);if(leaf.view.file?.path!==${JSON.stringify(from)})await leaf.openFile(app.vault.getFileByPath(${JSON.stringify(from)}));`,
            `void app.workspace.getMostRecentLeaf(app.workspace.rootSplit).openFile(app.vault.getFileByPath(${JSON.stringify(to)}));`,
            delay,
          ),
          { named: false, slow: delay > 0 },
        );
      // Pinned, the Item picker pins the other Item. The click must land on a
      // row of the typed query's answer, which the picker shows once its
      // results stop being aria-busy; it drops a click on an earlier row. The
      // row is found by Indexed Key: another Item shares the title. This is
      // selectItemSuggestion's rule, inside the one eval the step times.
      for (const [from, to] of [
        [items[0]!, items[1]!],
        [items[1]!, items[0]!],
      ] as const)
        oneStep(
          `pinned, picker ${from.key} → ${to.key}, ${pace}`,
          await step(
            `view.pinItem(${JSON.stringify(from.key)});await until('pinned',()=>view.getState().pinnedItemKey===${JSON.stringify(from.key)});app.commands.executeCommandById('zotlit:annot-view-pin-item');const input=await until('picker',()=>activeDocument.querySelector('.prompt .prompt-input'),5000);input.value=${JSON.stringify(to.title)};input.dispatchEvent(new Event('input',{bubbles:true}));const choice=await until('suggestion',()=>[...activeDocument.querySelectorAll('.prompt .suggestion-item')].find(n=>!n.closest('[aria-busy]')&&n.dataset.indexedKey===${JSON.stringify(to.key)}),10000);`,
            "choice.click();",
            delay,
          ),
          { named: true, slow: delay > 0 },
        );
    }
  }, 240000);

  it("opens a Library View Document an earlier build stored with the Table on Papers, and saves its Collection from the toolbar as a Query File whose tab lists the same papers with every control, with Zotero closed", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const savedPath = "query-files/Saved library.zotquery";
    const snapshot = await obEval(
      run.vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null,scope:${services}.settings.current[${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}]??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document,${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:saved.scope});await settings.flush();await app.workspace.changeLayout(saved.layout);const file=app.vault.getFileByPath(${JSON.stringify(savedPath)});if(file)await app.vault.delete(file);return true;})()`,
      );
    });

    // The seed's "Shared key" Collection of My Library. A Collection of that
    // name holds Items in other Libraries too, which the Library Scope
    // reads, so the saved file has to keep to My Library.
    const personal = LIBRARIES.find(({ type }) => type === "user")!;
    const sharedKey = COLLECTIONS.find(
      (entry) =>
        entry.libraryID === personal.libraryID && entry.key === "SHAREDCL",
    )!;
    const filedIn = (collectionIDs: Set<number>) =>
      ITEMS.filter((item) =>
        item.collectionIDs.some((id) => collectionIDs.has(id)),
      );
    const subtree = (collectionID: number): number[] => [
      collectionID,
      ...COLLECTIONS.filter(
        (entry) => entry.parentCollectionID === collectionID,
      ).flatMap((child) => subtree(child.collectionID)),
    ];
    const expected = filedIn(new Set(subtree(sharedKey.collectionID)))
      .map(({ key }) => key)
      .toSorted();
    expect(expected.length).toBeGreaterThan(0);
    const namesakes = COLLECTIONS.filter(
      (entry) =>
        entry.name === sharedKey.name && entry.libraryID !== personal.libraryID,
    );
    expect(
      filedIn(new Set(namesakes.map(({ collectionID }) => collectionID)))
        .length,
      "another Library files Items in a Collection of the same name",
    ).toBeGreaterThan(0);

    // The document as an earlier build stored it, with the Table and its
    // Visible Properties, which this build ignores.
    await obEval(
      run.vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':{node:{kind:'collection',library:{type:'personal'},path:[${JSON.stringify(sharedKey.name)}]},facets:[],search:'',sort:[{property:'dateModified',direction:'DESC'}],layout:'table',order:['title']},${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:{mode:'all'}});await settings.flush();app.commands.executeCommandById('zotlit:open-library-view');return true;})()`,
    );

    /** What a view shows once its query settled: its Layout, rows and toolbar. */
    const readRows = (view: string) =>
      `(async()=>{const view=${view};if(!view?.query)return 'null';await view.query.settled;const el=view.contentEl;return JSON.stringify({type:view.getViewType(),file:view.file?.path??null,phase:view.query.state.getState().phase,layout:el.querySelector('[data-query-layout]')?.getAttribute('data-query-layout')??(el.querySelector('[data-query-table]')?'table':null),count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,rows:[...el.querySelectorAll('[data-query-papers-row], tr[data-query-table-row="item"]')].map(n=>n.getAttribute('data-query-papers-row')??n.getAttribute('data-query-key')),toolbar:[...el.querySelectorAll('[role="toolbar"] > button, [role="toolbar"] [data-query-view-menu], [role="toolbar"] [data-query-properties]')].map(n=>n.getAttribute('data-query-toolbar')??[...n.attributes].map(a=>a.name).find(a=>a.startsWith('data-query-'))??null)});})()`;
    interface Rows {
      type: string;
      file: string | null;
      phase: string;
      layout: string | null;
      count: string | null;
      rows: string[];
      /** The toolbar's controls, by their hook. */
      toolbar: (string | null)[];
    }
    const rowsWhen = (view: string, ready: (rows: Rows) => boolean) =>
      obReadUntil<Rows>(run.vaultId, readRows(view), {
        ready,
        what: view,
        tries: 120,
      });
    const library = "app.workspace.getLeavesOfType('zotlit-library')[0]?.view";
    const drawn = (layout: string) => (rows: Rows) =>
      rows.phase === "ready" &&
      rows.layout === layout &&
      rows.count !== null &&
      rows.rows.length === Number(rows.count);
    const papers = await rowsWhen(library, drawn("papers"));
    expect(papers.rows.toSorted()).toEqual(expected);

    // "Save as query file" sits in the heading beside Sort, and asks the
    // name and the folder only.
    expect(papers.toolbar).toEqual(["sort", "data-query-save-as"]);
    await obEval(
      run.vaultId,
      `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});press(leaf.view.contentEl.querySelector('[data-query-save-as]'),'Save as query file');return true;})()`,
    );
    const modal = "document.querySelector('.modal.zt-save-query-file-modal')";
    expect(
      await obEvalUntil(
        run.vaultId,
        `(function(){const modal=${modal};return JSON.stringify(modal?{title:modal.querySelector('.modal-title')?.textContent??null,fields:[...modal.querySelectorAll('[data-save-field]')].map(n=>n.getAttribute('data-save-field')),records:modal.querySelectorAll('[data-save-records]').length}:null);})()`,
        {
          expected: JSON.stringify({
            title: run.m.annot_view_save_title(),
            fields: ["name", "folder"],
            records: 0,
          }),
        },
      ),
    ).toBe(true);
    await obEval(
      run.vaultId,
      `(function(){${PAGE}const modal=${modal};const set=(field,value)=>{const input=modal.querySelector('[data-save-field="'+field+'"]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};set('name','Saved library');set('folder','query-files');press(modal.querySelector('.modal-button-container button.mod-cta'),'Save');return true;})()`,
    );

    // The file opens in a tab that lists the Library View's papers, in its
    // order, and only those of My Library.
    const tab = `(()=>{const view=app.workspace.getMostRecentLeaf()?.view;return view?.getViewType()==='zotlit-query-file'&&view.file?.path===${JSON.stringify(savedPath)}?view:null;})()`;
    const saved = await rowsWhen(tab, drawn("papers"));
    expect(saved.rows).toEqual(papers.rows);
    // The Query File keeps every control the Library View leaves out.
    expect(saved.toolbar).toEqual(
      expect.arrayContaining([
        "data-query-view-menu",
        "group",
        "filter",
        "data-query-properties",
      ]),
    );
    const text = await obEval(
      run.vaultId,
      `app.vault.read(app.vault.getFileByPath(${JSON.stringify(savedPath)}))`,
    );
    expect(text).toContain('library == "personal"');
    expect(text).toContain(
      `collections.within(${JSON.stringify(sharedKey.name)})`,
    );
  }, 180000);

  it("narrows the Library View by each Reading State facet to the seed's Items, with a Collection, counts the unread papers after the vault's pass, and keeps the facets across a plugin reload", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      run.vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document});await settings.flush();await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    // A Library View on My Library, with no facet.
    await obEval(
      run.vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)}});await settings.flush();return true;})()`,
    );

    const personal = ITEMS.filter(({ libraryID }) => libraryID === 1);
    const sharedKey = COLLECTIONS.find(
      (entry) => entry.libraryID === 1 && entry.key === "SHAREDCL",
    )!;
    const filed = personal.filter(({ collectionIDs }) =>
      collectionIDs.includes(sharedKey.collectionID),
    );
    const keys = (items: readonly FixtureItem[]) =>
      items.map(({ key }) => key).toSorted();
    const sharedNode = JSON.stringify(["personal", sharedKey.name]);

    interface Shown {
      phase: string;
      header: string | null;
      facets: Record<string, boolean>;
      selected: string | null;
      search: string;
      count: string | null;
      rows: string[];
    }
    const readShown = `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;if(!view?.tree)return 'null';await view.searched;await view.query.settled;await view.tree.settled;const el=view.contentEl;return JSON.stringify({phase:view.query.state.getState().phase,header:${LIBRARY_HEADING},facets:Object.fromEntries([...el.querySelectorAll('[data-library-facet]')].map(n=>[n.getAttribute('data-library-facet'),n.getAttribute('aria-pressed')==='true'])),selected:el.querySelector('[data-library-node][aria-selected="true"]')?.getAttribute('data-library-node')??null,search:el.querySelector('[data-library-search] input').value,count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,rows:[...el.querySelectorAll('[data-query-papers-row]')].map(n=>n.getAttribute('data-query-papers-row'))});})()`;
    /** What the view shows once it lists every row it counts with `facets` on. */
    const shownWith = async (
      facets: readonly string[],
      ready: (shown: Shown) => boolean = () => true,
    ) => {
      let shown: Shown | null = null;
      const settled = await waitFor(async () => {
        shown = JSON.parse(
          await obEval(run.vaultId, readShown),
        ) as Shown | null;
        return (
          shown !== null &&
          shown.phase === "ready" &&
          shown.count !== null &&
          shown.rows.length === Number(shown.count) &&
          Object.entries(shown.facets).every(
            ([id, on]) => on === facets.includes(id),
          ) &&
          ready(shown)
        );
      }, 120);
      if (!settled) throw new Error(`Library View: ${JSON.stringify(shown)}`);
      return shown!;
    };
    /**
     * Press the element `target` finds in the tree pane. A narrow pane keeps
     * the tree behind its button, so the press opens it first.
     */
    const inTree = (target: string, what: string) =>
      obEval(
        run.vaultId,
        `(async()=>{${PAGE}const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;const pane=el.querySelector('[data-library-tree]');if(getComputedStyle(pane).display==='none'){press(el.querySelector('[data-library-tree-toggle]'),'Library Tree button');await until('Library Tree',()=>getComputedStyle(pane).display!=='none');}press(${target},${JSON.stringify(what)});return true;})()`,
      );
    const facet = (id: string) =>
      inTree(
        `pane.querySelector('[data-library-facet="${id}"]')`,
        `${id} facet`,
      );

    await obEval(
      run.vaultId,
      "app.commands.executeCommandById('zotlit:open-library-view');true",
    );
    const opened = await shownWith([]);
    expect(opened.rows.toSorted()).toEqual(keys(personal));

    // Each facet narrows My Library to the Items the seed gives it.
    const oracle: Record<string, (item: FixtureItem) => boolean> = {
      unread: (item) => unreadOf([item]).length === 1,
      annotated: readingState.annotated,
      "has-note": readingState.noted,
      pdf: readingState.pdf,
    };
    for (const [id, keeps] of Object.entries(oracle)) {
      await facet(id);
      const narrowed = await shownWith([id]);
      expect(narrowed.rows.toSorted(), id).toEqual(
        keys(personal.filter(keeps)),
      );
      await facet(id);
      await shownWith([]);
    }

    // Facets combine with the Collection selected and with each other.
    await inTree(
      `[...pane.querySelectorAll('[data-library-node]')].find(n=>n.getAttribute('data-library-node')===${JSON.stringify(sharedNode)})`,
      "Collection",
    );
    await shownWith([], (shown) => shown.selected === sharedNode);
    await facet("annotated");
    const annotated = filed.filter(readingState.annotated);
    expect(annotated.length).toBeGreaterThan(0);
    expect((await shownWith(["annotated"])).rows.toSorted()).toEqual(
      keys(annotated),
    );
    await facet("pdf");
    const both = annotated.filter(readingState.pdf);
    expect(both.length).toBeGreaterThan(0);
    expect((await shownWith(["annotated", "pdf"])).rows.toSorted()).toEqual(
      keys(both),
    );
    await facet("annotated");
    await facet("pdf");
    await shownWith([]);

    // The vault loses the Literature Note of an Item with no Annotation: the
    // Item becomes unread, in the list and in the header's count.
    const reader = filed.find(
      (item) =>
        !readingState.read(item) &&
        !readingState.annotated(item) &&
        readingState.noted(item),
    )!;
    const notePath = await obEval(
      run.vaultId,
      `${services}.noteIndex.getNotesByItemKey(${JSON.stringify(reader.key)})[0]?.path??''`,
    );
    expect(notePath).not.toBe("");
    const moveNote = (from: string, to: string) =>
      obEval(
        run.vaultId,
        `(async()=>{await app.vault.rename(app.vault.getAbstractFileByPath(${JSON.stringify(from)}),${JSON.stringify(to)});return true;})()`,
      );
    // A paper already read in Zotero stays out of Unread after its note is removed.
    const readPaper = filed.find(
      (item) => readingState.read(item) && !readingState.annotated(item),
    )!;
    expect(readPaper.key).toBe("IANNP5A2");
    const readNotePath = await obEval(
      run.vaultId,
      `${services}.noteIndex.getNotesByItemKey(${JSON.stringify(readPaper.key)})[0]?.path??''`,
    );
    expect(readNotePath).not.toBe("");
    await moveNote(readNotePath, `${readNotePath}.away`);
    cleanup.defer(async () => {
      await moveNote(`${readNotePath}.away`, readNotePath);
    });
    const away = `${notePath}.away`;
    await moveNote(notePath, away);
    cleanup.defer(async () => {
      await moveNote(away, notePath);
    });
    const noted = (item: FixtureItem) =>
      item !== reader && readingState.noted(item);
    await facet("unread");
    const unread = await shownWith(
      ["unread"],
      (shown) =>
        shown.header ===
        suite.libraryHeader(sharedKey.name, filed, {
          noted,
          shown: unreadOf(filed, noted).length,
        }),
    );
    expect(unread.rows.toSorted()).toEqual(keys(unreadOf(filed, noted)));
    expect(unread.rows).toContain(reader.key);

    // A search keeps to the facets: in the Collection, then in every
    // Library, each in the quick switcher's rank.
    const lookup = async (query: string, everywhere: boolean) =>
      JSON.parse(
        await obEval(
          run.vaultId,
          `(async()=>{const s=${services};const libraries=${everywhere ? "s.libraryScope.current.available" : "s.libraryScope.libraries.filter(l=>l.selector.type==='personal')"};return JSON.stringify((await s.itemLookup.search(${JSON.stringify(query)},{limit:500,libraries})).map(h=>h.item.indexedKey));})()`,
        ),
      ) as string[];
    /**
     * Type `text` into the search box as a researcher does: the press into
     * the box, on its part the tree leaves uncovered, puts away the tree a
     * facet press left open over a narrow list.
     */
    const type = (text: string) =>
      obEval(
        run.vaultId,
        `(async()=>{${PAGE}const view=app.workspace.getLeavesOfType('zotlit-library')[0].view;const input=view.contentEl.querySelector('[data-library-search] input');input.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));input.focus();await until('Library Tree put away',()=>!view.tree.store.getState().open);input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
      );
    const indexedKey = (item: FixtureItem) => {
      const { groupID } = LIBRARIES.find(
        (entry) => entry.libraryID === item.libraryID,
      )!;
      return groupID === null ? item.key : `${item.key}g${groupID}`;
    };
    const unreadHere = new Set(unreadOf(filed, noted).map(indexedKey));
    const unreadAnywhere = new Set(unreadOf(ITEMS, noted).map(indexedKey));
    await type(reader.title);
    const here = (await lookup(reader.title, false)).filter((key) =>
      unreadHere.has(key),
    );
    expect(here).toContain(reader.key);
    expect(
      (
        await shownWith(
          ["unread"],
          (shown) =>
            shown.search === reader.title && shown.rows.length === here.length,
        )
      ).rows,
    ).toEqual(here);
    await obEval(
      run.vaultId,
      `(()=>{${PAGE}press(app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl.querySelector('[data-library-search-all]'),'Search all libraries');return true;})()`,
    );
    const anywhere = (await lookup(reader.title, true)).filter((key) =>
      unreadAnywhere.has(key),
    );
    expect(
      (
        await shownWith(
          ["unread"],
          (shown) =>
            shown.header ===
            run.m.library_view_heading_search({
              count: anywhere.length,
              query: reader.title,
            }),
        )
      ).rows,
    ).toEqual(anywhere);
    await type("");
    await shownWith(
      ["unread"],
      (shown) =>
        shown.search === "" &&
        shown.header ===
          suite.libraryHeader(sharedKey.name, filed, {
            noted,
            shown: unreadOf(filed, noted).length,
          }),
    );

    // A plugin reload comes back on the Collection with the facet on.
    expect(
      await obEvalUntil(
        run.vaultId,
        "app.plugins.disablePlugin('zotlit').then(function () { return app.plugins.enablePlugin('zotlit'); }).then(function () { return true; })",
        { expected: "true", tries: 20 },
      ),
    ).toBe(true);
    const reloaded = await shownWith(
      ["unread"],
      (shown) =>
        shown.selected === sharedNode &&
        shown.header ===
          suite.libraryHeader(sharedKey.name, filed, {
            noted,
            shown: unreadOf(filed, noted).length,
          }),
    );
    expect(reloaded.rows.toSorted()).toEqual(unread.rows.toSorted());
  }, 180000);

  it("narrows the Library View by the tags selected in the Tag Selector to the seed's Items with every one, filters the tag names alone, deselects them all, and keeps them across a plugin reload", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      run.vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document});await settings.flush();await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    // A Library View on My Library, with no tag selected: a document of an
    // earlier build, which stored none.
    await obEval(
      run.vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)}});await settings.flush();return true;})()`,
    );

    const personal = ITEMS.filter(({ libraryID }) => libraryID === 1);
    const tagsOf = (item: FixtureItem) =>
      (item.tags ?? []).map(({ name }) => name);
    const withEvery = (tags: readonly string[]) =>
      personal.filter((item) =>
        tags.every((tag) => tagsOf(item).includes(tag)),
      );
    const namesOf = (items: readonly FixtureItem[]) =>
      [...new Set(items.flatMap(tagsOf))].toSorted();
    const keys = (items: readonly FixtureItem[]) =>
      items.map(({ key }) => key).toSorted();

    interface Shown {
      phase: string;
      header: string | null;
      tags: string[];
      pressed: string[];
      /** The filter chips under the heading, by their hook. */
      chips: string[];
      count: string | null;
      rows: string[];
    }
    const readShown = `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;if(!view?.tree)return 'null';await view.searched;await view.query.settled;await view.tree.settled;const el=view.contentEl;const tags=[...el.querySelectorAll('[data-library-tag]')];return JSON.stringify({phase:view.query.state.getState().phase,header:${LIBRARY_HEADING},tags:tags.map(n=>n.getAttribute('data-library-tag')),chips:[...el.querySelectorAll('[data-library-filter]')].map(n=>n.getAttribute('data-library-filter')),pressed:tags.filter(n=>n.getAttribute('aria-pressed')==='true').map(n=>n.getAttribute('data-library-tag')),count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,rows:[...el.querySelectorAll('[data-query-papers-row]')].map(n=>n.getAttribute('data-query-papers-row'))});})()`;
    /** What the view shows once it lists every row it counts with `pressed` selected. */
    const shownWith = async (
      pressed: readonly string[],
      ready: (shown: Shown) => boolean = () => true,
    ) => {
      let shown: Shown | null = null;
      const settled = await waitFor(async () => {
        shown = JSON.parse(
          await obEval(run.vaultId, readShown),
        ) as Shown | null;
        return (
          shown !== null &&
          shown.phase === "ready" &&
          shown.count !== null &&
          shown.rows.length === Number(shown.count) &&
          JSON.stringify(shown.pressed) === JSON.stringify(pressed) &&
          ready(shown)
        );
      }, 120);
      if (!settled) throw new Error(`Library View: ${JSON.stringify(shown)}`);
      return shown!;
    };
    /** Press `target` in the tree pane, opening the tree first on a narrow pane. */
    const inTree = (target: string, what: string) =>
      obEval(
        run.vaultId,
        `(async()=>{${PAGE}const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;const pane=el.querySelector('[data-library-tree]');if(getComputedStyle(pane).display==='none'){press(el.querySelector('[data-library-tree-toggle]'),'Library Tree button');await until('Library Tree',()=>getComputedStyle(pane).display!=='none');}press(${target},${JSON.stringify(what)});return true;})()`,
      );
    const tag = (name: string) =>
      inTree(
        `[...pane.querySelectorAll('[data-library-tag]')].find(n=>n.getAttribute('data-library-tag')===${JSON.stringify(name)})`,
        `${name} tag`,
      );
    /** The chips under the heading while `tags` are selected. */
    const tagged = (tags: readonly string[]) => tags.map((tag) => `tag:${tag}`);

    await obEval(
      run.vaultId,
      "app.commands.executeCommandById('zotlit:open-library-view');true",
    );
    // The Tag Selector lists the tags of My Library's Items.
    const opened = await shownWith([], (shown) => shown.tags.length > 0);
    expect(opened.rows.toSorted()).toEqual(keys(personal));
    expect(opened.tags.toSorted()).toEqual(namesOf(personal));

    // A tag narrows the list to its Items, and the tags to theirs.
    const first = "fixture-core";
    await tag(first);
    const one = await shownWith([first]);
    expect(withEvery([first]).length).toBeGreaterThan(0);
    expect(one.rows.toSorted()).toEqual(keys(withEvery([first])));
    expect(one.tags.toSorted()).toEqual(namesOf(withEvery([first])));

    // A second tag narrows to the Items with both, the heading counts them
    // of all My Library holds, and a chip under it names each tag.
    const second = one.tags.find((name) => name !== first)!;
    expect(second).toBeDefined();
    await tag(second);
    const both = [first, second].toSorted();
    const two = await shownWith(
      both,
      (shown) => JSON.stringify(shown.chips) === JSON.stringify(tagged(both)),
    );
    expect(two.header).toContain(
      run.m.library_view_heading_papers_of({
        count: withEvery(both).length,
        total: personal.length,
      }),
    );
    expect(withEvery(both).length).toBeGreaterThan(0);
    expect(two.rows.toSorted()).toEqual(keys(withEvery(both)));

    // The "Filter tags" box narrows the names it shows, never the papers.
    await obEval(
      run.vaultId,
      `(()=>{const input=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl.querySelector('[data-library-tags-filter]');input.value='zzz-no-tag';input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
    );
    const filtered = await shownWith(
      both,
      (shown) => shown.tags.length === both.length,
    );
    expect(filtered.tags).toEqual(both);
    expect(filtered.rows).toEqual(two.rows);

    // A plugin reload comes back with the tags selected.
    expect(
      await obEvalUntil(
        run.vaultId,
        "app.plugins.disablePlugin('zotlit').then(function () { return app.plugins.enablePlugin('zotlit'); }).then(function () { return true; })",
        { expected: "true", tries: 20 },
      ),
    ).toBe(true);
    const reloaded = await shownWith(both);
    expect(reloaded.rows).toEqual(two.rows);

    // Deselect all lists every Item of My Library again.
    await inTree(
      "pane.querySelector('[data-library-tags-clear]')",
      "Deselect all",
    );
    const cleared = await shownWith(
      [],
      (shown) => shown.rows.length === personal.length,
    );
    expect(cleared.rows.toSorted()).toEqual(keys(personal));
    expect(
      await obEval(
        run.vaultId,
        `JSON.stringify(${services}.settings.current['library.document'].tags)`,
      ),
    ).toBe("[]");
  }, 180000);

  it("searches the Library View as the quick switcher ranks, inside the tree node, with tag:, Search all libraries and Escape", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      run.vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null,scope:${services}.settings.current[${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}]??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document,${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:saved.scope});await settings.flush();await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    // Every Library is in the Library Scope; the tab opens on My Library.
    await obEval(
      run.vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)},${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:{mode:'all'}});await settings.flush();return true;})()`,
    );

    // The seed's oracle.
    const personal = LIBRARIES.find((entry) => entry.type === "user")!;
    const indexedKey = (item: FixtureItem) => {
      const { groupID } = LIBRARIES.find(
        (entry) => entry.libraryID === item.libraryID,
      )!;
      return groupID === null ? item.key : `${item.key}g${groupID}`;
    };
    const inPersonal = ITEMS.filter(
      (item) => item.libraryID === personal.libraryID,
    );
    const subtree = (collectionID: number): number[] => [
      collectionID,
      ...COLLECTIONS.filter(
        (entry) => entry.parentCollectionID === collectionID,
      ).flatMap((child) => subtree(child.collectionID)),
    ];
    const sharedKey = COLLECTIONS.find(
      (entry) =>
        entry.libraryID === personal.libraryID && entry.key === "SHAREDCL",
    )!;
    const inSharedKey = new Set(
      inPersonal
        .filter(({ collectionIDs }) =>
          collectionIDs.some((id) =>
            subtree(sharedKey.collectionID).includes(id),
          ),
        )
        .map(indexedKey),
    );
    /** The Indexed Keys the quick switcher's search answers, best first. */
    const lookup = async (query: string, everywhere: boolean) =>
      JSON.parse(
        await obEval(
          run.vaultId,
          `(async()=>{const s=${services};const libraries=${everywhere ? "s.libraryScope.current.available" : "s.libraryScope.libraries.filter(l=>l.selector.type==='personal')"};return JSON.stringify((await s.itemLookup.search(${JSON.stringify(query)},{limit:500,libraries})).map(h=>h.item.indexedKey));})()`,
        ),
      ) as string[];

    interface Shown {
      phase: string;
      header: string | null;
      value: string;
      focused: boolean;
      /** The offer beside the header to search all libraries, while it shows. */
      searchAll: string | null;
      rows: string[];
    }
    const readShown = `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;if(!view?.search)return 'null';await view.searched;await view.query.settled;const el=view.contentEl;const input=el.querySelector('[data-library-search] input');return JSON.stringify({phase:view.query.state.getState().phase,header:${LIBRARY_HEADING},value:input.value,focused:document.activeElement===input,searchAll:el.querySelector('[data-library-search-all]')?.textContent??null,rows:[...el.querySelectorAll('tr[data-query-table-row="item"], [data-query-papers-row]')].map(n=>n.getAttribute('data-query-key')??n.getAttribute('data-query-papers-row'))});})()`;
    const shownWhen = (ready: (shown: Shown) => boolean) =>
      obReadUntil<Shown>(run.vaultId, readShown, {
        ready: (shown) => shown.phase === "ready" && ready(shown),
        what: "Library View",
        tries: 120,
      });
    /** Type `text` into the search box, as the keyboard sets an input's value. */
    const type = (text: string) =>
      obEval(
        run.vaultId,
        `(()=>{const input=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl.querySelector('[data-library-search] input');input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
      );
    const header = (shown: Shown) => shown.header;

    await obEval(
      run.vaultId,
      "app.commands.executeCommandById('zotlit:open-library-view');true",
    );
    // The search box has the cursor; the list shows My Library.
    const opened = await shownWhen(
      (shown) => shown.rows.length === inPersonal.length,
    );
    expect(opened.focused).toBe(true);
    expect(opened.rows.toSorted()).toEqual(
      inPersonal.map(indexedKey).toSorted(),
    );

    // A seeded title ranks its Item first, and the rows keep the order of
    // the quick switcher's search.
    const title = "Communicating with Slip Boxes";
    const wanted = inPersonal.find((item) => item.title.startsWith(title))!;
    await type(title);
    const ranked = await shownWhen((shown) => shown.value === title);
    expect(ranked.rows[0]).toBe(indexedKey(wanted));
    expect(ranked.rows).toEqual(await lookup(title, false));

    // The search keeps to the selected Collection; Search all libraries
    // widens it past the Collection, to every Library.
    await type("duplicate");
    const library = await shownWhen((shown) => shown.value === "duplicate");
    expect(library.rows).toEqual(await lookup("duplicate", false));
    await obEval(
      run.vaultId,
      `(()=>{${PAGE}const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;const pane=el.querySelector('[data-library-tree]');const row=[...pane.querySelectorAll('[data-library-node]')].find(n=>n.getAttribute('data-library-node')===${JSON.stringify(JSON.stringify(["personal", sharedKey.name]))});if(getComputedStyle(pane).display==='none')press(el.querySelector('[data-library-tree-toggle]'),'Library Tree button');press(row,'Collection');return true;})()`,
    );
    const filed = (await lookup("duplicate", false)).filter((key) =>
      inSharedKey.has(key),
    );
    const collection = await shownWhen(
      (shown) =>
        shown.rows.length === filed.length &&
        header(shown) ===
          `${run.m.library_view_heading_search({ count: filed.length, query: "duplicate" })} | ${run.m.library_view_search_everywhere()}` &&
        shown.searchAll === run.m.library_view_search_everywhere(),
    );
    expect(collection.rows).toEqual(filed);
    await obEval(
      run.vaultId,
      `(()=>{${PAGE}press(app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl.querySelector('[data-library-search-all]'),'Search all libraries');return true;})()`,
    );
    const everywhere = await lookup("duplicate", true);
    expect(
      everywhere.some((key) => !inPersonal.map(indexedKey).includes(key)),
    ).toBe(true);
    const widened = await shownWhen(
      (shown) =>
        header(shown) ===
        run.m.library_view_heading_search({
          count: everywhere.length,
          query: "duplicate",
        }),
    );
    expect(widened.rows).toEqual(everywhere);

    // A tag: token narrows to the seeded Items with that tag.
    await obEval(
      run.vaultId,
      `(()=>{${PAGE}const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;const pane=el.querySelector('[data-library-tree]');const row=[...pane.querySelectorAll('[data-library-node]')].find(n=>n.getAttribute('data-library-node')===${JSON.stringify(JSON.stringify(["personal"]))});if(getComputedStyle(pane).display==='none')press(el.querySelector('[data-library-tree-toggle]'),'Library Tree button');press(row,'My Library');return true;})()`,
    );
    await type("tag:fixture-core");
    const tagged = inPersonal
      .filter((item) => item.tags?.some(({ name }) => name === "fixture-core"))
      .map(indexedKey);
    expect(tagged.length).toBeGreaterThan(0);
    const byTag = await shownWhen(
      (shown) =>
        shown.value === "tag:fixture-core" &&
        shown.rows.length === tagged.length,
    );
    expect(byTag.rows.toSorted()).toEqual(tagged.toSorted());

    // Escape clears the search, and the list shows My Library again.
    await obEval(
      run.vaultId,
      "(()=>{const input=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl.querySelector('[data-library-search] input');input.focus();input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true;})()",
    );
    const cleared = await shownWhen(
      (shown) => shown.value === "" && shown.rows.length === inPersonal.length,
    );
    expect(cleared.rows).toEqual(opened.rows);
    expect(cleared.header).toBe(
      suite.libraryHeader(run.m.settings_library_scope_personal(), inPersonal),
    );
  });

  it("answers the quick switcher's keys on a Library View row, lists its actions in a menu other plugins add to, inserts its citation by menu and by drag, and shows it in the Library View from the quick switcher, with Zotero closed", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      run.vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.settings.current['library.document']??null})`,
    );
    const notePath = "Library row citations.md";
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update({'library.document':saved.document});await settings.flush();const file=app.vault.getFileByPath(${JSON.stringify(notePath)});if(file)await app.vault.delete(file);await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });

    // The seed's oracle: an Item with its Literature Note and one PDF, an
    // Item with no Literature Note that two Profiles fit, and an Item filed
    // in one subcollection.
    const reading = annotationItem;
    const readingPdf = ATTACHMENTS.filter(
      ({ parentItemID }) => parentItemID === reading.itemID,
    );
    expect(readingPdf.map(({ key }) => key)).toEqual([
      annotationAttachment.key,
    ]);
    const unwritten = booksProfileTargetItem;
    const unwrittenGroup = LIBRARIES.find(
      ({ libraryID }) => libraryID === unwritten.libraryID,
    )!.groupID!;
    const unwrittenKey = `${unwritten.key}g${unwrittenGroup}`;
    // The Literature Note that Enter writes below goes when the test ends,
    // whichever step fails first, and the test fails while one stays: by the
    // Note Index or by its frontmatter.
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{${PAGE}const key=${JSON.stringify(unwrittenKey)};const written=()=>[...new Set([...${services}.noteIndex.getNotesByItemKey(key),...app.vault.getMarkdownFiles().filter(file=>app.metadataCache.getFileCache(file)?.frontmatter?.['zotero-key']===key)])];for(const file of written())await app.vault.delete(file);await until('no Literature Note of '+key+' left',()=>written().length===0,10000);return true;})()`,
      );
    });
    const child = COLLECTIONS.find(({ key }) => key === "PERSCHLD")!;
    const parent = COLLECTIONS.find(
      ({ collectionID }) => collectionID === child.parentCollectionID,
    )!;
    const filed = ITEMS.find(
      (item) =>
        item.libraryID === child.libraryID &&
        item.collectionIDs.length === 1 &&
        item.collectionIDs[0] === child.collectionID,
    )!;

    // The Library View on My Library, and beside it a note to cite into, in
    // a window wide enough that the Reading Card, which shows over a
    // narrow list, leaves the start of each row in reach.
    await suite.wideWindow(cleanup);
    await obEval(
      run.vaultId,
      `(async()=>{${PAGE}app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const settings=${services}.settings;settings.update({'library.document':null});await settings.flush();const file=app.vault.getFileByPath(${JSON.stringify(notePath)})??await app.vault.create(${JSON.stringify(notePath)},'LEFT RIGHT');app.commands.executeCommandById('zotlit:open-library-view');await until('library',()=>app.workspace.getLeavesOfType('zotlit-library')[0]);await app.workspace.getLeaf('split').openFile(file);return true;})()`,
    );
    /**
     * Run `script` with the Library View's tab active and `el` its content.
     * `pressRow` presses a row near its start, where a reader clicks while
     * the Reading Card over a narrow list covers the row's far end: it
     * presses what stands at that point, inside the row, through `press`.
     */
    const inLibrary = (script: string) =>
      obEval(
        run.vaultId,
        `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});await leaf.view.query.settled;const el=leaf.view.contentEl;const row=key=>el.querySelector('[data-query-item-row="'+key+'"]');const keydown=(target,init)=>target.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,...init}));const pressRow=(el,what)=>{if(!el)throw new Error('Missing: '+what);el.scrollIntoView({block:'center',behavior:'instant'});const r=el.getBoundingClientRect();const hit=el.ownerDocument.elementFromPoint(r.left+24,r.top+r.height/2);if(!hit||!el.contains(hit))throw new Error('Covered: '+what+' (by '+(hit?hit.outerHTML.slice(0,80):'nothing')+')');press(hit,what);return el;};${script}})()`,
      );
    const active = () => activeTab(run.vaultId);
    const activeWhen = (ready: (shown: ActiveTab) => boolean) =>
      readUntil(active, ready, { what: "Active tab", tries: 60 });
    /** The selected row's key, waiting until a row of the list is drawn. */
    const selected = () =>
      inLibrary(
        `await until('rows',()=>el.querySelector('[data-query-item-row]'),10000);return el.querySelector('[data-query-item-row][data-selected]')?.getAttribute('data-query-item-row')??'none'`,
      );

    // A click selects a row and opens nothing; ↓ moves the selection to the
    // next row on screen.
    const { next } = JSON.parse(
      await inLibrary(
        `await until('rows',()=>row(${JSON.stringify(reading.key)}),10000);pressRow(row(${JSON.stringify(reading.key)}),'reading row');const keys=[...el.querySelectorAll('[data-query-item-row]')].map(n=>n.getAttribute('data-query-item-row'));keydown(row(${JSON.stringify(reading.key)}),{key:'ArrowDown'});return JSON.stringify({next:keys[keys.indexOf(${JSON.stringify(reading.key)})+1]})`,
      ),
    ) as { next: string };
    // A row drawn moments before takes the selection to its markup a frame
    // later.
    expect(
      await readUntil(selected, (key) => key === next, {
        what: "Selected row",
      }),
    ).toBe(next);
    expect((await active()).type).toBe("zotlit-library");

    // Enter opens the Item's Literature Note; Shift+Enter its PDF in
    // Obsidian.
    await inLibrary(
      `pressRow(row(${JSON.stringify(reading.key)}),'reading row');keydown(row(${JSON.stringify(reading.key)}),{key:'Enter'});return true`,
    );
    // Shift+Enter opens the PDF in the tab the note opened in, once that
    // open is done.
    expect(
      await activeWhen((shown) => shown.type === "markdown" && !shown.opening),
    ).toMatchObject({ key: reading.key });
    await inLibrary(
      `pressRow(row(${JSON.stringify(reading.key)}),'reading row');keydown(row(${JSON.stringify(reading.key)}),{key:'Enter',shiftKey:true});return true`,
    );
    expect(await pdfOpened(run.vaultId, annotationAttachment.path!)).toBe(true);

    // On an Item with no Literature Note, Enter writes one through the
    // Profile selection, as the quick switcher does.
    await inLibrary(
      `const groupNode=[...el.querySelectorAll('[data-library-node]')].find(n=>n.getAttribute('data-library-node')===${JSON.stringify(JSON.stringify([`group:${unwrittenGroup}`]))});if(!groupNode.checkVisibility())press(el.querySelector('[data-library-tree-toggle]'),'tree toggle');press(groupNode,'group library');await until('group rows',()=>groupNode.getAttribute('aria-selected')==='true'&&leaf.view.query.state.getState().phase==='ready'&&row(${JSON.stringify(unwrittenKey)}),10000);pressRow(row(${JSON.stringify(unwrittenKey)}),'unwritten row');keydown(row(${JSON.stringify(unwrittenKey)}),{key:'Enter'});return true`,
    );
    // The picker reads every Profile's preview before it shows.
    expect(
      await obEvalUntil(
        run.vaultId,
        `String(Array.from(activeDocument.querySelectorAll('.prompt .suggestion-item')).some(el=>el.textContent.includes(${JSON.stringify(booksProfile.label)})))`,
        { expected: "true", tries: 120 },
      ),
    ).toBe(true);
    expect(await selectSuggestion(run.vaultId, booksProfile.label)).toContain(
      booksProfile.label,
    );
    await pressPromptKey(run.vaultId, "Enter");
    const written = await activeWhen(
      (shown) => shown.type === "markdown" && shown.key === unwrittenKey,
    );
    expect(written.path).toMatch(/^books\//);

    // The row menu lists every action of the Item, and an entry another
    // plugin adds through `zotlit:item-menu`. This Item holds no PDF, so the
    // menu offers no Open PDF. The note to cite into is the
    // one active last; the notes and the PDF opened above took the tab
    // beside the view, so it opens again.
    await obEval(
      run.vaultId,
      `(async()=>{const leaf=app.workspace.getLeaf('split');await leaf.openFile(app.vault.getFileByPath(${JSON.stringify(notePath)}));app.workspace.setActiveLeaf(leaf,{focus:true});leaf.view.editor.setCursor({line:0,ch:'LEFT '.length});return true;})()`,
    );
    const menu = JSON.parse(
      await inLibrary(
        `const ref=app.workspace.on('zotlit:item-menu',(menu,info)=>menu.addItem(item=>item.setTitle('Listener: '+info.source+' '+info.indexedKey).setIcon('star')));try{const target=row(${JSON.stringify(unwrittenKey)});const r=target.getBoundingClientRect();target.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+20,clientY:r.top+10}));const menu=await until('row menu',()=>activeDocument.querySelector('.menu'));return JSON.stringify([...menu.querySelectorAll('.menu-item')].map(item=>item.textContent));}finally{app.workspace.offref(ref);}`,
      ),
    ) as string[];
    expect(menu).toEqual([
      run.m.library_view_menu_open_note(),
      run.m.library_view_menu_insert_citation(),
      run.m.graph_citations_menu_copy_citekey(),
      run.m.library_view_menu_show_in_zotero(),
      `Listener: library-view ${unwrittenKey}`,
    ]);

    // Insert citation puts the Item's citation into the note last active.
    await inLibrary(
      `press([...activeDocument.querySelectorAll('.menu .menu-item')].find(item=>item.textContent===${JSON.stringify(run.m.library_view_menu_insert_citation())}),'Insert citation');return true`,
    );
    const noteText = () =>
      obEval(
        run.vaultId,
        `app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.file?.path===${JSON.stringify(notePath)}).view.editor.getValue()`,
      );
    const cited = (text: string) =>
      text.split(`@${unwritten.citationKey}`).length - 1;
    expect(await waitFor(async () => cited(await noteText()) === 1)).toBe(true);
    // At the cursor, between the words.
    expect(await noteText()).toMatch(/^LEFT .+RIGHT$/);

    // A row dragged over the view is refused; dropped into the note, it
    // inserts its citation where it lands.
    const drag = JSON.parse(
      await inLibrary(
        `const note=app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.file?.path===${JSON.stringify(notePath)});const cm=note.view.editor.cm;const transfer=new DataTransfer();const source=row(${JSON.stringify(unwrittenKey)});source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));const over=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer});el.querySelector('[data-library-node]').dispatchEvent(over);const refused=over.defaultPrevented&&transfer.dropEffect==='none';const at=cm.coordsAtPos(0);cm.contentDOM.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:Math.floor(at.left+1),clientY:Math.floor((at.top+at.bottom)/2)}));source.dispatchEvent(new DragEvent('dragend',{bubbles:true}));return JSON.stringify({refused,types:[...transfer.types]});`,
      ),
    ) as { refused: boolean; types: string[] };
    expect(drag).toEqual({
      refused: true,
      types: ["text/plain", "application/x-zotlit-item"],
    });
    expect(await waitFor(async () => cited(await noteText()) === 2)).toBe(true);
    // At the start, where it landed.
    expect(await noteText()).not.toMatch(/^LEFT/);

    // "Show in Library" in the quick switcher opens the view on the Item's
    // Collection, with its row selected.
    await obEval(
      run.vaultId,
      `(async()=>{const leaf=app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.file?.path===${JSON.stringify(notePath)});await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});app.commands.executeCommandById('zotlit:note-quick-switcher');return true;})()`,
    );
    expect(
      await obEvalUntil(
        run.vaultId,
        "String(!!activeDocument.querySelector('.prompt input'))",
        { expected: "true" },
      ),
    ).toBe(true);
    await selectItemSuggestion(run.vaultId, filed.title, filed.key);
    await pressPromptKey(run.vaultId, "Enter", { altKey: true });
    expect(
      await obEvalUntil(
        run.vaultId,
        `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;if(app.workspace.activeLeaf?.view!==view)return 'not active';await view.query.settled;const el=view.contentEl;return JSON.stringify({node:el.querySelector('[data-library-node][aria-selected=true]')?.getAttribute('data-library-node'),row:el.querySelector('[data-query-item-row][data-selected]')?.getAttribute('data-query-item-row')});})()`,
        {
          expected: JSON.stringify({
            node: JSON.stringify(["personal", parent.name, child.name]),
            row: filed.key,
          }),
        },
      ),
    ).toBe(true);
  }, 180000);

  it("opens the Library View once on a fresh install, shows the Welcome View banner above it until dismissed, whose Search your library focuses the Library View's search box, and says where Zotero's data folder is missing until it is set", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const dataPath = "app.vault.configDir+'/plugins/zotlit/data.json'";
    const reload =
      "app.plugins.disablePlugin('zotlit').then(function () { return app.plugins.enablePlugin('zotlit'); }).then(function () { return true; })";
    const snapshot = await obEval(
      run.vaultId,
      `(async()=>JSON.stringify({layout:app.workspace.getLayout(),data:await app.vault.adapter.read(${dataPath}),dataDir:${services}.zoteroPref.dataDirOverride}))()`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});${services}.zoteroPref.setDataDir(saved.dataDir);await ${services}.settings.flush();await app.plugins.disablePlugin('zotlit');await app.vault.adapter.write(${dataPath},saved.data);await app.plugins.enablePlugin('zotlit');await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    const libraryLeaves = () =>
      obEval(
        run.vaultId,
        "String(app.workspace.getLeavesOfType('zotlit-library').length)",
      );
    /** Reload the plugin and wait for its release check to open what it opens. */
    const reloadAndCheck = () =>
      obEval(
        run.vaultId,
        `(async()=>{await ${reload};await ${services}.release.checked;return true;})()`,
      );

    // A fresh install has no plugin data: the release check opens the
    // Library View, once.
    await obEval(
      run.vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());await ${services}.settings.flush();await app.plugins.disablePlugin('zotlit');await app.vault.adapter.remove(${dataPath});return true;})()`,
    );
    expect(
      await obEvalUntil(
        run.vaultId,
        `(async()=>{await ${reload};return true;})()`,
        {
          expected: "true",
          tries: 20,
        },
      ),
    ).toBe(true);
    expect(
      await obEvalUntil(
        run.vaultId,
        "String(app.workspace.getLeavesOfType('zotlit-library').length)",
        { expected: "1" },
      ),
    ).toBe(true);
    // The release check recorded this launch in plugin data, which the next
    // launch reads.
    await obEval(
      run.vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());await ${services}.settings.flush();return true;})()`,
    );
    await reloadAndCheck();
    expect(await libraryLeaves()).toBe("0");

    // Setup is incomplete while the literature-notes folder is missing: the
    // banner shows the checklist and the Help Links above the Library View,
    // and names no Companion.
    await obEval(
      run.vaultId,
      `(async()=>{${services}.settings.updateDefaultLiteratureNoteProfileBindings({'note.literature-folder':'Not yet created'});await app.commands.executeCommandById('zotlit:open-library-view');return true;})()`,
    );
    const banner = `app.workspace.getLeavesOfType('zotlit-library')[0]?.view.contentEl.querySelector('[data-welcome-banner]')`;
    const readBanner = `(()=>{const el=${banner};if(!el)return 'null';return JSON.stringify({steps:[...el.querySelectorAll('[role=heading][aria-level="3"]')].map(n=>n.textContent),open:el.querySelector('[data-welcome-step][data-open] [role=heading]')?.textContent,help:[...el.querySelectorAll('[data-welcome-help] a')].map(a=>a.getAttribute('href')),companion:el.textContent.includes('Companion')});})()`;
    expect(
      await obEvalUntil(run.vaultId, readBanner, {
        expected: JSON.stringify({
          steps: [
            run.m.welcome_step_connect_title(),
            run.m.welcome_step_folder_title(),
            run.m.welcome_step_library_title(),
          ],
          // Zotero reads, so the folder is the one step still open.
          open: run.m.welcome_step_folder_title(),
          // The Help Links show beside the checklist.
          help: [
            "https://zotlit.aidenlx.site/docs",
            "https://zotlit.aidenlx.site/community",
            "https://github.com/aidenlx/zotlit",
            "https://zotlit.aidenlx.site/docs/reference/templates",
            "https://zotlit.aidenlx.site/docs/how-to/insert-citations",
            "https://zotlit.aidenlx.site/blog",
            "https://zotlit.aidenlx.site/changelog",
            "https://github.com/sponsors/aidenlx",
            "https://zotlit.aidenlx.site/docs/how-to/migrate-from-v1",
          ],
          companion: false,
        }),
      }),
    ).toBe(true);
    // Search your library puts the cursor in the Library View's own search
    // box, just under the banner.
    expect(
      await obEval(
        run.vaultId,
        `(async()=>{${PAGE}const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;press([...${banner}.querySelectorAll('button')].find(n=>n.textContent===${JSON.stringify(run.m.welcome_action_search())}),'Search your library');const input=el.querySelector('[data-library-search] input');await until('search box focused',()=>input.ownerDocument.activeElement===input);return String(!activeDocument.querySelector('.modal-container'));})()`,
      ),
    ).toBe("true");
    // A notice over the tab's corner would cover the dismiss control.
    await clearNotices(run.vaultId);
    await obEval(
      run.vaultId,
      `(async()=>{${PAGE}press(${banner}.querySelector('[data-welcome-dismiss]'),'Dismiss the welcome banner');await until('banner gone',()=>!${banner});return true;})()`,
    );
    expect(
      await obEval(
        run.vaultId,
        `String(${services}.settings.current['welcome.dismissed'])`,
      ),
    ).toBe("true");
    // The Welcome command shows it again.
    await obEval(
      run.vaultId,
      "app.commands.executeCommandById('zotlit:open-welcome-view');true",
    );
    expect(
      await obEvalUntil(run.vaultId, `String(!!${banner})`, {
        expected: "true",
      }),
    ).toBe(true);
    // So does the Welcome & help view action in the tab header, with the
    // setup steps, and focus moves to the banner; the action reads as
    // pressed while the banner shows, and a second press dismisses it.
    await obEval(
      run.vaultId,
      `(async()=>{${PAGE}press(${banner}.querySelector('[data-welcome-dismiss]'),'Dismiss the welcome banner');await until('banner gone',()=>!${banner});return true;})()`,
    );
    const helpAction = `app.workspace.getLeavesOfType('zotlit-library')[0].view.containerEl.querySelector(${JSON.stringify(`.view-actions .view-action[aria-label="${run.m.library_view_help_action()}"]`)})`;
    const readHelpAction = `const action=${helpAction};const pressed={active:action.classList.contains('is-active'),pressed:action.getAttribute('aria-pressed')};`;
    expect(
      await obEval(
        run.vaultId,
        `(async()=>{${PAGE}const view=app.workspace.getLeavesOfType('zotlit-library')[0].view;const before={active:${helpAction}.classList.contains('is-active'),pressed:${helpAction}.getAttribute('aria-pressed')};press(${helpAction},${JSON.stringify(run.m.library_view_help_action())});const el=await until('banner back',()=>${banner});await until('banner focused',()=>el.ownerDocument.activeElement===el);${readHelpAction}return JSON.stringify({before,dismissed:${services}.settings.current['welcome.dismissed'],steps:el.querySelectorAll('[data-welcome-step]').length,rows:view.contentEl.querySelectorAll('[data-welcome-help-row]').length,...pressed});})()`,
      ),
    ).toBe(
      JSON.stringify({
        before: { active: false, pressed: "false" },
        dismissed: false,
        steps: 3,
        rows: 0,
        active: true,
        pressed: "true",
      }),
    );
    expect(
      await obEval(
        run.vaultId,
        `(async()=>{${PAGE}press(${helpAction},${JSON.stringify(run.m.library_view_help_action())});await until('banner gone',()=>!${banner});await ${services}.settings.flush();const saved=JSON.parse(await app.vault.adapter.read(${dataPath}))['welcome.dismissed'];${readHelpAction}return JSON.stringify({dismissed:${services}.settings.current['welcome.dismissed'],saved,...pressed});})()`,
      ),
    ).toBe(
      JSON.stringify({
        dismissed: true,
        saved: true,
        active: false,
        pressed: "false",
      }),
    );

    // ZotLit reads a folder without Zotero's database: the tree and the
    // list say so and offer to locate it, in place of the papers. A narrow
    // pane keeps the tree out of view, and the list says it alone.
    const readPapers = `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0].view;await view.query.settled;const el=view.contentEl;return JSON.stringify({missing:el.querySelector('[data-zotero-missing]')!==null,rows:[...el.querySelectorAll('tr[data-query-table-row="item"], [data-query-papers-row]')].map(n=>n.getAttribute('data-query-key')??n.getAttribute('data-query-papers-row'))});})()`;
    const listed = JSON.parse(await obEval(run.vaultId, readPapers)) as {
      rows: string[];
    };
    expect(listed.rows.length).toBeGreaterThan(0);
    const emptyDir = join(e2eFixture.root, "library-not-found");
    await mkdir(emptyDir, { recursive: true });
    cleanup.defer(() => rm(emptyDir, { recursive: true, force: true }));
    await obEval(
      run.vaultId,
      `${services}.zoteroPref.setDataDir(${JSON.stringify(emptyDir)});true`,
    );
    const readNotFound = `(()=>{const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;const shown=(n)=>!!n&&n.checkVisibility();const part=(name)=>el.querySelector('[data-library-not-found="'+name+'"]');const pane=el.querySelector('[data-library-tree]');return JSON.stringify({tree:shown(part('tree'))||getComputedStyle(pane).display==='none'?part('tree').textContent:null,list:shown(part('list'))?[...part('list').querySelectorAll('button')].map(b=>b.textContent):null,papers:[...el.querySelectorAll('[data-query-table], [data-query-layout]')].some(shown),search:shown(el.querySelector('[data-library-search]')),nodes:[...el.querySelectorAll('[data-library-node]')].some(shown),facets:[...el.querySelectorAll('[data-library-facet]')].some(shown)});})()`;
    expect(
      await obEvalUntil(run.vaultId, readNotFound, {
        expected: JSON.stringify({
          tree: run.m.library_view_not_found(),
          list: [
            run.m.library_view_locate(),
            run.m.welcome_action_open_settings(),
          ],
          papers: false,
          search: false,
          nodes: false,
          facets: false,
        }),
        tries: 120,
      }),
    ).toBe(true);

    // "Locate data folder" saves the folder the system dialog returns; the
    // case sets the same folder, since no reader can press a native dialog.
    await obEval(
      run.vaultId,
      `${services}.zoteroPref.setDataDir(${JSON.stringify(JSON.parse(snapshot).dataDir)});true`,
    );
    // The papers the Library View listed before come back.
    expect(
      await obEvalUntil(run.vaultId, readPapers, {
        expected: JSON.stringify({ missing: false, rows: listed.rows }),
        tries: 120,
      }),
    ).toBe(true);
  });

  it("leaves the search box unfocused on a fresh install's first screen, under the Welcome View banner", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const dataPath = "app.vault.configDir+'/plugins/zotlit/data.json'";
    const folder = `${services}.settings.current['note.default-profile'].bindings['note.literature-folder']`;
    const aside = "zotlit-e2e-literature-aside";
    /** Start ZotLit as a fresh install, with no plugin data. */
    const freshInstall = (before: string) =>
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());await ${services}.settings.flush();const folder=${folder};await app.plugins.disablePlugin('zotlit');await app.vault.adapter.remove(${dataPath});${before}await app.plugins.enablePlugin('zotlit');await ${services}.release.checked;return true;})()`;
    const snapshot = await obEval(
      run.vaultId,
      `(async()=>JSON.stringify({layout:app.workspace.getLayout(),data:await app.vault.adapter.read(${dataPath})}))()`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});await ${services}.settings.flush();const folder=${folder};await app.plugins.disablePlugin('zotlit');if(await app.vault.adapter.exists(${JSON.stringify(aside)}))await app.vault.adapter.rename(${JSON.stringify(aside)},folder);await app.vault.adapter.write(${dataPath},saved.data);await app.plugins.enablePlugin('zotlit');await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    // A fresh install whose literature-notes folder is missing: setup is
    // incomplete, and the release check opens the Library View with the
    // Welcome View banner above it.
    await obEval(run.vaultId, freshInstall(""));
    await obEval(
      run.vaultId,
      freshInstall(
        `if(folder&&await app.vault.adapter.exists(folder))await app.vault.adapter.rename(folder,${JSON.stringify(aside)});`,
      ),
    );
    // Once the banner settles, the cursor is not in the box right under it.
    expect(
      JSON.parse(
        await obEval(
          run.vaultId,
          `(async()=>{${PAGE}const view=await until('the Library View',()=>app.workspace.getLeavesOfType('zotlit-library')[0]?.view.search&&app.workspace.getLeavesOfType('zotlit-library')[0].view,10000);await until('banner',()=>view.contentEl.querySelector('[data-welcome-banner]'),10000);await view.welcome.settled;await view.arrived;await view.searched;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const input=view.contentEl.querySelector('[data-library-search] input');return JSON.stringify({banner:view.welcome.shown,focused:input.ownerDocument.activeElement===input});})()`,
        ),
      ),
    ).toEqual({ banner: true, focused: false });
  });

  it("opens the Library View after an update of ZotLit in its own tab beside the open note, with no notice, and announces the update in the banner beside the Help Links until What's new acknowledges it", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const dataPath = "app.vault.configDir+'/plugins/zotlit/data.json'";
    const snapshot = await obEval(
      run.vaultId,
      `(async()=>{await ${services}.settings.flush();return JSON.stringify({layout:app.workspace.getLayout(),data:await app.vault.adapter.read(${dataPath})});})()`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});await ${services}.settings.flush();await app.plugins.disablePlugin('zotlit');await app.vault.adapter.write(${dataPath},saved.data);await app.plugins.enablePlugin('zotlit');await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    /** Reload the plugin and wait for its release check to open what it opens. */
    const reloadAndCheck = (before = "") =>
      obEval(
        run.vaultId,
        `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());await ${services}.settings.flush();await app.plugins.disablePlugin('zotlit');${before}await app.plugins.enablePlugin('zotlit');await ${services}.release.checked;return true;})()`,
      );

    // The plugin data of a set-up vault that last ran an older release and
    // put the banner away after setup.
    const seeded = {
      ...(JSON.parse(JSON.parse(snapshot).data) as Record<string, unknown>),
      "release.previous-version": "2.1.0",
      "release.notices-enabled": true,
      "welcome.dismissed": true,
    };
    // The researcher has a note open in the active leaf.
    const note = JSON.parse(
      await obEval(
        run.vaultId,
        `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const file=app.vault.getMarkdownFiles()[0];const leaf=app.workspace.getLeaf(false);await leaf.openFile(file);app.workspace.setActiveLeaf(leaf);return JSON.stringify({id:leaf.id,path:file.path});})()`,
      ),
    ) as { id: string; path: string };
    await clearNotices(run.vaultId);
    await reloadAndCheck(
      `await app.vault.adapter.write(${dataPath},${JSON.stringify(JSON.stringify(seeded))});`,
    );
    // The Library View opens in its own tab: the note's leaf keeps its note.
    expect(
      await obEval(
        run.vaultId,
        `JSON.stringify({note:app.workspace.getLeafById(${JSON.stringify(note.id)})?.view.file?.path,library:app.workspace.getLeavesOfType('zotlit-library').map(leaf=>leaf.id!==${JSON.stringify(note.id)})})`,
      ),
    ).toBe(JSON.stringify({ note: note.path, library: [true] }));

    const banner = `app.workspace.getLeavesOfType('zotlit-library')[0]?.view.contentEl.querySelector('[data-welcome-banner]')`;
    const readBanner = `(()=>{const el=${banner};return JSON.stringify({library:app.workspace.getLeavesOfType('zotlit-library').length,banner:!!el&&{badge:el.querySelector('[data-welcome-badge]')?.textContent,headings:[...el.querySelectorAll('[role=heading][aria-level="3"]')].map(n=>n.textContent),buttons:[...el.querySelectorAll('button')].map(n=>n.textContent).filter(Boolean),help:el.querySelectorAll('[data-welcome-help] a').length},notices:activeDocument.querySelectorAll('.notice').length});})()`;
    const version = await obEval(run.vaultId, `${services}.release.version`);
    expect(
      await obEvalUntil(run.vaultId, readBanner, {
        expected: JSON.stringify({
          library: 1,
          banner: {
            badge: run.m.welcome_badge_updated(),
            // The update alone: setup is done.
            headings: [run.m.welcome_update_title({ version })],
            buttons: [run.m.welcome_update_action()],
            help: 9,
          },
          // The banner says it in place of the update notice.
          notices: 0,
        }),
      }),
    ).toBe(true);
    expect(
      await obEval(
        run.vaultId,
        `String(${services}.settings.current['release.update-pending'])`,
      ),
    ).toBe("true");

    // "What's new" opens the Release Note and acknowledges the update.
    expect(
      await obEval(
        run.vaultId,
        `(async()=>{${PAGE}const opened=[];const open=window.open;window.open=(url)=>{opened.push(url);return null;};const before=new Set(app.workspace.getLeavesOfType('webviewer'));try{press([...${banner}.querySelectorAll('button')].find(n=>n.textContent===${JSON.stringify(run.m.welcome_update_action())}),"What's new");await until('banner gone',()=>!${banner});}finally{window.open=open;}const leaves=app.workspace.getLeavesOfType('webviewer').filter(leaf=>!before.has(leaf));const urls=[...opened,...leaves.map(leaf=>leaf.view.getState().url)];leaves.forEach(leaf=>leaf.detach());return JSON.stringify({urls,pending:${services}.settings.current['release.update-pending']});})()`,
      ),
    ).toBe(
      JSON.stringify({
        urls: [`https://zotlit.aidenlx.site/changelog/${version}`],
        pending: false,
      }),
    );

    // The next launch announces nothing: no Library View opens, and the one
    // the command opens shows no banner.
    await reloadAndCheck();
    expect(
      await obEval(
        run.vaultId,
        `(async()=>{const opened=app.workspace.getLeavesOfType('zotlit-library').length;await app.commands.executeCommandById('zotlit:open-library-view');${PAGE}await until('library view',()=>app.workspace.getLeavesOfType('zotlit-library')[0]?.view.contentEl);await new Promise(r=>setTimeout(r,500));return JSON.stringify({opened,banner:!!${banner}});})()`,
      ),
    ).toBe(JSON.stringify({ opened: 0, banner: false }));

    // An update beside the template conversion: the badge still says
    // Updated, the done steps fold into one line, and the conversion's long
    // explanation waits behind How it works. The vault holds converted
    // templates, so the load clears a saved offer; the offer is armed after
    // it, as the template service does.
    await reloadAndCheck(
      `await app.vault.adapter.write(${dataPath},${JSON.stringify(
        JSON.stringify({ ...seeded, "welcome.dismissed": false }),
      )});`,
    );
    await obEval(
      run.vaultId,
      `(${services}.settings.update({'note.template-conversion-pending':true}),true)`,
    );
    expect(
      await obEvalUntil(
        run.vaultId,
        `(()=>{const el=${banner};return JSON.stringify(!!el&&{badge:el.querySelector('[data-welcome-badge]')?.textContent,headings:[...el.querySelectorAll('[role=heading][aria-level="3"]')].map(n=>n.textContent),folded:!!el.querySelector('[data-welcome-setup-done]'),how:[...el.querySelectorAll('details')].map(d=>d.open+':'+d.querySelector('summary').textContent)});})()`,
        {
          expected: JSON.stringify({
            badge: run.m.welcome_badge_updated(),
            headings: [
              run.m.welcome_update_title({ version }),
              run.m.welcome_template_conversion_title(),
            ],
            folded: true,
            how: [`false:${run.m.welcome_how_it_works()}`],
          }),
        },
      ),
    ).toBe(true);

    // The dismiss button puts every combination away, and it stays away
    // after a reload, until a later update.
    await obEval(
      run.vaultId,
      `(async()=>{${PAGE}press(${banner}.querySelector('[data-welcome-dismiss]'),'Dismiss the welcome banner');await until('banner gone',()=>!${banner});return true;})()`,
    );
    await reloadAndCheck();
    expect(
      await obEval(
        run.vaultId,
        `(async()=>{await app.commands.executeCommandById('zotlit:open-library-view');${PAGE}await until('library view',()=>app.workspace.getLeavesOfType('zotlit-library')[0]?.view.contentEl);await new Promise(r=>setTimeout(r,500));return JSON.stringify({banner:!!${banner},dismissed:${services}.settings.current['welcome.dismissed'],update:${services}.settings.current['release.update-pending']});})()`,
      ),
    ).toBe(JSON.stringify({ banner: false, dismissed: true, update: false }));
  });

  it("lays the Welcome View banner out on one start edge, in a column centered beside Help Links pinned to the pane's end, with the first section and the Help Links on one top line, at a wide, a medium and a narrow pane, for an incomplete setup and for an update beside the folded Setup done line", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const keys = [
      "welcome.dismissed",
      "welcome.requested",
      "welcome.steps-shown",
      "release.update-pending",
      "release.notices-enabled",
      "note.template-conversion-pending",
    ];
    const snapshot = await obEval(
      run.vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),size:require('@electron/remote').getCurrentWindow().getSize(),folder:${services}.settings.current['note.default-profile'].bindings['note.literature-folder'],settings:Object.fromEntries(${JSON.stringify(keys)}.map(k=>[k,${services}.settings.current[k]]))})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const settings=${services}.settings;settings.update(saved.settings);settings.updateDefaultLiteratureNoteProfileBindings({'note.literature-folder':saved.folder});await settings.flush();require('@electron/remote').getCurrentWindow().setSize(...saved.size);await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    const { folder } = JSON.parse(snapshot) as { folder: string };
    const created = await obEval(
      run.vaultId,
      `(async()=>{if(app.vault.getFolderByPath(${JSON.stringify(folder)}))return 'false';await app.vault.createFolder(${JSON.stringify(folder)});return 'true';})()`,
    );
    if (created === "true")
      cleanup.defer(async () => {
        await obEval(
          run.vaultId,
          `(async()=>{const f=app.vault.getFolderByPath(${JSON.stringify(folder)});if(f)await app.vault.delete(f,true);return true;})()`,
        );
      });
    await obEval(
      run.vaultId,
      `(async()=>{${PAGE}app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse();app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());await app.commands.executeCommandById('zotlit:open-library-view');const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );

    /** The rects that carry the banner's edges, in CSS pixels. */
    interface Box {
      l: number;
      r: number;
      t: number;
      b: number;
    }
    interface Layout {
      banner: Box;
      contentStart: number;
      contentEnd: number;
      gap: number;
      lockup: Box;
      marks: Box[];
      notices: Box[];
      surfaces: Box[];
      header: Box;
      column: Box;
      first: Box;
      help: Box;
      tiles: Box[];
      dismiss: Box;
      glyph: Box;
    }
    /** The sections each case's banner renders, which the measure waits for. */
    interface Sections {
      open: number;
      done: number;
      callouts: number;
    }
    /**
     * Measure the banner once the window is `width` wide, the banner's
     * connection readout has landed and it renders `sections`.
     */
    const measure = (width: number, sections: Sections) =>
      `(async()=>{${PAGE}const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;await until('the window at ${width}px',()=>activeWindow.outerWidth===${width},5000);await view.welcome.decided;await view.welcome.settled;const el=view.contentEl;const b=await until('the banner sections',()=>{const b=el.querySelector('[data-welcome-banner]');return b&&b.querySelectorAll('[data-welcome-step][data-open]').length===${sections.open}&&b.querySelectorAll('[data-welcome-setup-done]').length===${sections.done}&&b.querySelectorAll('[data-welcome-callout]').length===${sections.callouts}&&b;},5000);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const R=n=>{const r=n.getBoundingClientRect();return{l:r.left,r:r.right,t:r.top,b:r.bottom};};const all=(...s)=>{for(const q of s){const n=[...b.querySelectorAll(q)];if(n.length)return n;}return [];};const cs=getComputedStyle(b);const help=b.querySelector('[data-welcome-help]');const column=b.querySelector('[data-welcome-column]')??help.parentElement.firstElementChild;const grid=help.parentElement;const notices=[...b.querySelectorAll('[role=heading][aria-level="3"]')].filter(n=>!n.closest('[data-welcome-step]'));const banner=R(b);return JSON.stringify({banner,contentStart:banner.l+parseFloat(cs.paddingLeft),contentEnd:banner.r-parseFloat(cs.paddingRight),gap:parseFloat(getComputedStyle(grid).columnGap)||0,lockup:R(b.querySelector('[data-welcome-lockup]')??b.querySelector('[role=heading][aria-level="2"]')),marks:all('[data-welcome-mark]','[data-welcome-step] > div > span:first-child, [data-welcome-setup-done] > span:first-child').map(R),notices:notices.map(R),surfaces:[...b.querySelectorAll('[data-welcome-step][data-open]'),...notices.map(n=>n.closest('[data-welcome-callout]')??n.parentElement.parentElement)].map(R),header:R(b.querySelector('header')),column:R(column),first:R(column.firstElementChild),help:R(help),tiles:all('[data-welcome-help-tile]','[data-welcome-help] > div > a').map(R),dismiss:R(b.querySelector('[data-welcome-dismiss]')),glyph:R(b.querySelector('[data-welcome-dismiss] svg'))});})()`;
    const shots = join(workspaceRoot, ".scratch/e2e-screenshots");
    await mkdir(shots, { recursive: true });
    const cases = {
      // Setup is incomplete: the literature-notes folder is missing, so its
      // step opens on the accent surface.
      setup: {
        settings: `{'welcome.dismissed':false,'welcome.requested':true,'welcome.steps-shown':false,'release.update-pending':false,'note.template-conversion-pending':false}`,
        sections: { open: 1, done: 0, callouts: 0 },
      },
      // An update beside the template conversion, with the done steps
      // folded into Setup done.
      update: {
        settings: `{'welcome.dismissed':false,'welcome.requested':false,'welcome.steps-shown':false,'release.update-pending':true,'release.notices-enabled':true,'note.template-conversion-pending':true}`,
        sections: { open: 0, done: 1, callouts: 2 },
      },
    };
    const widths = { wide: 1750, medium: 1050, narrow: 740 };
    const results: Record<string, Layout> = {};
    for (const [name, { settings, sections }] of Object.entries(cases)) {
      await obEval(
        run.vaultId,
        `(async()=>{const settings=${services}.settings;settings.updateDefaultLiteratureNoteProfileBindings({'note.literature-folder':${JSON.stringify(name === "setup" ? "Banner alignment, not yet created" : folder)}});settings.update(${settings});await settings.flush();return true;})()`,
      );
      for (const [size, width] of Object.entries(widths)) {
        await obEval(
          run.vaultId,
          `require('@electron/remote').getCurrentWindow().setSize(${width},900);true`,
        );
        const label = `${name}-${size}`;
        results[label] = JSON.parse(
          await obEval(run.vaultId, measure(width, sections)),
        ) as Layout;
        await cli([
          `vault=${run.vaultId}`,
          "dev:screenshot",
          `path=${join(shots, `banner-${label}.png`)}`,
        ]);
      }
    }
    console.log(`banner layout: ${JSON.stringify(results)}`);

    const near = (a: number, b: number) => Math.abs(a - b) <= 1;
    const overlaps = (a: Box, b: Box) =>
      a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    for (const [label, at] of Object.entries(results)) {
      const stacked = at.help.t >= at.column.b;
      const edges = [at.lockup, ...at.marks, ...at.notices].map((n) => n.l);
      const check = {
        label,
        // The banner keeps one inline margin at both of the pane's edges.
        margins: near(
          at.contentStart - at.banner.l,
          at.banner.r - at.contentEnd,
        ),
        // The lockup, the step marks and the notices' text share one start
        // edge, the centered column's.
        edge: edges.every((x) => near(x, at.column.l)),
        // Each tinted surface hangs outside that edge, inside the banner and
        // clear of the Help Links.
        hang: at.surfaces.every(
          (s) =>
            s.l < at.column.l &&
            s.l >= at.banner.l &&
            (stacked ? s.r <= at.banner.r : s.r <= at.help.l),
        ),
        // The Help Links end at the banner's content end.
        helpEnd: near(at.help.r, at.contentEnd),
        // Beside each other, the column is centered in the space before the
        // Help Links, and the first section starts on their top line;
        // stacked, the column takes the full width.
        column: stacked
          ? near(at.column.l, at.contentStart) &&
            near(at.column.r, at.contentEnd)
          : near(
              at.column.l - at.contentStart,
              at.help.l - at.gap - at.column.r,
            ),
        top: stacked || near(at.first.t, at.help.t),
        // The dismiss button sits on the title's line, its glyph ending on
        // the banner's content end, clear of every tile.
        dismiss:
          near(
            (at.glyph.t + at.glyph.b) / 2,
            (at.lockup.t + at.lockup.b) / 2,
          ) &&
          near(at.glyph.r, at.contentEnd) &&
          at.tiles.every((tile) => !overlaps(at.dismiss, tile)),
      };
      expect(check).toEqual({
        label,
        margins: true,
        edge: true,
        hang: true,
        helpEnd: true,
        column: true,
        top: true,
        dismiss: true,
      });
    }
    // The narrow pane stacks the column, and the wide ones do not.
    expect(
      Object.entries(results).map(([label, at]) => [
        label,
        at.help.t >= at.column.b,
      ]),
    ).toEqual(
      Object.keys(results).map((label) => [label, label.endsWith("narrow")]),
    );
  });
});
