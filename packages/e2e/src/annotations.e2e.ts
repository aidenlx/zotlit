import { describe, expect, it } from "vitest";

import { reachable } from "./e2e-run-fixture.ts";
import {
  annotationAttachment,
  annotationItem,
  annotationKeys,
  annotationKeysByPage,
  attachmentAnnotations,
  attachmentTags,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { obEval, obEvalUntil, waitFor } from "./obsidian-cli.ts";
import { PAGE } from "./page-gestures.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("shows the same Fixture Annotations in both surfaces with Zotero closed", async () => {
    const layout = await obEval(
      run.vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    try {
      await obEval(
        run.vaultId,
        `(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(annotationAttachment.path)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});app.commands.executeCommandById('zotlit:open-annot-view');app.commands.executeCommandById('zotlit:annot-view-follow-active-tab');return true;})()`,
      );
      const expected = [...annotationKeys].sort();
      const readAnnotations = `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;const list=await repository.read(${JSON.stringify(annotationAttachment.key)});return JSON.stringify({source:list?.source.kind??null,keys:(list?.annotations??[]).map(({key})=>key).sort()});})()`;
      expect(
        await obEvalUntil(run.vaultId, readAnnotations, {
          expected: JSON.stringify({ source: "zotero-db", keys: expected }),
        }),
      ).toBe(true);
      expect(JSON.parse(await obEval(run.vaultId, readAnnotations))).toEqual({
        source: "zotero-db",
        keys: expected,
      });
      const visibleCards = `JSON.stringify((()=>{const annotationView=app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view;const cards=Array.from(annotationView?.containerEl.querySelectorAll('.zt-annot-card[data-zotero-annotation-key]')??[],el=>el.getAttribute('data-zotero-annotation-key')).filter(Boolean);return [...new Set(cards)].sort();})())`;
      const cardsReady = await obEvalUntil(run.vaultId, visibleCards, {
        expected: JSON.stringify(expected),
      });
      if (!cardsReady) {
        const state = await obEval(
          run.vaultId,
          `JSON.stringify((()=>{const services=app.plugins.plugins.zotlit.services;const leaves=app.workspace.getLeavesOfType('zotero-annotation-view');const active=app.workspace.getActiveFile();const full=active?app.vault.adapter.getFullPath(active.path):null;const session=active?services.pdfAnnotationEditor.bindings.find((b)=>b.filePath===active.path)?.session:null;return {count:leaves.length,snapshot:leaves[0]?.view.snapshot??null,active:active?.path??null,session:session?{filePath:session.filePath,target:session.target}:null,resolution:full?services.attachmentResolver.resolve(full):null,fullPath:full,exists:full?require('fs').existsSync(full):false,profileDir:services.zoteroPref.resolvedProfileDir,dataDir:services.zoteroPref.dataDir};})())`,
        );
        throw new Error(`Annotation cards did not render: ${state}`);
      }
      expect(JSON.parse(await obEval(run.vaultId, visibleCards))).toEqual(
        expected,
      );
      // Wait for the card's growing excerpt to settle before starting a transition.
      // A height unchanged for 300 ms counts as settled.
      // Seek each transition to its midpoint so a late timer cannot sample its end.
      // Under reduced motion neither property has an intermediate value.
      const selectionEase = `(async()=>{${PAGE}
        const card=app.workspace.getLeavesOfType('zotero-annotation-view')[0].view.containerEl.querySelector('.zt-annot-card:not([data-selected])');
        const read=()=>{const s=getComputedStyle(card);return{fill:s.backgroundColor,ring:s.boxShadow};};
        let height=-1,since=0;
        await until('excerpt height settles',()=>{if(card.offsetHeight!==height){height=card.offsetHeight;since=Date.now();}return Date.now()-since>=300;},10000);
        const probe=(on)=>{
          const start=read();
          card.toggleAttribute('data-selected',on);
          read();
          const transitions=card.getAnimations().filter(animation=>['background-color','box-shadow'].includes(animation.transitionProperty));
          for(const animation of transitions){animation.pause();animation.currentTime=animation.effect.getComputedTiming().activeDuration/2;}
          const mid=read();
          for(const animation of transitions)animation.finish();
          const end=read();
          const eases=(name)=>mid[name]!==start[name]&&mid[name]!==end[name];
          return{fill:eases('fill'),ring:eases('ring')};
        };
        const motion=!matchMedia('(prefers-reduced-motion: reduce)').matches;
        const select=probe(true);const deselect=probe(false);
        return JSON.stringify({motion,select,deselect});
      })()`;
      const { motion, ...eased } = JSON.parse(
        await obEval(run.vaultId, selectionEase),
      ) as { motion: boolean };
      expect(eased).toEqual({
        select: { fill: motion, ring: motion },
        deselect: { fill: motion, ring: motion },
      });
      // The header block is one press target however much it reports (the
      // view's own More options beside it is not part of it), and the pane
      // names its controls with `aria-label` alone. Both are shapes only a
      // rendered view has: the focus stops are what the DOM ended up with, and
      // a `title` anywhere in the view is the hover tooltip Obsidian would draw
      // over its own.
      const headerChrome = `JSON.stringify((()=>{const root=app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view.containerEl;const block=root?.querySelector('.zt-annot-header')?.parentElement??null;return {focusable:block?[...block.querySelectorAll('button, [tabindex]:not([tabindex="-1"]), a[href], input')].filter(el=>!el.closest('[data-annot-view-more-options]')).length:-1,titled:root?root.querySelectorAll('[title]').length:-1};})())`;
      expect(await obEval(run.vaultId, headerChrome)).toBe(
        JSON.stringify({ focusable: 1, titled: 0 }),
      );
      // The tag Chooser hangs in the browser's top layer, placed by CSS anchor
      // positioning — which only a running Obsidian has. A popup that collapsed
      // still holds its rows in the DOM, so what tells is whether its own box
      // is still around them.
      //
      // The tag Chooser is named by its trigger's label, never by DOM order:
      // the filter bar draws the colour Chooser first whenever the palette has
      // a colour, and every Fixture Annotation under this attachment carries
      // one. The popup is then the popover target of that trigger. A closed
      // popup holds no rows or search field, so neither can name it.
      const tagPopup = `(()=>{const root=app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view.containerEl;const trigger=Array.from(root?.querySelectorAll('button[popovertarget]')??[]).find(b=>{const label=b.getAttribute('aria-label')??'';return label===${JSON.stringify(run.m.annot_view_filter_tag_trigger())}||label.startsWith(${JSON.stringify(run.m.annot_view_filter_tag_trigger_active({ tags: "" }))});});return trigger?root.ownerDocument.getElementById(trigger.getAttribute('popovertarget')):null;})()`;
      await obEval(
        run.vaultId,
        `(function(){${PAGE}const root=app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view.containerEl;const popup=${tagPopup};if(!popup)throw new Error('No tag Chooser in the Annotation View');if(!popup.matches(':popover-open'))press(root.querySelector('[popovertarget="'+popup.id+'"]'),'tag Chooser');return true;})()`,
      );
      // `menuChrome` is the computed-style half of the proof. The popup wears no
      // `.menu` class, so its chrome can only come from Obsidian's `--menu-*`
      // variables. A throwaway sibling declares the same seven variables and is
      // measured beside it: equal computed values mean the popup reads them, in
      // whatever units the engine resolved, under whatever theme is loaded. The
      // sibling is also checked against the initial values, because an
      // undefined variable would leave both boxes bare and make equality say
      // nothing.
      //
      // The padding is the one read taken from the list box. The popup keeps
      // none of its own, so the search field runs edge to edge, and the list
      // carries `--menu-padding` as the inset.
      //
      // The shadow is the one read compared by suffix. Tailwind's `shadow-()`
      // utility composes its ring and inset placeholders ahead of the value, so
      // the popup carries four transparent stops in front of the three
      // `--menu-shadow` supplies.
      //
      // #1191 asks for one assertion, and this scenario carries three. The
      // chrome read is kept here rather than left to the development loop
      // because it is the one place ADR 0044's variable contract is held: the
      // popup wears no `.menu` class, so nothing else would notice a theme
      // hook that stopped reading those variables. The closed state below is
      // kept for the same reason — only a running Obsidian has the user-agent
      // rule it depends on. `rows` names the vocabulary, which is what proves
      // the popup under measurement is the tag one.
      const tagChooserBox = `JSON.stringify((()=>{const popup=${tagPopup};if(!popup)return{open:false,rows:[],rowsInsidePopup:false,menuChrome:false};const box=popup.getBoundingClientRect();const rows=Array.from(popup.querySelectorAll('[role="option"]'));const probe=popup.parentElement.appendChild(document.createElement('div'));probe.style.cssText='position:absolute;left:-9999px;visibility:hidden;background-color:var(--menu-background);border:var(--menu-border-width) solid var(--menu-border-color);border-radius:var(--menu-radius);corner-shape:var(--menu-corner-shape);padding:var(--menu-padding);box-shadow:var(--menu-shadow)';const got=getComputedStyle(popup),want=getComputedStyle(probe);const list=popup.querySelector('[role="listbox"]');const reads=['backgroundColor','borderTopWidth','borderTopColor','borderTopLeftRadius','cornerShape'];const chrome=reads.every(name=>got[name]===want[name])&&list!==null&&getComputedStyle(list).paddingTop===want.paddingTop&&got.boxShadow.endsWith(want.boxShadow)&&want.backgroundColor!=='rgba(0, 0, 0, 0)'&&parseFloat(want.borderTopWidth)>0&&parseFloat(want.borderTopLeftRadius)>0&&parseFloat(want.paddingTop)>0&&want.cornerShape!==''&&want.boxShadow!=='none';probe.remove();return{open:popup.matches(':popover-open'),rows:rows.map(row=>row.textContent).sort(),rowsInsidePopup:rows.length>0&&rows.every(row=>{const r=row.getBoundingClientRect();return r.height>0&&r.top>=box.top&&r.bottom<=box.bottom&&r.left>=box.left&&r.right<=box.right;}),menuChrome:chrome};})())`;
      const tagChooserClosed = `JSON.stringify((()=>{const popup=${tagPopup};if(!popup)return{open:false,hidden:false};return{open:popup.matches(':popover-open'),hidden:!popup.checkVisibility()&&popup.getBoundingClientRect().height===0};})())`;
      expect(
        await obEvalUntil(run.vaultId, tagChooserBox, {
          expected: JSON.stringify({
            open: true,
            rows: attachmentTags,
            rowsInsidePopup: true,
            menuChrome: true,
          }),
        }),
      ).toBe(true);
      await obEval(
        run.vaultId,
        `(function(){const popup=${tagPopup};popup?.hidePopover();return true;})()`,
      );
      // A closed popover is hidden by the user-agent rule
      // `[popover]:not(:popover-open) { display: none }`, which any
      // unconditional author-origin `display` outranks. The popup then keeps
      // painting after it closes and the view behind draws over it, which
      // reads as a popup that will not close and has lost its background.
      // Only a running Obsidian has that user-agent rule, so this is the one
      // place the closed state can be proven.
      expect(
        await obEvalUntil(run.vaultId, tagChooserClosed, {
          expected: JSON.stringify({ open: false, hidden: true }),
        }),
      ).toBe(true);
      for (const [pageIndex, annotations] of annotationKeysByPage) {
        const pageKeys = annotations.map(({ key }) => key).sort();
        expect(
          await obEvalUntil(
            run.vaultId,
            `(function(){const pdfView=app.workspace.getLeavesOfType('pdf').find(({view})=>view.file?.path===${JSON.stringify(annotationAttachment.path)})?.view;const page=pdfView?.containerEl.querySelector('.page[data-page-number="${pageIndex + 1}"]');page?.scrollIntoView({block:'center'});const marks=Array.from(pdfView?.containerEl.querySelectorAll('.zt-pdf-annotation-mark[data-zotero-annotation-key]')??[],el=>el.getAttribute('data-zotero-annotation-key')).filter(key=>${JSON.stringify(pageKeys)}.includes(key));return JSON.stringify([...new Set(marks)].sort());})()`,
            { expected: JSON.stringify(pageKeys) },
          ),
        ).toBe(true);
      }
      expect(
        await obEval(
          run.vaultId,
          `(function(){const repository=app.plugins.plugins.zotlit.services.annotationRepository;const text=app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view.contentEl.textContent??'';const labels=['Zotero DB','Local API','database source'];return JSON.stringify({capability:repository.capabilityFor(${JSON.stringify(annotationAttachment.key)}),sourceLabels:labels.some(label=>text.toLowerCase().includes(label.toLowerCase()))});})()`,
        ),
      ).toBe(
        JSON.stringify({
          capability: {
            kind: "read-only",
            reason: "zotero-unavailable",
          },
          sourceLabels: false,
        }),
      );
    } finally {
      await obEval(
        run.vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    }
  }, 120000);

  it("groups the sidebar Annotation View by colour from More options", async () => {
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
    await obEval(
      run.vaultId,
      `(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(annotationAttachment.path)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});app.commands.executeCommandById('zotlit:open-annot-view');app.commands.executeCommandById('zotlit:annot-view-follow-active-tab');return true;})()`,
    );
    const sidebar =
      "app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view";
    /** The sidebar's cards in screen order, each under the group heading above it. */
    const readSidebar = `(async()=>{const view=${sidebar};if(!view)return 'null';await view.read;const grid=view.contentEl.querySelector('[role="grid"]');let group=null;const cards=[];for(const node of grid?.querySelectorAll('[data-query-group], .zt-annot-card[data-zotero-annotation-key]')??[]){if(node.hasAttribute('data-query-group')){group=node.getAttribute('data-query-group');continue;}cards.push({key:node.getAttribute('data-zotero-annotation-key'),color:node.getAttribute('data-annot-color'),group});}return JSON.stringify({cards,query:view.getState().query??null});})()`;
    interface Sidebar {
      cards: { key: string; color: string; group: string | null }[];
      query: string | null;
    }
    const sidebarWhen = async (
      ready: (state: Sidebar) => boolean,
    ): Promise<Sidebar> => {
      let state: Sidebar | null = null;
      await expect
        .poll(
          async () => {
            const text = await obEval(run.vaultId, readSidebar);
            state = text === "null" ? null : (JSON.parse(text) as Sidebar);
            return state !== null && ready(state);
          },
          { timeout: 30_000, interval: 250 },
        )
        .toBe(true);
      return state!;
    };
    const expected = [...annotationKeys].sort();
    const before = await sidebarWhen(
      ({ cards }) =>
        JSON.stringify(cards.map(({ key }) => key).sort()) ===
        JSON.stringify(expected),
    );
    // A plain sidebar stands under no heading.
    expect(before.cards.every(({ group }) => group === null)).toBe(true);
    const colors = new Set(before.cards.map(({ color }) => color));
    expect(colors.size).toBeGreaterThan(1);

    // More options → Group by → Color, through Obsidian's own menu. A side
    // dock hides the view header, so the reader presses the header row's own
    // "More options".
    await obEval(
      run.vaultId,
      `(function(){${PAGE}press(${sidebar}.contentEl.querySelector('[data-annot-view-more-options]'),'More options');return true;})()`,
    );
    const menuItem = (title: string) =>
      `Array.from(document.querySelectorAll('.menu .menu-item')).find(item=>item.querySelector('.menu-item-title')?.textContent===${JSON.stringify(title)})`;
    expect(
      await obEvalUntil(
        run.vaultId,
        `String(!!${menuItem(run.m.annot_view_group_by())})`,
        {
          expected: "true",
        },
      ),
    ).toBe(true);
    await obEval(
      run.vaultId,
      `(function(){${PAGE}const item=${menuItem(run.m.annot_view_group_by())};item.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));press(item,'Group by');return true;})()`,
    );
    expect(
      await obEvalUntil(
        run.vaultId,
        `String(!!${menuItem(run.m.query_view_property_color())})`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      run.vaultId,
      `(function(){${PAGE}press(${menuItem(run.m.query_view_property_color())},'Color');return true;})()`,
    );

    const grouped = await sidebarWhen(({ cards }) =>
      cards.some(({ group }) => group !== null),
    );
    // The same cards, one group for each colour, each colour under one heading.
    expect(grouped.cards.map(({ key }) => key).sort()).toEqual(expected);
    const headings = new Map<string, string>();
    for (const { color, group } of grouped.cards) {
      expect(group).not.toBeNull();
      expect(headings.get(color) ?? group).toBe(group);
      headings.set(color, group!);
    }
    expect(new Set(headings.values()).size).toBe(colors.size);
    // The grouping is the sidebar's Query File, which its state keeps.
    expect(grouped.query).toContain("attachment == this.attachment");
    expect(grouped.query).toContain("colorName");

    // "Filter…" opens the Match editor of the sidebar's one view, without the
    // filter that names the followed Attachment. A side dock hides the view
    // header, so the reader presses the header row's own "More options".
    expect(
      await obEval(
        run.vaultId,
        `(function(){${PAGE}press(${sidebar}.contentEl.querySelector('[data-annot-view-more-options]'),'More options');return 'true';})()`,
      ),
    ).toBe("true");
    expect(
      await obEvalUntil(
        run.vaultId,
        `String(!!${menuItem(run.m.annot_view_filter())})`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      run.vaultId,
      `(function(){${PAGE}press(${menuItem(run.m.annot_view_filter())},'Filter');return true;})()`,
    );
    const filterModal = `(function(){const modal=document.querySelector('.modal.zt-annot-filter-modal');return JSON.stringify(modal?{title:modal.querySelector('.modal-title')?.textContent??null,sections:Array.from(modal.querySelectorAll('[data-filter-section]'),el=>el.getAttribute('data-filter-section')),text:modal.textContent.includes('this.attachment')}:null);})()`;
    expect(
      await obEvalUntil(run.vaultId, filterModal, {
        expected: JSON.stringify({
          title: run.m.annot_view_filter_title(),
          sections: ["view"],
          text: false,
        }),
      }),
    ).toBe(true);
    // In an expression condition of the dialog, Escape closes the completion
    // list, then the Signature Hint, and leaves the dialog open each time; a
    // list the typing opens over the hint closes first. Tab takes the
    // list's option and keeps focus in the field; the method it writes
    // brings its Signature Hint, which Escape closes, the dialog still open.
    // A key typed straight after Enter or Tab takes an option lands in the
    // field, which keeps focus (#1651). The condition goes again before the
    // eval answers.
    const escapes = JSON.parse(
      await obEval(
        run.vaultId,
        `(async()=>{${PAGE}await using cleanup=new AsyncDisposableStack();const contents=require('@electron/remote').getCurrentWebContents();const key=async(keyCode)=>{const up=new Promise(r=>window.addEventListener('keyup',r,{once:true,capture:true}));contents.sendInputEvent({type:'keyDown',keyCode});contents.sendInputEvent({type:'keyUp',keyCode});await up;};const modal=()=>document.querySelector('.modal.zt-annot-filter-modal');const section=modal().querySelector('[data-filter-section="view"]');const before=section.querySelectorAll('[data-condition-row]').length;press([...section.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(run.m.workbench_match_add_condition())}),'Add condition');const row=await until('new row',()=>section.querySelectorAll('[data-condition-row]')[before]);cleanup.defer(()=>{const remove=modal()?.querySelectorAll('[data-filter-section="view"] [data-condition-row]')[before]?.querySelector('button[aria-label="${run.m.workbench_match_remove_condition()}"]');if(remove)press(remove,'Remove condition');});press(row.querySelector('button[aria-label="${run.m.workbench_match_edit_as_expression()}"]'),'Edit as expression');const content=await until('expression field',()=>section.querySelectorAll('[data-condition-row]')[before]?.querySelector('.cm-content'));const editor=content.cmTile.root.view;window.focus();editor.focus();await until('focus in the field',()=>document.activeElement===content&&document.hasFocus(),5000);const type=(text)=>{editor.dispatch({selection:{anchor:0,head:editor.state.doc.length}});document.execCommand('insertText',false,text);};type('te');await until('list opens',()=>document.querySelector('.cm-tooltip-autocomplete'));await key('Escape');await until('Escape closes the list',()=>!document.querySelector('.cm-tooltip-autocomplete'));const list={dialog:!!modal()};if(!modal())return JSON.stringify({list});type('text.slice(1, ');await until('Signature Hint',()=>document.querySelector('.zt-signature-hint'));await new Promise(r=>setTimeout(r,200));if(document.querySelector('.cm-tooltip-autocomplete')){await key('Escape');await until('Escape closes the list over the hint',()=>!document.querySelector('.cm-tooltip-autocomplete'));}await key('Escape');await until('Escape closes the hint',()=>!document.querySelector('.zt-signature-hint'));const hint={dialog:!!modal()};type('text.sli');await until('list opens',()=>document.querySelector('.cm-tooltip-autocomplete li[aria-selected]'));await new Promise(r=>setTimeout(r,200));await key('Tab');await until('Tab closes the list',()=>!document.querySelector('.cm-tooltip-autocomplete'));const tab={doc:editor.state.doc.toString(),dialog:!!modal(),focus:document.activeElement===content};await until('Signature Hint of the method',()=>document.querySelector('.zt-signature-hint'));await key('Escape');await until('Escape closes the hint',()=>!document.querySelector('.zt-signature-hint'));tab.hintClosed=!!modal();const typed={};for(const [name,keyCode] of [['enter','Enter'],['tab','Tab']]){type('te');await until(name+' list opens',()=>document.querySelector('.cm-tooltip-autocomplete li[aria-selected]'));await new Promise(r=>setTimeout(r,200));await key(keyCode);const up=new Promise(r=>window.addEventListener('keyup',r,{once:true,capture:true}));contents.sendInputEvent({type:'keyDown',keyCode:'.'});contents.sendInputEvent({type:'char',keyCode:'.'});contents.sendInputEvent({type:'keyUp',keyCode:'.'});await up;await new Promise(r=>setTimeout(r,300));typed[name]={doc:editor.state.doc.toString(),focus:document.activeElement===content,dialog:!!modal()};while(document.querySelector('.cm-tooltip-autocomplete, .zt-signature-hint'))await key('Escape');}return JSON.stringify({list,hint,tab,typed});})()`,
      ),
    );
    expect(escapes).toEqual({
      list: { dialog: true },
      tab: {
        doc: "text.slice()",
        dialog: true,
        focus: true,
        hintClosed: true,
      },
      hint: { dialog: true },
      typed: {
        enter: { doc: "text.", focus: true, dialog: true },
        tab: { doc: "text.", focus: true, dialog: true },
      },
    });
    await obEval(
      run.vaultId,
      "(function(){const target=document.activeElement??document.body;target.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));return true;})()",
    );
    // No menu or dialog stays over the window for the cases after this one.
    expect(
      await obEvalUntil(
        run.vaultId,
        "String(document.querySelectorAll('.menu, .modal-container').length)",
        { expected: "0" },
      ),
    ).toBe(true);
  }, 120000);

  it("saves the sidebar filtered by one colour as a Query File, and a Literature Note that embeds it shows its Annotations of that colour", async () => {
    const savedPath = "query-files/Saved colour.zotquery";
    const notePath = `literatures/${annotationItem.literatureNoteName ?? annotationItem.key}.md`;
    const layout = await obEval(
      run.vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const noteText = await obEval(
      run.vaultId,
      `app.vault.read(app.vault.getFileByPath(${JSON.stringify(notePath)}))`,
    );
    const sidebar =
      "app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view";
    /**
     * Opens the colour Chooser, ticks the row of `color` (or "Clear selected
     * colors" for `null`), and closes the Chooser.
     */
    const pickColor = (color: string | null) =>
      `(async()=>{${PAGE}const el=${sidebar}?.containerEl;const trigger=Array.from(el?.querySelectorAll('button[aria-label]')??[]).find(b=>b.getAttribute('aria-label')===${JSON.stringify(run.m.annot_view_filter_color_trigger())}||b.getAttribute('aria-label').startsWith(${JSON.stringify(run.m.annot_view_filter_color_trigger_active({ colors: "" }))}));if(!trigger)return 'no chooser';press(trigger,'colour Chooser');const list=await until('colour list opens',()=>{const list=Array.from(document.querySelectorAll('[role="listbox"]')).find(list=>document.getElementById(list.getAttribute('aria-labelledby'))?.textContent===${JSON.stringify(run.m.annot_view_filter_color_list())});return list?.checkVisibility()?list:null;});const row=Array.from(list?.querySelectorAll('[role="option"]')??[]).find(option=>${color === null ? `option.textContent===${JSON.stringify(run.m.annot_view_filter_color_clear())}` : `option.querySelector('[style*="--zt-swatch-color"]')?.style.getPropertyValue('--zt-swatch-color').trim().toLowerCase()===${JSON.stringify(color.toLowerCase())}`});if(row){press(row,'colour row');await until('colour filter applies',()=>${color === null ? `trigger.getAttribute('aria-label')===${JSON.stringify(run.m.annot_view_filter_color_trigger())}` : `row.getAttribute('aria-selected')==='true'`});}(document.activeElement??document.body).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return row?'picked':'no row';})()`;
    let picked = false;
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      // The colour filter is saved for the Item; clearing it takes it back.
      if (picked) await obEval(run.vaultId, pickColor(null));
      await obEval(
        run.vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(notePath)}),${JSON.stringify(noteText)});const saved=app.vault.getFileByPath(${JSON.stringify(savedPath)});if(saved)await app.vault.delete(saved);return true;})()`,
      );
    });
    await obEval(
      run.vaultId,
      `(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(annotationAttachment.path)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});app.commands.executeCommandById('zotlit:open-annot-view');app.commands.executeCommandById('zotlit:annot-view-follow-active-tab');return true;})()`,
    );
    const readCards = `(async()=>{const view=${sidebar};if(!view)return 'null';await view.read;return JSON.stringify([...view.contentEl.querySelectorAll('.zt-annot-card[data-zotero-annotation-key]')].map(n=>n.getAttribute('data-zotero-annotation-key')).sort());})()`;
    const expected = [...annotationKeys].sort();
    expect(
      await obEvalUntil(run.vaultId, readCards, {
        expected: JSON.stringify(expected),
        tries: 120,
      }),
    ).toBe(true);

    // Filter the sidebar by the colour of the Fixture's first Annotation.
    const color = attachmentAnnotations[0]!.color;
    const ofColor = attachmentAnnotations
      .filter((annotation) => annotation.color === color)
      .map(({ key }) => key)
      .sort();
    expect(ofColor.length).toBeGreaterThan(0);
    expect(ofColor.length).toBeLessThan(expected.length);
    expect(await obEval(run.vaultId, pickColor(color))).toBe("picked");
    picked = true;
    expect(
      await obEvalUntil(run.vaultId, readCards, {
        expected: JSON.stringify(ofColor),
        tries: 80,
      }),
    ).toBe(true);

    // More options → "Save as query file…", through Obsidian's own menu. A
    // side dock hides the view header, so the reader presses the header
    // row's own "More options".
    expect(
      JSON.parse(
        await obEval(
          run.vaultId,
          `(function(){${PAGE}const button=press(${sidebar}.contentEl.querySelector('[data-annot-view-more-options]'),'More options');return JSON.stringify({label:button.getAttribute('aria-label')});})()`,
        ),
      ),
    ).toEqual({ label: run.m.annot_view_more_tooltip() });
    const menuItem = `Array.from(document.querySelectorAll('.menu .menu-item')).find(item=>item.querySelector('.menu-item-title')?.textContent===${JSON.stringify(run.m.annot_view_save_as_query_file())})`;
    expect(
      await obEvalUntil(run.vaultId, `String(!!${menuItem})`, {
        expected: "true",
      }),
    ).toBe(true);
    await obEval(
      run.vaultId,
      `(function(){${PAGE}press(${menuItem},'Save as query file');return true;})()`,
    );

    // The dialog asks the name, the folder, and which records the file shows.
    const modal = "document.querySelector('.modal.zt-save-query-file-modal')";
    const dialog = JSON.parse(
      await obEval(
        run.vaultId,
        `(function(){const modal=${modal};return JSON.stringify(modal?{title:modal.querySelector('.modal-title')?.textContent??null,fields:[...modal.querySelectorAll('[data-save-field]')].map(n=>n.getAttribute('data-save-field')),records:[...modal.querySelectorAll('[data-save-records]')].map(n=>({value:n.getAttribute('data-save-records'),label:n.closest('label').textContent,checked:n.checked}))}:null);})()`,
      ),
    ) as {
      title: string;
      fields: string[];
      records: { value: string; label: string; checked: boolean }[];
    } | null;
    expect(dialog).toMatchObject({
      title: run.m.annot_view_save_title(),
      fields: ["name", "folder"],
      records: [
        {
          value: "this-item",
          label: run.m.annot_view_save_records_this_item(),
          checked: true,
        },
        {
          value: "note-item",
          label: expect.stringContaining(
            run.m.annot_view_save_records_note_item(),
          ),
          checked: false,
        },
      ],
    });
    await obEval(
      run.vaultId,
      `(function(){${PAGE}const modal=${modal};const set=(field,value)=>{const input=modal.querySelector('[data-save-field="'+field+'"]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};set('name','Saved colour');set('folder','query-files');press(modal.querySelector('[data-save-records="note-item"]').closest('label'),'note-item records');press(modal.querySelector('.modal-button-container button.mod-cta'),'Save');return true;})()`,
    );

    // The file opens in a tab, where `this` has no value.
    const readTab = `(async()=>{const view=app.workspace.getMostRecentLeaf()?.view;if(view?.getViewType()!=='zotlit-query-file'||view.file?.path!==${JSON.stringify(savedPath)})return 'null';await view.query.settled;return JSON.stringify({diagnostic:view.contentEl.querySelector('[data-query-diagnostic]')?.getAttribute('data-query-diagnostic')??null,cards:view.contentEl.querySelectorAll('.zt-annot-card').length});})()`;
    expect(
      await obEvalUntil(run.vaultId, readTab, {
        expected: JSON.stringify({ diagnostic: "unbound-context", cards: 0 }),
        tries: 120,
      }),
    ).toBe(true);
    const saved = await obEval(
      run.vaultId,
      `app.vault.read(app.vault.getFileByPath(${JSON.stringify(savedPath)}))`,
    );
    expect(saved).toMatch(/^filters: item == this\.item$/m);
    expect(saved).toMatch(/^ {4}filters: color/m);

    // Embedded in the Item's Literature Note, it shows that note's
    // Annotations of the colour.
    await obEval(
      run.vaultId,
      `(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(notePath)});await app.vault.modify(file,${JSON.stringify(noteText.replace(/^(---\n[\s\S]*?\n---\n)/, "$1\n![[Saved colour.zotquery]]\n\n"))});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file,{state:{mode:'preview'}});app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
    );
    // The embed stands at the top of the note, where Reading view draws it
    // without a scroll.
    const readEmbed = `(async()=>{const view=app.workspace.getMostRecentLeaf()?.view;if(view?.file?.path!==${JSON.stringify(notePath)})return JSON.stringify({file:view?.file?.path??null});const el=[...view.containerEl.querySelectorAll('.internal-embed')].find(el=>el.zotlitQueryView&&el.isShown());if(!el)return JSON.stringify({embed:null});await el.zotlitQueryView.settled;return JSON.stringify({cards:[...el.querySelectorAll('.zt-annot-card[data-zotero-annotation-key]')].map(n=>n.getAttribute('data-zotero-annotation-key')).sort(),diagnostic:el.querySelector('[data-query-diagnostic]')?.getAttribute('data-query-diagnostic')??null});})()`;
    let embed: unknown = null;
    const shown = await waitFor(async () => {
      embed = JSON.parse(await obEval(run.vaultId, readEmbed));
      return (
        JSON.stringify((embed as { cards?: string[] }).cards) ===
        JSON.stringify(ofColor)
      );
    }, 120);
    if (!shown) throw new Error(`Query File embed: ${JSON.stringify(embed)}`);
  }, 180000);
});
