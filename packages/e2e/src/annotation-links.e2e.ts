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
}

/** The rendered link to `url` in the markdown view `view`, as eval code. */
const LINK_IN = {
  reading: `[...view.previewMode.containerEl.querySelectorAll('a.external-link')].find((a)=>a.getAttribute('href')===url)`,
  properties: `[...(view.metadataEditor?.containerEl.querySelectorAll('.metadata-link-inner.external-link')??[])].find((link)=>link.dataset.href===url)`,
  "live-preview": `[...view.editor.cm.contentDOM.querySelectorAll('.cm-link .cm-underline')].find((el)=>el.textContent===${JSON.stringify(LINK_TEXT)})`,
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
    gesture === "reading" ? "{mode:'preview'}" : "{mode:'source',source:false}";
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
 * {@link INLINE_ANNOTATION}; `then` is typed once the insert lands.
 */
interface InsertAt {
  line?: string;
  ch?: number;
  inline?: boolean;
  then?: string;
}

/** Eval code that types `then` at the cursor of `editor`, when given. */
const typeAfter = (then: string | undefined) =>
  then === undefined
    ? ""
    : `editor.cm.dispatch(editor.cm.state.replaceSelection(${JSON.stringify(then)}),{userEvent:'input.type'});`;

/**
 * Inserts the Annotation `annotationKey` of the Rougier Item into an empty
 * draft the way a reader does: its card's "More options" menu in the
 * Annotation View, then "Insert into note". Answers the draft's text once the
 * insertion lands, from a vault already restored.
 */
async function insertFromCard(
  annotationKey: string,
  { line = "", ch = 0, inline = false, then }: InsertAt = {},
): Promise<string> {
  const card = `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]`;
  const reply = await obEval(
    run.vaultId,
    `(async()=>{
      ${WAITS}
      let text;
      {
        await using cleanup=new AsyncDisposableStack();
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
        ${typeAfter(then)}
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
  /** Whether the Citation Suggester opened on the typed text. */
  citationOpen: boolean;
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
  { line = "", ch = 0, inline = false, then }: InsertAt = {},
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
        ${inline ? INLINE_PROFILE : ""}
        ${draft(line)}
        cleanup.defer(()=>annotations.close());
        app.workspace.setActiveLeaf(leaf,{focus:true});
        const editor=leaf.view.editor;
        editor.setCursor({line:editor.lastLine(),ch:${ch}});
        editor.focus();
        editor.cm.dispatch(editor.cm.state.replaceSelection(${JSON.stringify(typed)}),{userEvent:'input.type'});
        const query=${JSON.stringify(typed)}.slice(${JSON.stringify(typed)}.indexOf('[>')+2);
        const rows=()=>[...annotations.suggestEl.querySelectorAll('.suggestion-item')];
        const row=await until(()=>annotations.isOpen&&annotations.context?.query===query&&rows().find((el)=>el.textContent.includes(${JSON.stringify(choose)})),()=>'The Annotation Suggester showed no row for '+JSON.stringify(query)+': '+JSON.stringify(rows().map((el)=>el.textContent)));
        const shown=rows().map((el)=>el.textContent);
        const citationOpen=!!citations?.isOpen;
        row.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}));
        row.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        await until(()=>{const value=editor.getValue();return !value.includes('[>')&&value.includes('zotero://');},()=>'Nothing was inserted: '+JSON.stringify(editor.getValue()));
        ${typeAfter(then)}
        const text=editor.getValue();
        outcome={text,rows:shown,citationOpen};
      }
      return JSON.stringify(outcome);
    })()`,
    60000,
  );
  return JSON.parse(reply) as SearchOutcome;
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
  /** The reader state that ends the wait early, when a landing is expected. */
  lands?: ReaderState;
  /** The Attachment the reader must name for a landing; the Rougier PDF's own by default. */
  bound?: string;
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
  lands,
  bound = annotationAttachment.key,
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
        const layout=app.workspace.getLayout();
        cleanup.defer(async()=>{for(const leaf of app.workspace.getLeavesOfType('pdf'))leaf.detach();await app.workspace.changeLayout(layout);});
        const captureSetting=s.settings.current['reader.open-file-links'];
        cleanup.defer(()=>s.settings.update({'reader.open-file-links':captureSetting}));
        window.__ztLinks.passed=[];
        for(const doc of ${WINDOW_DOCUMENTS})for(const notice of doc.querySelectorAll('.notice'))notice.remove();
        const fileUrl=require('url').pathToFileURL(app.vault.adapter.getFullPath(${JSON.stringify(PDF_PATH)})).href;
        const url=${JSON.stringify(url)}.replaceAll(${JSON.stringify(FILE_URL)},fileUrl);
        if(${captureOff})s.settings.update({'reader.open-file-links':false});
        ${gesture === "chip" ? "" : showNote(`${JSON.stringify(note)}.replaceAll(${JSON.stringify(FILE_URL)},fileUrl)`, gesture === "external" ? "live-preview" : gesture)}
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
        outcome=observe();
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
}

interface HoverScenario {
  /** The link the note quotes, and the pointer hovers. */
  url: string;
  gesture: "live-preview" | "reading";
  /** The Hover Action for this scenario; the vault's own when omitted. */
  hoverAction?: "off" | "popover" | "page-preview";
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
 * hover that shows nothing is read against a later hover that does.
 */
async function hover({
  url,
  gesture,
  hoverAction,
  image = false,
  mod = false,
  absent = hoverAction === "off",
}: HoverScenario): Promise<HoverOutcome> {
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
        const url=${JSON.stringify(url)};
        ${hoverAction === undefined ? "" : `s.settings.update({'citation.hover-action':${JSON.stringify(hoverAction)}});`}
        ${showNote(JSON.stringify(noteWith(url)), gesture)}
        ${linkTarget(gesture)}
        cleanup.defer(()=>view.hoverPopover?.hide());
        link.dispatchEvent(new MouseEvent('mouseover',{clientX:x,clientY:y,bubbles:true,metaKey:${mod},ctrlKey:${mod},view:link.ownerDocument.defaultView}));
        const opened=(view)=>view.hoverPopover?.hoverEl.isConnected?view.hoverPopover:null;
        if(${absent}){
          // Absence is read off a control: the same link hovered later, in a
          // split under the Citation Popover. Every hover popover waits the
          // same opening delay, so once the control's has opened, one the
          // first hover had started would have opened too.
          s.settings.update({'citation.hover-action':'popover'});
          const control=app.workspace.getLeaf('split','vertical');
          cleanup.adopt(control,(leaf)=>leaf.detach());
          await control.setViewState({type:'markdown',state:{file:file.path,mode:'preview'}});
          cleanup.defer(()=>control.view.hoverPopover?.hide());
          const controlLink=await until(()=>[...control.view.previewMode.containerEl.querySelectorAll('a.external-link')].find((a)=>a.getAttribute('href')===url),()=>'The control link did not render');
          controlLink.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,view:controlLink.ownerDocument.defaultView}));
          await until(()=>opened(control.view),()=>'The control hover opened no popover');
          outcome={popover:!!opened(view)||link.ownerDocument.querySelectorAll('.hover-popover').length!==1,text:null,color:null,image:false};
        }else{
          const popover=await until(()=>opened(view),()=>'No popover opened over the link');
          const content=()=>popover.hoverEl.isConnected?popover.hoverEl.querySelector('.zt-citation-popover-content'):null;
          await until(()=>content()?.textContent,()=>'The popover never filled: '+(popover.hoverEl.outerHTML.slice(0,300)));
          const painted=()=>[...content().querySelectorAll('img')].find((img)=>img.src.startsWith('blob:')&&img.complete&&img.naturalWidth>0);
          if(${image})await until(painted,()=>'The popover painted no Excerpt Image: '+content().outerHTML.slice(0,300));
          const colored=content().querySelector('[style*="--zt-annot-color"]');
          outcome={popover:true,text:content().textContent,color:colored?colored.style.getPropertyValue('--zt-annot-color'):null,image:!!painted()};
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
    expect(outcome.rows).toEqual([expect.stringContaining(FIRST_PAGE.text!)]);
    expect(outcome.text).toContain(FIRST_PAGE.text!);
    expect(outcome.text).toContain(`Page [${FIRST_PAGE.pageLabel}](${url})`);
    expect(outcome.text).toContain(
      `${FIRST_PAGE.text} ${citationOf(FIRST_PAGE)}`,
    );
    expect(outcome.text).not.toContain("[>");
  }, 120000);

  // A one-line template quotes inside a sentence: the insert stands one
  // space apart from the word after it, runs straight into closing
  // punctuation, and leaves a space at a line end, where typing goes on.
  const PLACEMENTS = [
    {
      where: "before a word",
      line: "As argued here",
      ch: 10,
      then: undefined,
      expected: `As argued ${inlineOf(FIRST_PAGE)} here`,
    },
    {
      where: "before closing punctuation",
      line: "As argued .",
      ch: 10,
      then: undefined,
      expected: `As argued ${inlineOf(FIRST_PAGE)}.`,
    },
    {
      where: "at a line end, typing on after the space",
      line: "As argued ",
      ch: 10,
      then: "next",
      expected: `As argued ${inlineOf(FIRST_PAGE)} next`,
    },
  ] as const;

  it.each(PLACEMENTS)(
    "places a one-line Annotation from its card $where",
    async ({ line, ch, then, expected }) => {
      const text = await insertFromCard(FIRST_PAGE.key, {
        line,
        ch,
        inline: true,
        then,
      });

      expect(text).toBe(`# Draft\n\n${expected}`);
    },
    120000,
  );

  it.each(PLACEMENTS)(
    "places a one-line Annotation from the Annotation Suggester $where",
    async ({ line, ch, then, expected }) => {
      const outcome = await searchAndInsert(
        "[>MESSAGE tag:visualization color:blue",
        FIRST_PAGE.text!,
        { line, ch, inline: true, then },
      );

      expect(outcome.text).toBe(`# Draft\n\n${expected}`);
    },
    120000,
  );

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
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
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

    it("as unavailable for an Annotation Zotero no longer has", async () => {
      const outcome = await hover({
        url: durableLink("ZZZZZZZ2", "1"),
        gesture: "live-preview",
      });

      expect(outcome).toMatchObject({
        popover: true,
        text: run.m.annotation_popover_unavailable(),
      });
    }, 120000);

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
