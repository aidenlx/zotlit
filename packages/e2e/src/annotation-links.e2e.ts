// Annotation links in a note: a Durable Annotation Link clicked in any
// Obsidian surface lands on its Annotation in Obsidian's reader, or reaches
// Zotero when this computer cannot open the PDF; a hovered one shows the
// Annotation it names. The Annotation Suggester writes the same link from a
// search at the cursor.

import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ATTACHMENTS } from "@zotlit/scripts/fixture";

import {
  annotationAttachment,
  annotationItem,
  annotationKeys,
  attachmentAnnotations,
  e2eFixture,
  reachable,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { obEval, WINDOW_DOCUMENTS } from "./obsidian-cli.ts";
import { MENU_READY } from "./page-gestures.ts";

const PDF_PATH = annotationAttachment.path!;
const NOTE = "Annotation links.md";

/** The Fixture's image Annotation on page two of the Rougier PDF. */
const SECOND_PAGE = attachmentAnnotations.find(
  ({ key }) => key === "FDRFQ7C2",
)!;
/** Two Annotations on page one, so each surface lands on a Mark of its own. */
const FIRST_PAGE = attachmentAnnotations.find(({ key }) => key === "PUPR5FG5")!;
const ALSO_FIRST_PAGE = attachmentAnnotations.find(
  ({ key }) => key === "Q8ZR4TDH",
)!;
/** The Fixture's note Annotation, which carries a comment and no text. */
const COMMENTED = attachmentAnnotations.find(({ key }) => key === "HRK7BG32")!;
/** The Fixture's ink Annotation. */
const INK = attachmentAnnotations.find(({ key }) => key === "TYY6Z6ZF")!;
/** An underline whose text a case rewrites with rich text. */
const RICH = attachmentAnnotations.find(({ key }) => key === "K3JRFLFQ")!;
/** A PDF the Fixture's Zotero holds a row for, and never a file. */
const MISSING_PDF = ATTACHMENTS.find(({ key }) => key === "MISSNG22")!;

/**
 * A second Attachment of the Rougier PDF's own file, which the Fixture does
 * not hold: the case that needs it adds it, with one Annotation of its own.
 */
const SHARED = { attachmentKey: "RGRSHRD2", annotationKey: "SHRDANN2" };

/** Stands in a note for the Rougier PDF's own `file://` URL on this computer. */
const FILE_URL = "%FILE_URL%";

/** The link Zotero writes into a child note for one Annotation. */
function durableLink(
  annotationKey: string,
  pageLabel: string,
  { attachmentKey = annotationAttachment.key }: { attachmentKey?: string } = {},
): string {
  return `zotero://open/library/items/${attachmentKey}?annotation=${annotationKey}&page=${pageLabel}`;
}

const LINK_TEXT = "the quoted passage";

/**
 * The citation the default annotation template writes after a quote of the
 * Rougier Item: its citation key, with the Annotation's page as a braced Pandoc locator.
 */
function citationOf(annotation: { pageLabel: string }): string {
  return `[@${annotationItem.citationKey}, {p. ${annotation.pageLabel}}]`;
}

/** A note quoting one passage, ending on an empty line that holds no link. */
function noteWith(url: string, properties = ""): string {
  return `${properties}# Draft\n\nAs Rougier argues, [${LINK_TEXT}](${url}).\n`;
}

/** What the Rougier PDF shows: its page, and the Marks it selects. */
interface ReaderState {
  page: number | null;
  selected: string[];
}

/** What one scenario left behind, read before its own cleanup ran. */
interface Outcome {
  /** Whether the Rougier PDF's view draws any Annotation Mark. */
  drawn: boolean;
  /** The Rougier PDF's view, or `null` when no tab shows it. */
  reader: ReaderState | null;
  /** Every `zotero:` URL the system handler was asked to open. */
  passed: { url: string; target: string | null }[];
  /** The text of every notice on screen. */
  notices: string[];
  /**
   * The Attachment the Rougier PDF's reader held each time the follow
   * recorded a read of the paper, in order; only for a scenario that asks.
   */
  reads?: (string | null)[];
}

/** The rendered link to `url` in the markdown view `view`, as eval code. */
const LINK_IN = {
  reading: `[...view.previewMode.containerEl.querySelectorAll('a.external-link')].find((a)=>a.getAttribute('href')===url)`,
  properties: `[...(view.metadataEditor?.containerEl.querySelectorAll('.metadata-link-inner.external-link')??[])].find((link)=>link.dataset.href===url)`,
  "live-preview": `[...view.editor.cm.contentDOM.querySelectorAll('.cm-link .cm-underline')].find((el)=>el.textContent===${JSON.stringify(LINK_TEXT)})`,
  source: `[...view.editor.cm.contentDOM.querySelectorAll('.cm-link')].find((el)=>el.textContent===${JSON.stringify(LINK_TEXT)})`,
} as const;

/**
 * Eval code that writes {@link NOTE} holding `content`, a JavaScript
 * expression, and shows it where `gesture` reaches its link, binding `file`,
 * `leaf` and `view`. Each step is undone on the evaluation's `cleanup` stack,
 * registered before the next step that can fail. An editor's cursor rests on
 * the note's last line, which holds no link, so Live Preview draws the link.
 */
function showNote(content: string, gesture: keyof typeof LINK_IN): string {
  const state =
    gesture === "reading"
      ? "{mode:'preview'}"
      : `{mode:'source',source:${gesture === "source"}}`;
  return `const file=await app.vault.create(${JSON.stringify(NOTE)},${content});
    cleanup.defer(()=>app.vault.delete(file));
    const leaf=app.workspace.getLeaf('tab');
    cleanup.adopt(leaf,(leaf)=>leaf.detach());
    await leaf.setViewState({type:'markdown',state:{file:file.path,...${state}},active:true});
    app.workspace.setActiveLeaf(leaf,{focus:true});
    const view=leaf.view;
    ${gesture === "reading" ? "" : "view.editor.setCursor({line:view.editor.lastLine(),ch:0});"}`;
}

/**
 * Eval code that finds the rendered link to `url` where `gesture` reaches it,
 * brings it into view, and binds `link` with a point `x`, `y` on it that
 * nothing covers.
 *
 * Gestures are synthetic: the End-to-end Run's window stays behind other apps,
 * where Chromium delivers no trusted input. Live Preview finds the link under
 * the pointer from the event's coordinates, so they name a point near the
 * start of the link's first line box: a wrapped link has none at the middle of
 * its bounding box, and a long Properties value runs on under the sidebar.
 */
function linkTarget(gesture: keyof typeof LINK_IN): string {
  return `const link=await until(()=>${LINK_IN[gesture]},()=>'The link did not render in ${gesture}');
    link.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    const box=link.getClientRects()[0];const x=box.left+Math.min(box.width/2,12),y=box.top+box.height/2;
    const hit=link.ownerDocument.elementFromPoint(x,y);
    if(!hit||!(hit===link||link.contains(hit)))throw new Error('The link is covered by '+(hit?.outerHTML.slice(0,120)??'nothing'));`;
}

/**
 * The bounded waits an evaluation declares first. Every wait ends by
 * throwing, inside the evaluation, so its cleanup stack still runs.
 * `until(found, what)` polls until `found()` answers, and answers with it;
 * `within(promise, end, what)` settles with `promise` or throws at `end`.
 */
const WAITS = `
  const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
  const deadline=()=>Temporal.Now.instant().add({seconds:15});
  const past=(end)=>Temporal.Instant.compare(Temporal.Now.instant(),end)>0;
  const within=(promise,end,what)=>{
    let timer;
    const late=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(what)),Math.max(0,Temporal.Now.instant().until(end).total('milliseconds')));});
    return Promise.race([promise,late]).finally(()=>clearTimeout(timer));
  };
  const until=async(found,what)=>{
    for(const end=deadline();;await sleep(100)){
      const value=found();
      if(value)return value;
      if(past(end))throw new Error(what());
    }
  };`;

/**
 * Eval code, inside an `await using cleanup` block after {@link WAITS} and
 * first on its stack, that puts the Use Ledger back as the block found it once
 * every view the block opened has closed. A followed link records a read and
 * an insert a citation; the ledger keeps the newest Use of each Item and lets
 * none go, so ZotLit loads afresh over the saved entries, as it would at
 * startup — only where the scenario changed them. The reload unpatches and
 * patches `window.open` again over the suite's recorder, and warms the
 * Attachment index again, which the next scenario's click needs.
 */
const RESTORE_LEDGER = `
  const savedLedger=JSON.stringify(app.loadLocalStorage('zotlit-use-ledger')??null);
  cleanup.defer(async()=>{
    if(JSON.stringify(app.loadLocalStorage('zotlit-use-ledger')??null)===savedLedger)return;
    app.workspace.requestActiveLeafEvents.run();
    const old=app.plugins.plugins.zotlit.services;
    await app.plugins.disablePlugin('zotlit');
    await old.pdfAnnotationEditor[Symbol.asyncDispose]();
    await old.useLedger[Symbol.asyncDispose]();
    await old.zoteroLocalApi[Symbol.asyncDispose]();
    app.saveLocalStorage('zotlit-use-ledger',JSON.parse(savedLedger));
    await app.plugins.enablePlugin('zotlit');
    const fresh=app.plugins.plugins.zotlit.services;
    await within(fresh.useLedger.ready,deadline(),'The Use Ledger did not load again');
    const restored=JSON.stringify(app.loadLocalStorage('zotlit-use-ledger')??null);
    if(restored!==savedLedger)throw new Error('The Use Ledger came back changed: '+restored);
    await within(fresh.attachmentResolver.indexed,deadline(),'The Attachment index was not built again');
  });`;

/**
 * Opens a draft `leaf` in Live Preview whose last line reads `line`, as eval
 * code that runs inside an `await using cleanup` block: the layout, the note,
 * and the leaf are each restored on that stack, registered before the step
 * that can fail.
 */
const draft = (line: string) => `
  const layout=app.workspace.getLayout();
  cleanup.defer(()=>app.workspace.changeLayout(layout));
  const file=await app.vault.create(${JSON.stringify(NOTE)},${JSON.stringify(`# Draft\n\n${line}`)});
  cleanup.defer(()=>app.vault.delete(file));
  const leaf=app.workspace.getLeaf('tab');
  // An insertion is an edit the view saves later; saving it first keeps
  // that save from writing the note back after its deletion.
  cleanup.adopt(leaf,async(leaf)=>{await leaf.view.save?.();leaf.detach();});
  await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false},active:true});`;

/**
 * A one-line annotation template: the quote, its citation, and the durable
 * link, the shape a researcher writes to quote inside a sentence.
 */
const INLINE_ANNOTATION =
  "{{ zt.text }} {{ zt.citation }} [Zotero]({{ zt.backlink }})";

/** What {@link INLINE_ANNOTATION} renders for `annotation`. */
function inlineOf(annotation: {
  key: string;
  text?: string | null;
  pageLabel: string;
}): string {
  return `${annotation.text} ${citationOf(annotation)} [Zotero](${durableLink(annotation.key, annotation.pageLabel)})`;
}

/**
 * Eval code, inside an `await using cleanup` block after {@link WAITS}, that
 * makes the default Literature Note Profile render annotations through
 * {@link INLINE_ANNOTATION} until the block ends. A built-in Default gets a
 * document of its own, deleted on that stack; an existing one is restored.
 * Either way the templates reload afterwards.
 */
const INLINE_PROFILE = `
  const services=app.plugins.plugins.zotlit.services;
  const profilePath=services.profile.defaultDocumentPath;
  const existing=app.vault.getFileByPath(profilePath);
  const original=existing?await app.vault.read(existing):services.profile.getBuiltInSource();
  const header=${JSON.stringify("--- zotlit:annotation ---")};
  if(!original.includes(header))throw new Error('The default profile has no annotation section');
  if(!original.includes('{%'))throw new Error('The default profile does not render through Liquid');
  const inline=original.slice(0,original.indexOf(header)+header.length)+${JSON.stringify(`\n${INLINE_ANNOTATION}\n`)};
  if(existing){
    cleanup.defer(async()=>{await app.vault.modify(existing,original);await services.template.refresh();});
    await app.vault.modify(existing,inline);
  }else{
    const folder=profilePath.slice(0,profilePath.lastIndexOf('/'));
    if(folder&&!app.vault.getFolderByPath(folder)){
      cleanup.defer(async()=>{const made=app.vault.getFolderByPath(folder);if(made&&made.children.length===0)await app.vault.delete(made);});
      await app.vault.createFolder(folder);
    }
    cleanup.defer(async()=>{const made=app.vault.getFileByPath(profilePath);if(made)await app.vault.delete(made);await services.template.refresh();});
    await app.vault.create(profilePath,inline);
  }
  await services.template.refresh();
  await until(()=>services.template.getLoadedDocumentSource(profilePath)?.includes(${JSON.stringify(INLINE_ANNOTATION)}),()=>'The inline annotation template did not load');`;

/**
 * Where an insert lands and what follows it: the draft's last line reads
 * `line` with the cursor at `ch`; `inline` renders through
 * {@link INLINE_ANNOTATION}; `typeOn` is typed once the insert lands.
 */
interface InsertAt {
  line?: string;
  ch?: number;
  inline?: boolean;
  typeOn?: string;
}

/** Eval code that types `typeOn` at the cursor of `editor`, when given. */
const typeAfter = (typed: string | undefined) =>
  typed === undefined
    ? ""
    : `editor.cm.dispatch(editor.cm.state.replaceSelection(${JSON.stringify(typed)}),{userEvent:'input.type'});`;

/**
 * Inserts the Annotation `annotationKey` of the Rougier Item into an empty
 * draft the way a reader does: its card's "More options" menu in the
 * Annotation View, then "Insert into note". Answers the draft's text once the
 * insertion lands, from a vault already restored.
 */
async function insertFromCard(
  annotationKey: string,
  { line = "", ch = 0, inline = false, typeOn }: InsertAt = {},
): Promise<string> {
  const card = `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]`;
  const reply = await obEval(
    run.vaultId,
    `(async()=>{
      ${WAITS}
      let text;
      {
        await using cleanup=new AsyncDisposableStack();
        ${RESTORE_LEDGER}
        ${inline ? INLINE_PROFILE : ""}
        ${draft(line)}
        const sidebar=app.workspace.getRightLeaf(false);
        cleanup.adopt(sidebar,(leaf)=>leaf.detach());
        await sidebar.setViewState({type:'zotero-annotation-view',state:{followMode:'pinned',pinnedItemKey:${JSON.stringify(annotationItem.key)}}});
        await app.workspace.revealLeaf(sidebar);
        app.workspace.setActiveLeaf(leaf,{focus:true});
        const editor=leaf.view.editor;
        editor.setCursor({line:editor.lastLine(),ch:${ch}});
        const more=await until(()=>sidebar.view.contentEl.querySelector(${JSON.stringify(`${card} [aria-label="More options"]`)}),()=>'The Annotation card did not render');
        more.click();
        const item=await until(()=>[...activeDocument.querySelectorAll('.menu-item')].find((el)=>el.textContent.trim()==='Insert into note'),()=>'The card menu offers no "Insert into note"');
        await ${MENU_READY};
        item.click();
        await until(()=>editor.getValue().includes(${JSON.stringify(annotationKey)}),()=>'Nothing was inserted: '+JSON.stringify(editor.getValue()));
        ${typeAfter(typeOn)}
        text=editor.getValue();
      }
      return JSON.stringify(text);
    })()`,
    60000,
  );
  return JSON.parse(reply) as string;
}

/** What typing a search into a draft left: its text, and which suggesters opened. */
interface SearchOutcome {
  text: string;
  /** The rows the Annotation Suggester showed for the query, by their text. */
  rows: string[];
  /** The superscript the chosen row drew from the quote's rich text, if any. */
  sup: string | null;
  /** Whether the Citation Suggester opened on the typed text. */
  citationOpen: boolean;
  /** The Use the insert recorded for the Rougier Item, or null for none. */
  use: string | null;
}

/**
 * Types `typed` at the end of an empty draft as one input, waits for the
 * Annotation Suggester to answer that query, and chooses the row whose text
 * holds `choose`. Answers the draft's text once the insert lands, from a
 * vault already restored.
 */
async function searchAndInsert(
  typed: string,
  choose: string,
  { line = "", ch = 0, inline = false, typeOn }: InsertAt = {},
): Promise<SearchOutcome> {
  const reply = await obEval(
    run.vaultId,
    `(async()=>{
      ${WAITS}
      const suggesters=app.workspace.editorSuggest.suggests;
      const annotations=suggesters.find((s)=>s.constructor.name==='AnnotationEditorSuggest');
      const citations=suggesters.find((s)=>s.constructor.name==='CitationEditorSuggest');
      if(!annotations)throw new Error('No Annotation Suggester is registered');
      let outcome;
      {
        await using cleanup=new AsyncDisposableStack();
        ${RESTORE_LEDGER}
        ${inline ? INLINE_PROFILE : ""}
        ${draft(line)}
        cleanup.defer(()=>annotations.close());
        const ledger=()=>app.plugins.plugins.zotlit.services.useLedger.get(${JSON.stringify(annotationItem.key)});
        const before=ledger()?.instant.toString()??null;
        app.workspace.setActiveLeaf(leaf,{focus:true});
        const editor=leaf.view.editor;
        editor.setCursor({line:editor.lastLine(),ch:${ch}});
        editor.focus();
        editor.cm.dispatch(editor.cm.state.replaceSelection(${JSON.stringify(typed)}),{userEvent:'input.type'});
        const query=${JSON.stringify(typed)}.slice(${JSON.stringify(typed)}.indexOf('[>')+2);
        const rows=()=>[...annotations.suggestEl.querySelectorAll('.suggestion-item')];
        const row=await until(()=>annotations.isOpen&&annotations.context?.query===query&&rows().find((el)=>el.textContent.includes(${JSON.stringify(choose)})),()=>'The Annotation Suggester showed no row for '+JSON.stringify(query)+': '+JSON.stringify(rows().map((el)=>el.textContent)));
        const shown=rows().map((el)=>el.textContent);
        const sup=row.querySelector('sup')?.textContent??null;
        const citationOpen=!!citations?.isOpen;
        row.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}));
        row.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        await until(()=>{const value=editor.getValue();return !value.includes('[>')&&value.includes('zotero://');},()=>'Nothing was inserted: '+JSON.stringify(editor.getValue()));
        ${typeAfter(typeOn)}
        const text=editor.getValue();
        // The Use lands with the text, so a Use the insert made is newer than
        // the one held before the search.
        const after=ledger();
        const use=after&&after.instant.toString()!==before?after.kind:null;
        outcome={text,rows:shown,sup,citationOpen,use};
      }
      return JSON.stringify(outcome);
    })()`,
    60000,
  );
  return JSON.parse(reply) as SearchOutcome;
}

/** The settings that decide what ZotLit does with a Durable Annotation Link. */
interface LinkSettings {
  "citation.annotation-links"?: boolean;
  "citation.open-annotation-links"?: boolean;
}

/**
 * Eval code, inside an evaluation's `cleanup` block with `s` bound to
 * ZotLit's services, that changes the annotation link settings to `changes`
 * and puts each one back on the stack first.
 */
function applyLinkSettings(changes: LinkSettings): string {
  return Object.entries(changes)
    .map(
      ([key, value]) => `{const was=s.settings.current[${JSON.stringify(key)}];
        cleanup.defer(()=>s.settings.update({[${JSON.stringify(key)}]:was}));
        s.settings.update({[${JSON.stringify(key)}]:${JSON.stringify(value)}});}`,
    )
    .join("\n");
}

interface Scenario {
  /** The note's Markdown; {@link FILE_URL} becomes the PDF's own `file://` URL. */
  note: string;
  /** The link the gesture follows; {@link FILE_URL} is replaced as in `note`. */
  url: string;
  /**
   * Where the link is clicked, `external` for Obsidian's open-in-default-app
   * target, or `chip` for the page chip of the Annotation's card in the
   * Annotation View, which carries the link as its backlink.
   */
  gesture: keyof typeof LINK_IN | "external" | "chip";
  /** Turn `reader.open-file-links` off for this scenario. */
  captureOff?: boolean;
  /** The annotation link settings to change for this scenario. */
  linkSettings?: LinkSettings;
  /** The reader state that ends the wait early, when a landing is expected. */
  lands?: ReaderState;
  /** The Attachment the reader must name for a landing; the Rougier PDF's own by default. */
  bound?: string;
  /** Report the reads the follow recorded, as {@link Outcome.reads}. */
  reads?: boolean;
}

/**
 * One scenario in one evaluation: write the note, show it, follow its link,
 * wait for the reader to land or the link to pass, and read the outcome. Every
 * change is undone on the evaluation's own stack, registered before the step
 * that can fail, so the outcome comes back from a vault already restored. The
 * click lands on {@link linkTarget}'s point.
 */
async function follow({
  note,
  url,
  gesture,
  captureOff = false,
  linkSettings = {},
  lands,
  bound = annotationAttachment.key,
  reads = false,
}: Scenario): Promise<Outcome> {
  const follow =
    gesture === "external"
      ? `window.open(url,'_external');`
      : gesture === "chip"
        ? `const sidebar=app.workspace.getRightLeaf(false);
        cleanup.adopt(sidebar,(leaf)=>leaf.detach());
        await sidebar.setViewState({type:'zotero-annotation-view',state:{followMode:'pinned',pinnedItemKey:${JSON.stringify(annotationItem.key)}}});
        await app.workspace.revealLeaf(sidebar);
        const card='.zt-annot-card[data-zotero-annotation-key='+JSON.stringify(new URL(url).searchParams.get('annotation'))+']';
        const link=await until(()=>sidebar.view.contentEl.querySelector(card+' a.zt-annot-page-chip'),()=>'The card drew no page chip');
        link.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
        const box=link.getBoundingClientRect();
        link.dispatchEvent(new MouseEvent('click',{clientX:box.left+box.width/2,clientY:box.top+box.height/2,bubbles:true,cancelable:true,button:0,view:link.ownerDocument.defaultView}));`
        : `${linkTarget(gesture)}
        const init={clientX:x,clientY:y,bubbles:true,cancelable:true,button:0,view:link.ownerDocument.defaultView};
        link.dispatchEvent(new MouseEvent('mousedown',{...init,buttons:1}));link.dispatchEvent(new MouseEvent('mouseup',init));link.dispatchEvent(new MouseEvent('click',init));`;
  const reply = await obEval(
    run.vaultId,
    `(async()=>{
      ${WAITS}
      const s=app.plugins.plugins.zotlit.services;
      const observe=()=>{
        const pdf=app.workspace.getLeavesOfType('pdf').map(({view})=>view).find((view)=>view.file?.path===${JSON.stringify(PDF_PATH)});
        return {
          drawn:!!pdf?.containerEl.querySelector('.zt-pdf-annotation-mark'),
          reader:pdf?{page:pdf.viewer.child?.pdfViewer?.pdfViewer?.currentPageNumber??null,selected:[...new Set([...pdf.containerEl.querySelectorAll('.zt-pdf-annotation-mark.is-selected')].map((mark)=>mark.dataset.zoteroAnnotationKey))]}:null,
          passed:window.__ztLinks.passed.slice(),
          notices:${WINDOW_DOCUMENTS}.flatMap((doc)=>[...doc.querySelectorAll('.notice')].map((notice)=>notice.textContent)),
        };
      };
      let outcome;
      {
        await using cleanup=new AsyncDisposableStack();
        ${RESTORE_LEDGER}
        const layout=app.workspace.getLayout();
        cleanup.defer(async()=>{for(const leaf of app.workspace.getLeavesOfType('pdf'))leaf.detach();await app.workspace.changeLayout(layout);});
        const captureSetting=s.settings.current['reader.open-file-links'];
        cleanup.defer(()=>s.settings.update({'reader.open-file-links':captureSetting}));
        window.__ztLinks.passed=[];
        for(const doc of ${WINDOW_DOCUMENTS})for(const notice of doc.querySelectorAll('.notice'))notice.remove();
        const fileUrl=require('url').pathToFileURL(app.vault.adapter.getFullPath(${JSON.stringify(PDF_PATH)})).href;
        const url=${JSON.stringify(url)}.replaceAll(${JSON.stringify(FILE_URL)},fileUrl);
        if(${captureOff})s.settings.update({'reader.open-file-links':false});
        ${applyLinkSettings(linkSettings)}
        ${gesture === "chip" ? "" : showNote(`${JSON.stringify(note)}.replaceAll(${JSON.stringify(FILE_URL)},fileUrl)`, gesture === "external" ? "live-preview" : gesture)}
        // The ledger records a read as the reader names its Attachment, so
        // the reader is asked which one it holds as each read lands.
        const reads=[];
        cleanup.defer(s.useLedger.on('changed',()=>{
          const [newest]=Object.entries(s.useLedger.uses).sort(([,a],[,b])=>b-a)[0]??[];
          if(s.useLedger.get(newest)?.kind==='read')reads.push(s.pdfAnnotationEditor.bindings.find((b)=>b.filePath===${JSON.stringify(PDF_PATH)})?.attachment.attachmentKey??null);
        }));
        ${follow}
        const lands=${JSON.stringify(lands === undefined ? null : JSON.stringify(lands))};
        if(lands===null){
          // A passed link is recorded as the open hands it on, which is the
          // whole of the gesture's work.
          await until(()=>window.__ztLinks.passed.length>0,()=>'No link reached the system handler');
        }else{
          // The reader's binding decides the Landing as it draws the read it
          // starts once it names the Attachment; a later read replaces the
          // promise, so the wait runs until the one awaited is the last.
          const binding=await until(()=>s.pdfAnnotationEditor.bindings.find((b)=>b.filePath===${JSON.stringify(PDF_PATH)}&&b.attachment.kind==='resolved'&&b.attachment.attachmentKey===${JSON.stringify(bound)}),()=>'No reader named the Attachment '+${JSON.stringify(bound)}+': '+JSON.stringify(s.pdfAnnotationEditor.bindings.map((b)=>b.attachment)));
          for(let read=binding.refreshed,end=deadline();;read=binding.refreshed){
            await within(read,end,'The reader never drew its last read');
            if(read===binding.refreshed)break;
          }
          // Obsidian's own page jump and the Landing's scroll frame follow.
          await until(()=>JSON.stringify(observe().reader)===lands,()=>'The reader did not land: '+JSON.stringify(observe()));
        }
        outcome={...observe(),...(${reads}?{reads}:{})};
      }
      return JSON.stringify(outcome);
    })()`,
    60000,
  );
  return JSON.parse(reply) as Outcome;
}

/**
 * Adds {@link SHARED} to the Fixture's Zotero database the way Zotero keeps a
 * second Attachment of one linked file: a copy of the Rougier PDF's
 * Attachment row under its own key, and a copy of `annotationKey` as its
 * one Annotation. Each row copies every column of its model but the id, the
 * key and the parent. Disposing deletes the rows it wrote.
 */
function addSharedFileAttachment(
  databasePath: string,
  annotationKey: string,
): Disposable {
  using database = new DatabaseSync(databasePath);
  const itemIDOf = (key: string) =>
    Number(
      (
        database.prepare("select itemID from items where key = ?").get(key) as {
          itemID: number;
        }
      ).itemID,
    );
  /** Inserts a copy of `table`'s row for `itemID`, with `set` in place. */
  const copy = (
    table: string,
    itemID: number,
    set: Record<string, string | number>,
  ) => {
    const columns = (
      database.prepare(`pragma table_info(${table})`).all() as {
        name: string;
      }[]
    ).map(({ name }) => name);
    database
      .prepare(
        `insert into ${table} (${columns.join(", ")}) select ${columns.map((name) => (name in set ? "?" : name)).join(", ")} from ${table} where itemID = ?`,
      )
      .run(
        ...columns.filter((name) => name in set).map((name) => set[name]!),
        itemID,
      );
  };
  const attachmentID = Number(
    Object.values(
      database.prepare("select max(itemID) + 1 from items").get()!,
    )[0],
  );
  const annotationID = attachmentID + 1;

  // One transaction: a failed write leaves no row behind.
  database.exec("begin");
  using rollback = new DisposableStack();
  rollback.defer(() => database.exec("rollback"));
  const source = itemIDOf(annotationAttachment.key);
  copy("items", source, { itemID: attachmentID, key: SHARED.attachmentKey });
  copy("itemAttachments", source, { itemID: attachmentID });
  const annotation = itemIDOf(annotationKey);
  copy("items", annotation, {
    itemID: annotationID,
    key: SHARED.annotationKey,
  });
  copy("itemAnnotations", annotation, {
    itemID: annotationID,
    parentItemID: attachmentID,
  });
  database.exec("commit");
  rollback.move();

  return {
    [Symbol.dispose]() {
      using database = new DatabaseSync(databasePath);
      database.exec("begin");
      for (const table of ["itemAnnotations", "itemAttachments", "items"])
        database
          .prepare(`delete from ${table} where itemID between ? and ?`)
          .run(attachmentID, annotationID);
      database.exec("commit");
    },
  };
}

/**
 * Has ZotLit read the database again and waits, bounded, until its Attachment
 * index answers `kind` for {@link SHARED}'s Attachment. Answers which
 * Attachment the Rougier PDF's path names then.
 */
async function reindexed(kind: "resolved" | "unresolved"): Promise<string> {
  const reply = await obEval(
    run.vaultId,
    `(async()=>{
      ${WAITS}
      const s=app.plugins.plugins.zotlit.services;
      await s.zoteroReads.refresh();
      await until(()=>s.attachmentResolver.lookup(${JSON.stringify(SHARED.attachmentKey)}).kind===${JSON.stringify(kind)},()=>'The Attachment index never answered ${kind} for ${SHARED.attachmentKey}');
      return JSON.stringify(s.attachmentResolver.resolve(app.vault.adapter.getFullPath(${JSON.stringify(PDF_PATH)})).attachmentKey??null);
    })()`,
    60000,
  );
  return JSON.parse(reply) as string;
}

/** What two tabs on the Rougier PDF's one file showed, as {@link sharedTabs} read it. */
interface SharedTabsOutcome {
  /**
   * The Attachment the tab ZotLit found open held each time an open recorded
   * a read of the paper, from the open that named {@link SHARED}'s Attachment.
   */
  reads: (string | null)[];
  /** The Attachment that tab is bound to once that open lands. */
  restored: string | null;
  /** The Annotation View's cards beside that tab, by key. */
  besideRestored: string[];
  /** The Annotation View's cards beside a second tab on the file, by key. */
  besideSecond: string[];
  /** Every `zotero:` URL the system handler was asked to open. */
  passed: string[];
}

/**
 * With {@link SHARED} in the Fixture: a tab on the Rougier PDF that ZotLit
 * found open as it loaded, the way it finds a tab Obsidian restored at
 * startup, takes an open of {@link SHARED}'s Annotation through the opener
 * every ZotLit gesture shares. A second tab then opens the same file plainly,
 * and the sidebar Annotation View, following the active tab, is read beside
 * each tab. Every change is undone on the evaluation's own stack, the Use
 * Ledger included.
 */
async function sharedTabs(): Promise<SharedTabsOutcome> {
  const cardsOf = (keys: readonly string[]) => JSON.stringify([...keys].sort());
  const reply = await obEval(
    run.vaultId,
    `(async()=>{
      ${WAITS}
      const services=()=>app.plugins.plugins.zotlit.services;
      const file=app.vault.getFileByPath(${JSON.stringify(PDF_PATH)});
      const attachmentOf=(leaf)=>services().pdfAnnotationEditor.sessionFor(leaf.view)?.target?.attachmentKey??null;
      const boundTo=(leaf,key,what)=>until(()=>attachmentOf(leaf)===key,()=>what+' never named '+key+': '+attachmentOf(leaf));
      let outcome;
      {
        await using cleanup=new AsyncDisposableStack();
        ${RESTORE_LEDGER}
        const layout=app.workspace.getLayout();
        cleanup.defer(async()=>{for(const leaf of app.workspace.getLeavesOfType('pdf'))leaf.detach();await app.workspace.changeLayout(layout);});
        window.__ztLinks.passed=[];
        const restored=app.workspace.getLeaf('tab');
        cleanup.adopt(restored,(leaf)=>leaf.detach());
        await restored.openFile(file);
        await boundTo(restored,${JSON.stringify(annotationAttachment.key)},'The first tab');
        // ZotLit loads with the tab already open, as at startup.
        await app.plugins.disablePlugin('zotlit');
        await app.plugins.enablePlugin('zotlit');
        await within(services().attachmentResolver.indexed,deadline(),'The Attachment index was not built again');
        await boundTo(restored,${JSON.stringify(annotationAttachment.key)},'The tab ZotLit found open');
        // A read is recorded once its binding names the Attachment, before
        // the tab's session does, so each is credited to the binding's.
        const reads=[];
        const ledger=services().useLedger;
        cleanup.defer(ledger.on('changed',()=>{
          const [newest]=Object.entries(ledger.uses).sort(([,a],[,b])=>b-a)[0]??[];
          if(ledger.get(newest)?.kind==='read')reads.push(services().pdfAnnotationEditor.bindingFor(restored.view)?.attachment.attachmentKey??null);
        }));
        app.workspace.setActiveLeaf(restored,{focus:true});
        const opened=await services().targetOpener.open({kind:'annotation',attachmentKey:${JSON.stringify(SHARED.attachmentKey)},annotationKey:${JSON.stringify(SHARED.annotationKey)},pageIndex:0,pageLabel:${JSON.stringify(FIRST_PAGE.pageLabel)}},false);
        if(opened.kind!=='reader')throw new Error('The open went elsewhere: '+JSON.stringify(opened));
        await boundTo(restored,${JSON.stringify(SHARED.attachmentKey)},'The tab ZotLit found open');
        const second=app.workspace.getLeaf('tab');
        cleanup.adopt(second,(leaf)=>leaf.detach());
        await second.openFile(file);
        await boundTo(second,${JSON.stringify(annotationAttachment.key)},'The second tab');
        const sidebar=app.workspace.getRightLeaf(false);
        cleanup.adopt(sidebar,(leaf)=>leaf.detach());
        await sidebar.setViewState({type:'zotero-annotation-view',state:{followMode:'active-tab'}});
        await app.workspace.revealLeaf(sidebar);
        const cards=()=>[...new Set([...sidebar.view.contentEl.querySelectorAll('.zt-annot-card[data-zotero-annotation-key]')].map((el)=>el.dataset.zoteroAnnotationKey))].sort();
        // Each wait ends on the cards of the Attachment its tab holds; a
        // sidebar stuck on other cards fails with the cards it last showed.
        const beside=(leaf,expected)=>{
          app.workspace.setActiveLeaf(leaf,{focus:true});
          return until(()=>JSON.stringify(cards())===expected&&cards(),()=>'The Annotation View beside the tab showed '+JSON.stringify(cards())+', not '+expected);
        };
        const besideRestored=await beside(restored,${JSON.stringify(cardsOf([SHARED.annotationKey]))});
        const besideSecond=await beside(second,${JSON.stringify(cardsOf(annotationKeys))});
        outcome={reads,restored:attachmentOf(restored),besideRestored,besideSecond,passed:window.__ztLinks.passed.map(({url})=>url)};
      }
      return JSON.stringify(outcome);
    })()`,
    120000,
  );
  return JSON.parse(reply) as SharedTabsOutcome;
}

/**
 * Sets the stored text of the Fixture's Annotation `annotationKey` to `text`
 * in its Zotero database, as Zotero stores rich text: its own HTML subset.
 * Disposing writes the Fixture's text back.
 */
function rewriteAnnotationText(
  databasePath: string,
  annotationKey: string,
  text: string,
): Disposable {
  const write = (value: string | null) => {
    using database = new DatabaseSync(databasePath);
    database
      .prepare(
        "update itemAnnotations set text = ? where itemID = (select itemID from items where key = ?)",
      )
      .run(value, annotationKey);
  };
  const original = attachmentAnnotations.find(
    ({ key }) => key === annotationKey,
  )!.text;
  write(text);
  return { [Symbol.dispose]: () => write(original ?? null) };
}

/**
 * Has ZotLit read the database again and waits, bounded, until its Annotation
 * repository holds `text` for the Rougier PDF's Annotation `annotationKey`.
 */
async function reread(annotationKey: string, text: string): Promise<void> {
  await obEval(
    run.vaultId,
    `(async()=>{
      ${WAITS}
      const s=app.plugins.plugins.zotlit.services;
      await s.zoteroReads.refresh();
      const holds=async()=>(await s.annotationRepository.read(${JSON.stringify(annotationAttachment.key)}))?.annotations.find(({key})=>key===${JSON.stringify(annotationKey)})?.text===${JSON.stringify(text)};
      for(const end=deadline();!(await holds());await sleep(100))if(past(end))throw new Error('The repository never read the new text of ${annotationKey}');
      return true;
    })()`,
    60000,
  );
}

/** What a hover over one link left on screen, read before its cleanup ran. */
interface HoverOutcome {
  /** Whether the hover hung a popover off the note's view. */
  popover: boolean;
  /** The popover's text once filled, or null with no popover. */
  text: string | null;
  /** The Annotation colour the popover carries, or null with none. */
  color: string | null;
  /** Whether the popover painted a decoded Excerpt Image. */
  image: boolean;
  /** The superscript the popover drew from the quote's rich text, if any. */
  sup: string | null;
  /**
   * The text of the popover a second hover over the same link opened, in the
   * same view, once annotation links were turned on again; only for a
   * scenario that asks.
   */
  restored?: string;
}

/** The link a hover that shows nothing is read against: one that shows a popover. */
const CONTROL_URL = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);

interface HoverScenario {
  /** The link the note quotes, and the pointer hovers. */
  url: string;
  gesture: "live-preview" | "reading" | "source";
  /** The Hover Action for this scenario; the vault's own when omitted. */
  hoverAction?: "off" | "popover" | "page-preview";
  /**
   * Whether ZotLit's row in Obsidian's Page preview settings asks for Mod;
   * the vault's own when omitted.
   */
  pagePreviewMod?: boolean;
  /** Turn `citation.pandoc-citations` off for this scenario. */
  pandocOff?: boolean;
  /** The annotation link settings to change for this scenario. */
  linkSettings?: LinkSettings;
  /**
   * The annotation link settings to change once the note is open, so the
   * editor that hovers is one that was built before the change.
   */
  afterOpen?: LinkSettings;
  /**
   * After the hover that shows nothing, turn annotation links on again and
   * hover the same link in the same view, as {@link HoverOutcome.restored}.
   */
  restore?: boolean;
  /** Wait for a decoded Excerpt Image as well as the text. */
  image?: boolean;
  /** Hold Ctrl or Command through the hover. */
  mod?: boolean;
  /** The hover is expected to show nothing; read against a control hover. */
  absent?: boolean;
}

/**
 * One hover in one evaluation: write the note, show it, move the pointer onto
 * its link, and read what the popover the hover hung off the view shows. As in
 * {@link follow}, every change is undone on the evaluation's own stack before
 * the outcome comes back.
 *
 * The hover is a synthetic `mouseover` at {@link linkTarget}'s point. Obsidian
 * hangs a hover popover off the view once its opening delay has run, so a
 * hover that shows nothing is read against a later hover over
 * {@link CONTROL_URL} that does.
 */
async function hover({
  url,
  gesture,
  hoverAction,
  pagePreviewMod,
  pandocOff = false,
  linkSettings = {},
  afterOpen = {},
  restore = false,
  image = false,
  mod = false,
  absent = hoverAction === "off",
}: HoverScenario): Promise<HoverOutcome> {
  // The control link has a line of its own; the cursor stays on the empty
  // last line, which holds no link.
  const note =
    absent && url !== CONTROL_URL
      ? `${noteWith(url)}\nSee also [the control](${CONTROL_URL}).\n`
      : noteWith(url);
  const reply = await obEval(
    run.vaultId,
    `(async()=>{
      ${WAITS}
      const s=app.plugins.plugins.zotlit.services;
      let outcome;
      {
        await using cleanup=new AsyncDisposableStack();
        const layout=app.workspace.getLayout();
        cleanup.defer(async()=>{await app.workspace.changeLayout(layout);});
        const hoverAction=s.settings.current['citation.hover-action'];
        cleanup.defer(()=>s.settings.update({'citation.hover-action':hoverAction}));
        const pandoc=s.settings.current['citation.pandoc-citations'];
        cleanup.defer(()=>s.settings.update({'citation.pandoc-citations':pandoc}));
        const url=${JSON.stringify(url)};
        ${hoverAction === undefined ? "" : `s.settings.update({'citation.hover-action':${JSON.stringify(hoverAction)}});`}
        ${pandocOff ? "s.settings.update({'citation.pandoc-citations':false});" : ""}
        ${applyLinkSettings(linkSettings)}
        ${
          pagePreviewMod === undefined
            ? ""
            : `const pagePreview=app.internalPlugins.getEnabledPluginById('page-preview')?.options;
        if(!pagePreview)throw new Error('The Page preview core plugin is off');
        const rowSet=Object.hasOwn(pagePreview,'zotlit-citekey'),row=pagePreview['zotlit-citekey'];
        cleanup.defer(()=>{if(rowSet)pagePreview['zotlit-citekey']=row;else delete pagePreview['zotlit-citekey'];});
        pagePreview['zotlit-citekey']=${pagePreviewMod};`
        }
        ${showNote(JSON.stringify(note), gesture)}
        ${applyLinkSettings(afterOpen)}
        ${linkTarget(gesture)}
        cleanup.defer(()=>view.hoverPopover?.hide());
        link.dispatchEvent(new MouseEvent('mouseover',{clientX:x,clientY:y,bubbles:true,metaKey:${mod},ctrlKey:${mod},view:link.ownerDocument.defaultView}));
        const opened=(view)=>view.hoverPopover?.hoverEl.isConnected?view.hoverPopover:null;
        if(${absent}){
          // Absence is read off a control: a link that shows a popover,
          // hovered later in a split under the Citation Popover. Every hover
          // popover waits the same opening delay, so once the control's has
          // opened, one the first hover had started would have opened too.
          // Annotation links go back on before that delay ends, which holds
          // only because both hover gates act at the mouseover itself, never
          // as the delay ends.
          s.settings.update({'citation.hover-action':'popover','citation.annotation-links':true});
          const control=app.workspace.getLeaf('split','vertical');
          cleanup.adopt(control,(leaf)=>leaf.detach());
          await control.setViewState({type:'markdown',state:{file:file.path,mode:'preview'}});
          cleanup.defer(()=>control.view.hoverPopover?.hide());
          const controlLink=await until(()=>[...control.view.previewMode.containerEl.querySelectorAll('a.external-link')].find((a)=>a.getAttribute('href')===${JSON.stringify(CONTROL_URL)}),()=>'The control link did not render');
          controlLink.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,view:controlLink.ownerDocument.defaultView}));
          await until(()=>opened(control.view),()=>'The control hover opened no popover');
          outcome={popover:!!opened(view)||link.ownerDocument.querySelectorAll('.hover-popover').length!==1,text:null,color:null,image:false,sup:null};
          if(${restore}){
            // The control step turned annotation links on again; the view
            // that showed nothing now answers the same link, found afresh
            // since Live Preview may draw it anew as the editor reconfigures.
            control.view.hoverPopover?.hide();
            ${linkTarget(gesture)}
            link.dispatchEvent(new MouseEvent('mouseover',{clientX:x,clientY:y,bubbles:true,metaKey:${mod},ctrlKey:${mod},view:link.ownerDocument.defaultView}));
            const again=await until(()=>opened(view),()=>'The same link opened no popover once annotation links were on again');
            outcome.restored=await until(()=>again.hoverEl.querySelector('.zt-citation-popover-content')?.textContent,()=>'The restored popover never filled');
          }
        }else{
          const popover=await until(()=>opened(view),()=>'No popover opened over the link');
          const content=()=>popover.hoverEl.isConnected?popover.hoverEl.querySelector('.zt-citation-popover-content'):null;
          await until(()=>content()?.textContent,()=>'The popover never filled: '+(popover.hoverEl.outerHTML.slice(0,300)));
          const painted=()=>[...content().querySelectorAll('img')].find((img)=>img.src.startsWith('blob:')&&img.complete&&img.naturalWidth>0);
          if(${image})await until(painted,()=>'The popover painted no Excerpt Image: '+content().outerHTML.slice(0,300));
          const colored=content().querySelector('[style*="--zt-annot-color"]');
          outcome={popover:true,text:content().textContent,color:colored?colored.style.getPropertyValue('--zt-annot-color'):null,image:!!painted(),sup:content().querySelector('sup')?.textContent??null};
        }
      }
      return JSON.stringify(outcome);
    })()`,
    90000,
  );
  return JSON.parse(reply) as HoverOutcome;
}

describe.skipIf(!reachable)("Annotation links", () => {
  registerEndToEndRunHooks();

  // The system handler would hand a passed link to the real Zotero on this
  // computer. ZotLit patches `window.open` once, as it loads, so it is
  // reloaded over a recorder that keeps every `zotero:` URL instead. A
  // `zotero:` anchor in the Annotation View would navigate on its own, past
  // `window.open`: a capture-phase listener stops that navigation and records
  // nothing, so a chip that skips `window.open` fails its case in silence.
  //
  // Capture warms the Attachment index as it installs, so it answers before
  // any PDF is open; a lookup that still answered `pending` would hand every
  // click to Zotero. `indexed` only waits — a lookup would start the build
  // itself and hide a missing warm-up.
  beforeAll(async () => {
    expect(
      await obEval(
        run.vaultId,
        `(async()=>{await app.plugins.disablePlugin('zotlit');const s=window.__ztLinks={native:window.open,passed:[],stopAnchor:(e)=>{const a=e.target?.closest?.('a[href^="zotero:"]');if(a?.closest('.workspace-leaf-content[data-type="zotero-annotation-view"]'))e.preventDefault();}};window.addEventListener('click',s.stopAnchor,true);window.open=function(url,target,features){if(String(url).startsWith('zotero:')){s.passed.push({url:String(url),target:target??null});return null;}return s.native.apply(this,arguments);};await app.plugins.enablePlugin('zotlit');const timeout=new Promise((resolve)=>setTimeout(()=>resolve('not indexed'),20000));return await Promise.race([app.plugins.plugins.zotlit.services.attachmentResolver.indexed.then(()=>'indexed'),timeout]);})()`,
        60000,
      ),
      "the Attachment index is built with no lookup asking for it",
    ).toBe("indexed");
  }, 120000);

  afterAll(async () => {
    await obEval(
      run.vaultId,
      `(async()=>{const s=window.__ztLinks;if(!s)return true;await app.plugins.disablePlugin('zotlit');window.removeEventListener('click',s.stopAnchor,true);window.open=s.native;delete window.__ztLinks;await app.plugins.enablePlugin('zotlit');return true;})()`,
    );
  }, 120000);

  it("opens the reader on the Annotation a link names, clicked in Live Preview", async () => {
    const url = durableLink(SECOND_PAGE.key, SECOND_PAGE.pageLabel);
    const lands = { page: 2, selected: [SECOND_PAGE.key] };

    const outcome = await follow({
      note: noteWith(url),
      url,
      gesture: "live-preview",
      lands,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  it("opens the reader on the Annotation a link names, clicked in Reading view", async () => {
    const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);
    const lands = { page: 1, selected: [FIRST_PAGE.key] };

    const outcome = await follow({
      note: noteWith(url),
      url,
      gesture: "reading",
      lands,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  it("opens the reader on the Annotation a link names, clicked in a Properties value", async () => {
    const url = durableLink(ALSO_FIRST_PAGE.key, ALSO_FIRST_PAGE.pageLabel);
    const lands = { page: 1, selected: [ALSO_FIRST_PAGE.key] };

    const outcome = await follow({
      note: noteWith(
        durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        `---\nsource: "${url}"\n---\n`,
      ),
      url,
      gesture: "properties",
      lands,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  // An Annotation Zotero no longer has still names its Attachment and page,
  // so the click reaches the neighbourhood of the passage, in silence.
  it("lands on the page alone for an Annotation Zotero no longer has", async () => {
    const url = durableLink("ZZZZZZZ2", SECOND_PAGE.pageLabel);
    const lands = { page: 2, selected: [] };

    const outcome = await follow({
      note: noteWith(url),
      url,
      gesture: "reading",
      lands,
    });

    // `drawn` says the read the Landing was decided against reached the page.
    expect(outcome).toEqual({
      drawn: true,
      reader: lands,
      passed: [],
      notices: [],
    });
  }, 120000);

  // What ZotLit writes is the durable link itself: the inserted passage
  // carries it, not this computer's file path, and following it lands.
  it("inserts an Annotation with its durable link, which lands when clicked", async () => {
    const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);
    const lands = { page: 1, selected: [FIRST_PAGE.key] };

    const inserted = await insertFromCard(FIRST_PAGE.key);

    expect(inserted).toContain(`Page [${FIRST_PAGE.pageLabel}](${url})`);
    expect(inserted).toContain(`${FIRST_PAGE.text} ${citationOf(FIRST_PAGE)}`);
    expect(inserted).not.toContain("file://");
    expect(inserted).not.toContain("zt-annotation=");

    const outcome = await follow({
      note: inserted,
      url,
      gesture: "reading",
      lands,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  // The Annotation Suggester searches the Zotero database with Zotero closed:
  // the trigger, a word of the quote, and a narrowing token in the Library
  // View's grammar find the passage; choosing it writes the quote through
  // the annotation template, durable link and all, in place of the search.
  it("searches annotations from the cursor and inserts the chosen one", async () => {
    const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);

    const outcome = await searchAndInsert(
      "[>MESSAGE tag:visualization color:blue",
      FIRST_PAGE.text!,
    );

    expect(outcome.citationOpen).toBe(false);
    // A row names the passage, its page as the Annotation View does, and
    // the paper.
    expect(outcome.rows).toEqual([
      expect.stringContaining(
        `${run.m.annot_view_page({ page: FIRST_PAGE.pageLabel })} · ${annotationItem.title}`,
      ),
    ]);
    expect(outcome.rows[0]).toContain(FIRST_PAGE.text!);
    expect(outcome.text).toContain(FIRST_PAGE.text!);
    expect(outcome.text).toContain(`Page [${FIRST_PAGE.pageLabel}](${url})`);
    expect(outcome.text).toContain(
      `${FIRST_PAGE.text} ${citationOf(FIRST_PAGE)}`,
    );
    expect(outcome.text).not.toContain("[>");
    expect(outcome.use).toBe("cited");
  }, 120000);

  // A note Annotation quotes nothing: its row shows its comment.
  it("finds an Annotation by its comment, and its row shows the comment", async () => {
    const outcome = await searchAndInsert("[>figures hard", COMMENTED.comment!);

    expect(outcome.rows).toEqual([expect.stringContaining(COMMENTED.comment!)]);
  }, 120000);

  // Zotero stores an Annotation's text as its own HTML subset: both the
  // popover and the Annotation Suggester's row draw it, never show it.
  it("draws an Annotation's rich text in its popover and its suggestion row", async () => {
    const text = `${RICH.text} E = mc<sup>2</sup>`;
    await using cleanup = new AsyncDisposableStack();
    // Disposed in reverse: the Fixture's text is written back, then read.
    cleanup.defer(() => reread(RICH.key, RICH.text!));
    cleanup.use(rewriteAnnotationText(e2eFixture.databasePath, RICH.key, text));
    await reread(RICH.key, text);

    const hovered = await hover({
      url: durableLink(RICH.key, RICH.pageLabel),
      gesture: "reading",
    });
    // Chosen by the rewritten text as drawn, so a row from an index that
    // still holds the Fixture's text is never chosen.
    const searched = await searchAndInsert("[>classically defined", "E = mc2");

    expect(hovered).toMatchObject({ popover: true, sup: "2" });
    expect(hovered.text).not.toContain("<sup>");
    expect(searched.sup).toBe("2");
    expect(searched.rows.join("")).not.toContain("<sup>");
  }, 180000);

  // A one-line template quotes inside a sentence; where the insert lands
  // around the words beside it is the insertion's own rule, tested with it.
  // A trigger typed straight after a word is where the researcher wanted it,
  // so the Annotation Suggester adds no space before it.
  it("places a one-line Annotation from its card right after a word, typing on", async () => {
    const text = await insertFromCard(FIRST_PAGE.key, {
      line: "As argued",
      ch: 9,
      inline: true,
      typeOn: "next",
    });

    expect(text).toBe(`# Draft\n\nAs argued ${inlineOf(FIRST_PAGE)} next`);
  }, 120000);

  it("places a one-line Annotation from the Annotation Suggester right after a word, typing on", async () => {
    const outcome = await searchAndInsert(
      "[>MESSAGE tag:visualization color:blue",
      FIRST_PAGE.text!,
      { line: "As argued", ch: 9, inline: true, typeOn: "next" },
    );

    expect(outcome.text).toBe(
      `# Draft\n\nAs argued${inlineOf(FIRST_PAGE)} next`,
    );
  }, 120000);

  // The page chip of an Annotation View card opens the Annotation its
  // backlink names the way a followed link does, so it opens Obsidian's
  // reader where this computer holds the PDF.
  it("opens the reader on the Annotation from its card's page chip", async () => {
    const url = durableLink(SECOND_PAGE.key, SECOND_PAGE.pageLabel);
    const lands = { page: 2, selected: [SECOND_PAGE.key] };

    const outcome = await follow({ note: "", url, gesture: "chip", lands });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  // The chip is ZotLit's own gesture, not a note's file link, so the setting
  // that keeps a note's links for the system handler leaves it alone.
  it("opens the reader from a card's page chip while the reader's open-file-links setting is off", async () => {
    const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);
    const lands = { page: 1, selected: [FIRST_PAGE.key] };

    const outcome = await follow({
      note: "",
      url,
      gesture: "chip",
      captureOff: true,
      lands,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  // Two Attachments can keep one file, and its path names only one of them.
  // A link to the other one opens Obsidian's reader all the same, bound to
  // that Attachment and selecting its own Annotation, rather than going to
  // Zotero.
  it("opens the reader on the Annotation of the second Attachment of a shared PDF", async () => {
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await reindexed("unresolved");
    });
    cleanup.use(
      addSharedFileAttachment(e2eFixture.databasePath, FIRST_PAGE.key),
    );
    // The path still names the Fixture's own Attachment, so the link names
    // the one the path does not choose.
    expect(await reindexed("resolved")).toBe(annotationAttachment.key);
    const url = durableLink(SHARED.annotationKey, FIRST_PAGE.pageLabel, {
      attachmentKey: SHARED.attachmentKey,
    });
    const lands = { page: 1, selected: [SHARED.annotationKey] };

    const outcome = await follow({
      note: noteWith(url),
      url,
      gesture: "reading",
      lands,
      bound: SHARED.attachmentKey,
      reads: true,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
    // The reader held the named Attachment from its first read: the path's
    // own Attachment was never bound, nor read.
    expect(outcome.reads).toEqual([SHARED.attachmentKey]);
  }, 180000);

  // A tab ZotLit found open records no open of its own, but an open that
  // names the file's other Attachment in it is the researcher's own: the
  // tab's read of the path's Attachment ends, and a read of the named one
  // begins. Two tabs on the one file are then two Attachments, and the
  // Annotation View beside each shows that tab's own.
  it("rebinds a tab ZotLit found open to the other Attachment an open names, and the Annotation View follows each of two tabs on the shared PDF", async () => {
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await reindexed("unresolved");
    });
    cleanup.use(
      addSharedFileAttachment(e2eFixture.databasePath, FIRST_PAGE.key),
    );
    expect(await reindexed("resolved")).toBe(annotationAttachment.key);

    const outcome = await sharedTabs();

    // The tab's read of the path's Attachment ends first; the last read
    // recorded is of the Attachment the open named.
    expect(outcome.reads.at(0)).toBe(annotationAttachment.key);
    expect(outcome.reads.at(-1)).toBe(SHARED.attachmentKey);
    expect(outcome).toMatchObject({
      restored: SHARED.attachmentKey,
      besideRestored: [SHARED.annotationKey],
      besideSecond: [...annotationKeys].sort(),
      passed: [],
    });
  }, 180000);

  // The regression guard: the device-local link ZotLit wrote before keeps
  // landing exactly as it did.
  it("still lands an Attachment File Link that carries an Annotation Anchor", async () => {
    const url = `${FILE_URL}#page=2&zt-annotation=${SECOND_PAGE.key}`;
    const lands = { page: 2, selected: [SECOND_PAGE.key] };

    const outcome = await follow({
      note: noteWith(url),
      url,
      gesture: "reading",
      lands,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  describe("hands the click to Zotero", () => {
    // The missing PDF is located and claimed; the reader finds no file as it
    // opens and hands the link on, with no missing-file notice of its own.
    it.each([
      ["a PDF this computer does not hold", MISSING_PDF.key, "ZZZZZZZ2"],
      ["an Attachment Zotero does not know", "ZZZZZZZ3", FIRST_PAGE.key],
    ])(
      "for %s",
      async (_, attachmentKey, annotationKey) => {
        const url = durableLink(annotationKey, "1", { attachmentKey });

        const outcome = await follow({
          note: noteWith(url),
          url,
          gesture: "reading",
        });

        expect(outcome).toEqual({
          drawn: false,
          reader: null,
          passed: [expect.objectContaining({ url })],
          notices: [],
        });
      },
      120000,
    );

    it("while the reader's open-file-links setting is off", async () => {
      const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);

      const outcome = await follow({
        note: noteWith(url),
        url,
        gesture: "reading",
        captureOff: true,
      });

      expect(outcome).toMatchObject({
        reader: null,
        passed: [expect.objectContaining({ url })],
      });
    }, 120000);

    it.each([
      ["while ZotLit treats no annotation links", "citation.annotation-links"],
      [
        "while annotation links are set to open in Zotero",
        "citation.open-annotation-links",
      ],
    ] as const)(
      "%s",
      async (_, key) => {
        const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);

        const outcome = await follow({
          note: noteWith(url),
          url,
          gesture: "reading",
          linkSettings: { [key]: false },
        });

        expect(outcome).toMatchObject({
          reader: null,
          passed: [expect.objectContaining({ url })],
        });
      },
      120000,
    );

    // Obsidian's own "Open in default browser" item calls `window.open` with
    // this target, which is the whole of that gesture as Capture sees it.
    it("for Obsidian's explicit external target", async () => {
      const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);

      const outcome = await follow({
        note: noteWith(url),
        url,
        gesture: "external",
      });

      expect(outcome).toMatchObject({
        reader: null,
        passed: [{ url, target: "_external" }],
      });
    }, 120000);
  });

  describe("shows the Annotation a hovered link names", () => {
    it.each(["live-preview", "reading"] as const)(
      "with its text, page label and colour in %s",
      async (gesture) => {
        const outcome = await hover({
          url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
          gesture,
        });

        expect(outcome).toMatchObject({
          popover: true,
          color: FIRST_PAGE.color,
          image: false,
        });
        expect(outcome.text).toContain(FIRST_PAGE.text);
        expect(outcome.text).toContain(
          run.m.annot_view_page({ page: FIRST_PAGE.pageLabel }),
        );
      },
      120000,
    );

    it("with its comment", async () => {
      const outcome = await hover({
        url: durableLink(COMMENTED.key, COMMENTED.pageLabel),
        gesture: "reading",
      });

      expect(outcome.text).toContain(COMMENTED.comment);
    }, 120000);

    // Rendered from the PDF by ZotLit with no reader open: the scenario opens
    // the note alone.
    it.each([
      ["an image", "live-preview", SECOND_PAGE],
      ["an ink", "reading", INK],
    ] as const)(
      "with the Excerpt Image of %s Annotation",
      async (_, gesture, annotation) => {
        const outcome = await hover({
          url: durableLink(annotation.key, annotation.pageLabel),
          gesture,
          image: true,
        });

        expect(outcome).toMatchObject({ popover: true, image: true });
      },
      120000,
    );

    // Page Preview gates the hover as it gates a citation's preview: ZotLit's
    // row in Obsidian's Page preview settings asks for Mod by default.
    it("as the popover under Page Preview, with Mod held", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "reading",
        hoverAction: "page-preview",
        mod: true,
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
    }, 120000);

    it("with nothing under Page Preview while Mod is not held", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "reading",
        hoverAction: "page-preview",
        absent: true,
      });

      expect(outcome.popover).toBe(false);
    }, 120000);

    // ZotLit's row in Obsidian's Page preview settings, once the researcher
    // turns its Mod off, lets the hover through without it.
    it("under Page Preview without Mod once ZotLit's Page preview row asks for none", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "live-preview",
        hoverAction: "page-preview",
        pagePreviewMod: false,
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
    }, 120000);

    // Source mode shows the link's Markdown, where a hover is editing more
    // often than reading: as for Obsidian's own links, it waits for Mod.
    it("in Source mode with Mod held", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "source",
        mod: true,
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
    }, 120000);

    it("with nothing in Source mode while Mod is not held", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "source",
        absent: true,
      });

      expect(outcome.popover).toBe(false);
    }, 120000);

    // A Durable Annotation Link is no Pandoc citation: its hover stays when
    // the citation treatment is off.
    it("while Pandoc citations are off", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "live-preview",
        pandocOff: true,
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
    }, 120000);

    // Opening is a click's setting alone: the hover stays while a click goes
    // to Zotero.
    it("while annotation links are set to open in Zotero", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "live-preview",
        linkSettings: { "citation.open-annotation-links": false },
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
    }, 120000);

    // The setting changes under a note already open: the editor drops its
    // hover and takes it back without being opened again.
    it.each(["live-preview", "reading"] as const)(
      "with nothing while ZotLit treats no annotation links, and again once they are back, in %s",
      async (gesture) => {
        const outcome = await hover({
          url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
          gesture,
          afterOpen: { "citation.annotation-links": false },
          restore: true,
          absent: true,
        });

        expect(outcome.popover).toBe(false);
        expect(outcome.restored).toContain(FIRST_PAGE.text);
      },
      120000,
    );

    it("with nothing for a Zotero link that names no Annotation", async () => {
      const outcome = await hover({
        url: `zotero://select/library/items/${annotationAttachment.key}`,
        gesture: "reading",
        absent: true,
      });

      expect(outcome.popover).toBe(false);
    }, 120000);

    // Zotero answers no list for an Attachment it does not know, and an
    // Attachment's list without the Annotation: both say the link is stale.
    it.each([
      ["an Annotation Zotero no longer has", durableLink("ZZZZZZZ2", "1")],
      [
        "an Attachment Zotero does not know",
        durableLink(FIRST_PAGE.key, "1", { attachmentKey: "ZZZZZZZ3" }),
      ],
    ])(
      "as unavailable for %s",
      async (_, url) => {
        const outcome = await hover({ url, gesture: "live-preview" });

        expect(outcome).toMatchObject({
          popover: true,
          text: run.m.annotation_popover_unavailable(),
        });
      },
      120000,
    );

    it.each(["live-preview", "reading"] as const)(
      "with nothing while the Hover Action is off, in %s",
      async (gesture) => {
        const outcome = await hover({
          url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
          gesture,
          hoverAction: "off",
        });

        expect(outcome.popover).toBe(false);
      },
      120000,
    );
  });
});
