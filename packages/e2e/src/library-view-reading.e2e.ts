import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ATTACHMENTS } from "@zotlit/scripts/fixture";

import { reachable } from "./e2e-run-fixture.ts";
import {
  MY_LIBRARY_DOCUMENT,
  annotationAttachment,
  annotationItem,
  attachmentAnnotations,
  e2eFixture,
} from "./e2e-run-fixture.ts";
import { activeTab, pdfOpened } from "./e2e-run-helpers.ts";
import type { ActiveTab } from "./e2e-run-helpers.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import * as suite from "./e2e-run-suite-helpers.ts";
import { obEval, obEvalUntil, readUntil, waitFor } from "./obsidian-cli.ts";
import { PAGE } from "./page-gestures.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("shows the selected row's Reading Card with its seeded fields, abstract and, once opened, Annotation Cards under the Editing Capability, runs the row menu's actions from its buttons, opens its Annotations in the sidebar, shows it over the list on a narrow pane on a click or Space and puts it away on Escape, keeps a double click on the row for the PDF, selects the row the keyboard enters the list at, shows it beside a wide list as the arrow keys move, and hides it with no selection and while Zotero's data folder is missing", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      run.vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.bridge.runSync(${services}.settings.current)['library.document']??null,dataDir:${services}.zoteroPref.dataDirOverride})`,
    );
    const notePath = "Reading Card citations.md";
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});${services}.zoteroPref.setDataDir(saved.dataDir);const {settings,bridge}=${services};bridge.runSync(settings.update({'library.document':saved.document}));await bridge.runPromise(settings.flush);const file=app.vault.getFileByPath(${JSON.stringify(notePath)});if(file)await app.vault.delete(file);await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });

    // The seed's oracle: the paper, its one PDF, and the Annotations on it.
    const paper = annotationItem;
    const abstract = paper.fields?.abstractNote;
    expect(abstract).toBeTruthy();
    const pdfs = ATTACHMENTS.filter(
      ({ parentItemID }) => parentItemID === paper.itemID,
    );
    expect(pdfs.map(({ key }) => key)).toEqual([annotationAttachment.key]);
    const seededCards = attachmentAnnotations
      .map(({ key, color, pageLabel, comment }) => ({
        key,
        color,
        page: run.m.annot_view_page({ page: pageLabel }),
        comment,
      }))
      .toSorted((a, b) => a.key.localeCompare(b.key));
    const authors = paper.creators
      .filter(({ creatorType }) => creatorType === "author")
      .map(({ firstName, lastName }) => `${firstName} ${lastName}`);

    // The Library View on My Library, wide enough for the card, and a note
    // to cite into that was active last.
    await suite.wideWindow(cleanup);
    await obEval(
      run.vaultId,
      `(async()=>{${PAGE}app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const {settings,bridge}=${services};bridge.runSync(settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)}}));await bridge.runPromise(settings.flush);const file=app.vault.getFileByPath(${JSON.stringify(notePath)})??await app.vault.create(${JSON.stringify(notePath)},'CITE ');const note=app.workspace.getLeaf('tab');await note.openFile(file);app.workspace.setActiveLeaf(note,{focus:true});note.view.editor.setCursor({line:0,ch:'CITE '.length});app.commands.executeCommandById('zotlit:open-library-view');await until('library',()=>app.workspace.getLeavesOfType('zotlit-library')[0]);return true;})()`,
    );
    /** Run `script` with the Library View's tab active, `el` its content and `card` its Reading Card pane. */
    const inLibrary = (script: string) =>
      obEval(
        run.vaultId,
        `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});await leaf.view.query.settled;const el=leaf.view.contentEl;const card=el.querySelector('[data-library-card]');const row=key=>el.querySelector('[data-query-item-row="'+key+'"]');${script}})()`,
      );
    /** What the card shows, `null` while it is out of view. */
    const readCard = `const part=name=>card.querySelector('[data-library-card-'+name+']')?.textContent??null;return JSON.stringify(card.checkVisibility()?{title:part('title'),creators:part('creators'),venue:part('venue'),citationKey:part('citekey'),abstract:part('abstract'),actions:[...card.querySelectorAll('[data-library-card-action]')].map(b=>b.textContent||b.getAttribute('aria-label')),cards:[...card.querySelectorAll('.zt-annot-card[data-zotero-annotation-key]')].map(n=>({key:n.getAttribute('data-zotero-annotation-key'),color:n.getAttribute('data-annot-color'),page:n.querySelector('.zt-annot-page-chip')?.textContent??null,text:n.textContent})).toSorted((a,b)=>a.key.localeCompare(b.key))}:null);`;

    // No row is selected: the card is out of view.
    expect(
      await inLibrary(
        `await until('rows',()=>row(${JSON.stringify(paper.key)}),10000);${readCard}`,
      ),
    ).toBe("null");

    // A click on the paper's row shows its card with a preview of its
    // Annotations: the first two quoted, the count of each colour, and "See
    // all", with no Annotation Card drawn.
    expect(
      JSON.parse(
        await inLibrary(
          `press(row(${JSON.stringify(paper.key)}),'paper row');await until('card',()=>card.checkVisibility()&&card.querySelector('[data-library-card-toggle="annotations"]'),10000);await leaf.view.card.settled;const toggle=card.querySelector('[data-library-card-toggle="annotations"]');return JSON.stringify({toggle:toggle.textContent,expanded:toggle.getAttribute('aria-expanded'),cards:card.querySelectorAll('.zt-annot-card').length,quotes:card.querySelectorAll('[data-library-card-quote]').length,colours:[...card.querySelectorAll('[data-library-card-colour]')].reduce((sum,n)=>sum+Number(n.textContent.split(': ').at(-1)),0)});`,
        ),
      ),
    ).toEqual({
      toggle: run.m.library_view_card_see_all({ count: seededCards.length }),
      expanded: "false",
      cards: 0,
      quotes: Math.min(2, seededCards.length),
      colours: seededCards.length,
    });
    // Opened, the card shows the seeded fields and abstract, the row menu's
    // actions, and its Annotations as cards.
    const shown = JSON.parse(
      await inLibrary(
        `press(card.querySelector('[data-library-card-toggle="annotations"]'),'Annotations');await until('cards',()=>card.querySelectorAll('.zt-annot-card').length>=${seededCards.length},10000);await leaf.view.card.settled;${readCard}`,
      ),
    ) as {
      title: string;
      creators: string;
      venue: string;
      citationKey: string;
      abstract: string;
      actions: string[];
      cards: { key: string; color: string; page: string; text: string }[];
    };
    expect({
      title: shown.title,
      creators: shown.creators,
      venue: shown.venue,
      citationKey: shown.citationKey,
      abstract: shown.abstract,
      actions: shown.actions,
    }).toEqual({
      title: paper.title,
      // The authors in full, and the Venue with the year.
      creators: authors.join(", "),
      venue: `${paper.venue} · ${paper.date}`,
      citationKey: paper.citationKey,
      abstract,
      // Two buttons; the rest of the row menu under More, and the sidebar
      // as an icon.
      actions: [
        run.m.library_view_menu_open_pdf(),
        run.m.library_view_menu_open_note(),
        run.m.library_view_card_more(),
        run.m.library_view_card_open_in_annot_view(),
      ],
    });
    expect(
      shown.cards.map(({ key, color, page }) => ({ key, color, page })),
    ).toEqual(
      seededCards.map(({ key, color, page }) => ({ key, color, page })),
    );
    // Each card shows its seeded comment.
    const commented = seededCards.filter(({ comment }) => comment);
    expect(commented.length).toBeGreaterThan(0);
    expect(
      commented.map(({ key, comment }) =>
        shown.cards.find((card) => card.key === key)!.text.includes(comment!),
      ),
    ).toEqual(commented.map(() => true));

    // With Zotero closed the Editing Capability is read-only: each card's
    // colour and tag verbs, and any comment field it shows, say they are
    // blocked, as in the sidebar.
    expect(
      JSON.parse(
        await inLibrary(
          `return JSON.stringify({capability:${services}.bridge.runSync(${services}.annotationRepository.capabilityFor(${JSON.stringify(annotationAttachment.key)})),blocked:[...card.querySelectorAll('.zt-annot-card')].every(n=>n.querySelectorAll('.clickable-icon[data-blocked]').length>=2)&&[...card.querySelectorAll('.zt-annot-comment-field[role=textbox]')].every(f=>f.hasAttribute('data-blocked'))});`,
        ),
      ),
    ).toEqual({
      capability: { kind: "read-only", reason: "zotero-unavailable" },
      blocked: true,
    });

    // The buttons do what the row menu does: Insert citation, from the More
    // menu, into the note active last, Open literature note, Open PDF.
    const active = () => activeTab(run.vaultId);
    const activeWhen = (ready: (shown: ActiveTab) => boolean) =>
      readUntil(active, ready, { what: "Active tab", tries: 60 });
    await inLibrary(
      `press(card.querySelector('[data-library-card-action="more"]'),'More actions');const item=await until('Insert citation',()=>[...activeDocument.querySelectorAll('.menu .menu-item')].find(n=>n.querySelector('.menu-item-title')?.textContent===${JSON.stringify(run.m.library_view_menu_insert_citation())}));press(item,'Insert citation');return true`,
    );
    expect(
      await waitFor(async () =>
        (
          await obEval(
            run.vaultId,
            `app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.file?.path===${JSON.stringify(notePath)}).view.editor.getValue()`,
          )
        ).includes(`@${paper.citationKey}`),
      ),
    ).toBe(true);
    await inLibrary(
      `press(card.querySelector('[data-library-card-action="note"]'),'Open literature note');return true`,
    );
    // Open PDF opens in the tab the note opened in, once that open is done.
    expect(
      await activeWhen(
        (state) =>
          state.type === "markdown" &&
          state.key === paper.key &&
          !state.opening,
      ),
    ).toMatchObject({ key: paper.key });
    await inLibrary(
      `press(card.querySelector('[data-library-card-action="pdf"]'),'Open PDF');return true`,
    );
    expect(await pdfOpened(run.vaultId, annotationAttachment.path!)).toBe(true);

    // "Open in the annotation view" pins the paper in the sidebar Annotation View, which
    // lists its cards.
    await inLibrary(
      `press(card.querySelector('[data-library-card-action="sidebar"]'),'Open in the annotation view');return true`,
    );
    expect(
      await obEvalUntil(
        run.vaultId,
        `(async()=>{const view=app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view;if(!view)return 'none';await view.read;return JSON.stringify({pinned:view.getState().pinnedItemKey,cards:[...view.contentEl.querySelectorAll('.zt-annot-card[data-zotero-annotation-key]')].map(n=>n.getAttribute('data-zotero-annotation-key')).toSorted()});})()`,
        {
          expected: JSON.stringify({
            pinned: paper.key,
            cards: seededCards.map(({ key }) => key),
          }),
          tries: 120,
        },
      ),
    ).toBe(true);

    // A narrow pane shows the card over the list, and a wide one beside it;
    // the row stays selected.
    const narrow = (share: number, over: boolean) =>
      inLibrary(
        `app.workspace.rightSplit.collapse();const beside=window.zotlitE2EBeside??=app.workspace.createLeafBySplit(leaf,'vertical');leaf.parent.setDimension(${share});beside.parent.setDimension(${100 - share});await until('card ${over ? "over" : "beside"} the list at '+el.clientWidth+'px',()=>card.checkVisibility()&&(getComputedStyle(card).position==='absolute')===${over},5000);return JSON.stringify({card:card.checkVisibility(),over:getComputedStyle(card).position==='absolute',selected:el.querySelector('[data-query-item-row][data-selected]')?.getAttribute('data-query-item-row')??null});`,
      );
    cleanup.defer(async () => {
      await obEval(run.vaultId, "delete window.zotlitE2EBeside;true");
    });
    expect(JSON.parse(await narrow(30, true))).toEqual({
      card: true,
      over: true,
      selected: paper.key,
    });
    // Its close button puts it away; the row stays selected and takes the
    // focus back.
    expect(
      JSON.parse(
        await inLibrary(
          `press(card.querySelector('[data-library-card-close]'),'Close');await until('card hides',()=>!card.checkVisibility());return JSON.stringify({selected:el.querySelector('[data-query-item-row][data-selected]')?.getAttribute('data-query-item-row')??null,focused:activeDocument.activeElement?.getAttribute('data-query-item-row')??null});`,
        ),
      ),
    ).toEqual({ selected: paper.key, focused: paper.key });
    // The arrow keys move the selection and leave the list uncovered; Space
    // on the selected row opens its card over the list, and Escape on the
    // row puts it away.
    /** Press `key` where the focus is; report once the card shows or hides. */
    const keyThen = (key: string, shows: boolean) =>
      inLibrary(
        `activeDocument.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true}));await until('card ${shows ? "shows" : "hides"}',()=>card.checkVisibility()===${shows});return JSON.stringify({card:card.checkVisibility(),selected:el.querySelector('[data-query-item-row][data-selected]')?.getAttribute('data-query-item-row')??null,focused:activeDocument.activeElement?.getAttribute('data-query-item-row')??null});`,
      );
    /** The row after `key` on screen. */
    const rowAfter = async (key: string) =>
      JSON.parse(
        await inLibrary(
          `const keys=[...el.querySelectorAll('[data-query-item-row]')].map(n=>n.getAttribute('data-query-item-row'));return JSON.stringify(keys[keys.indexOf(${JSON.stringify(key)})+1]??null);`,
        ),
      ) as string;
    // Over the list, a click waits out a double click before it opens the
    // card.
    await inLibrary(
      `press(row(${JSON.stringify(paper.key)}),'paper row');await until('card',()=>card.checkVisibility());return true`,
    );
    const next = await rowAfter(paper.key);
    expect(next).not.toBeNull();
    expect(JSON.parse(await keyThen("ArrowDown", false))).toEqual({
      card: false,
      selected: next,
      focused: next,
    });
    expect(JSON.parse(await keyThen(" ", true))).toEqual({
      card: true,
      selected: next,
      focused: next,
    });
    expect(JSON.parse(await keyThen("Escape", false))).toEqual({
      card: false,
      selected: next,
      focused: next,
    });
    // A double click on the paper's row, by the pointer, where the card
    // goes over the list, opens its PDF: the first click leaves the row
    // uncovered for the second.
    expect(
      await inLibrary(
        `const target=row(${JSON.stringify(paper.key)});target.scrollIntoView({block:'center',behavior:'instant'});const box=target.getBoundingClientRect();const x=Math.round(box.right-60),y=Math.round(box.top+box.height/2);const hit=activeDocument.elementFromPoint(x,y);if(!target.contains(hit)||hit.closest('a, button'))throw new Error('No plain part of the row at '+x+','+y+': '+hit?.outerHTML.slice(0,80));const zoom=require('electron').webFrame.getZoomFactor();const contents=require('@electron/remote').getCurrentWebContents();const at={x:Math.round(x*zoom),y:Math.round(y*zoom),button:'left'};for(const clickCount of [1,2]){contents.sendInputEvent({type:'mouseDown',...at,clickCount});contents.sendInputEvent({type:'mouseUp',...at,clickCount});}return 'double-clicked';`,
      ),
    ).toBe("double-clicked");
    expect(await pdfOpened(run.vaultId, annotationAttachment.path!)).toBe(true);
    // The keyboard that enters the list at its first row selects it, with
    // no card, so Space opens its card. Selecting the node again lets go of
    // the selection.
    const entered = JSON.parse(
      await inLibrary(
        `press(el.querySelector('[data-library-tree-toggle]'),'tree toggle');press(await until('selected node',()=>el.querySelector('[data-library-node][aria-selected=true]')),'selected node');await leaf.view.searched;await leaf.view.query.settled;await until('no selection',()=>!el.querySelector('[data-query-item-row][data-selected]'));const first=el.querySelector('[data-query-item-row][tabindex="0"]');first.focus();await until('first row selected',()=>first.hasAttribute('data-selected'));return JSON.stringify({card:card.checkVisibility(),selected:el.querySelector('[data-query-item-row][data-selected]').getAttribute('data-query-item-row'),focused:activeDocument.activeElement?.getAttribute('data-query-item-row')??null,first:el.querySelector('[data-query-item-row]').getAttribute('data-query-item-row')});`,
      ),
    ) as {
      card: boolean;
      selected: string;
      focused: string | null;
      first: string;
    };
    expect(entered).toEqual({
      card: false,
      selected: entered.first,
      focused: entered.first,
      first: entered.first,
    });
    expect(JSON.parse(await keyThen(" ", true))).toEqual({
      card: true,
      selected: entered.first,
      focused: entered.first,
    });
    expect(JSON.parse(await keyThen("Escape", false))).toMatchObject({
      card: false,
    });
    // Back to the card of the row after the paper.
    await inLibrary(
      `press(row(${JSON.stringify(next)}),'row after the paper');await until('card',()=>card.checkVisibility());return true`,
    );
    // ↑ goes back to the paper and puts its card away; a wide pane shows
    // the card of the selected row beside the list.
    expect(JSON.parse(await keyThen("ArrowUp", false))).toEqual({
      card: false,
      selected: paper.key,
      focused: paper.key,
    });
    expect(JSON.parse(await narrow(90, false))).toEqual({
      card: true,
      over: false,
      selected: paper.key,
    });
    // Beside a wide list the card follows the arrow keys.
    expect(JSON.parse(await keyThen("ArrowDown", true))).toEqual({
      card: true,
      selected: next,
      focused: next,
    });

    // While Zotero's data folder is missing the card goes with the list.
    const emptyDir = join(e2eFixture.root, "reading-card-not-found");
    await mkdir(emptyDir, { recursive: true });
    cleanup.defer(() => rm(emptyDir, { recursive: true, force: true }));
    await obEval(
      run.vaultId,
      `${services}.zoteroPref.setDataDir(${JSON.stringify(emptyDir)});true`,
    );
    expect(
      await obEvalUntil(
        run.vaultId,
        `(()=>{const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;return JSON.stringify({missing:el.querySelector('[data-zotero-missing]')!==null,card:el.querySelector('[data-library-card]').checkVisibility()});})()`,
        {
          expected: JSON.stringify({ missing: true, card: false }),
          tries: 120,
        },
      ),
    ).toBe(true);
    await obEval(
      run.vaultId,
      `${services}.zoteroPref.setDataDir(${JSON.stringify(JSON.parse(snapshot).dataDir)});true`,
    );

    // Picking another node in the tree leaves no row selected, and the card
    // goes.
    expect(
      await inLibrary(
        `await until('found',()=>el.querySelector('[data-zotero-missing]')===null,20000);const recent=await until('recent',()=>el.querySelector('[data-library-node=\\'["recent"]\\']'));if(!recent.checkVisibility())press(el.querySelector('[data-library-tree-toggle]'),'tree toggle');press(recent,'Recent');await leaf.view.searched;await leaf.view.query.settled;${readCard}`,
      ),
    ).toBe("null");
  }, 180000);
});
