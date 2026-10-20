// Annotation links in a note: a Durable Annotation Link clicked in any
// Obsidian surface lands on its Annotation in Obsidian's reader, or reaches
// Zotero when this computer cannot open the PDF. Later scenarios of the same
// spec (hover, the annotation suggester) join this file.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ATTACHMENTS } from "@zotlit/scripts/fixture";

import {
  annotationAttachment,
  attachmentAnnotations,
  reachable,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { obEval, WINDOW_DOCUMENTS } from "./obsidian-cli.ts";

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
/** A PDF the Fixture's Zotero holds a row for, and never a file. */
const MISSING_PDF = ATTACHMENTS.find(({ key }) => key === "MISSNG22")!;

/** Stands in a note for the Rougier PDF's own `file://` URL on this computer. */
const FILE_URL = "%FILE_URL%";

/** The link Zotero writes into a child note for one Annotation. */
function durableLink(
  annotationKey: string,
  pageLabel: string,
  attachmentKey = annotationAttachment.key,
): string {
  return `zotero://open/library/items/${attachmentKey}?annotation=${annotationKey}&page=${pageLabel}`;
}

const LINK_TEXT = "the quoted passage";

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

interface Scenario {
  /** The note's Markdown; {@link FILE_URL} becomes the PDF's own `file://` URL. */
  note: string;
  /** The link the gesture follows; {@link FILE_URL} is replaced as in `note`. */
  url: string;
  /** Where the link is clicked, or `external` for Obsidian's open-in-default-app target. */
  gesture: keyof typeof LINK_IN | "external";
  /** Turn `reader.open-file-links` off for this scenario. */
  captureOff?: boolean;
  /** The reader state that ends the wait early, when a landing is expected. */
  lands?: ReaderState;
}

/**
 * One scenario in one evaluation: write the note, show it, follow its link,
 * wait for the reader to land or the link to pass, and read the outcome. Every
 * change is undone on the evaluation's own stack, registered before the step
 * that can fail, so the outcome comes back from a vault already restored.
 *
 * The click is synthetic: the End-to-end Run's window stays behind other apps,
 * where Chromium delivers no trusted input. Live Preview finds the link under
 * the pointer from the event's coordinates, so they name a point near the
 * start of the link's first line box: a wrapped link has none at the middle of
 * its bounding box, and a long Properties value runs on under the sidebar.
 */
async function follow({
  note,
  url,
  gesture,
  captureOff = false,
  lands,
}: Scenario): Promise<Outcome> {
  const state =
    gesture === "reading" ? "{mode:'preview'}" : "{mode:'source',source:false}";
  const follow =
    gesture === "external"
      ? `window.open(url,'_external');`
      : `let link=null;for(let i=0;i<100&&!(link=(${LINK_IN[gesture]}));i++)await sleep(100);
        if(!link)throw new Error('The link did not render in ${gesture}');
        link.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
        const box=link.getClientRects()[0];const x=box.left+Math.min(box.width/2,12),y=box.top+box.height/2;
        const hit=link.ownerDocument.elementFromPoint(x,y);
        if(!hit||!(hit===link||link.contains(hit)))throw new Error('The link is covered by '+(hit?.outerHTML.slice(0,120)??'nothing'));
        const init={clientX:x,clientY:y,bubbles:true,cancelable:true,button:0,view:link.ownerDocument.defaultView};
        link.dispatchEvent(new MouseEvent('mousedown',{...init,buttons:1}));link.dispatchEvent(new MouseEvent('mouseup',init));link.dispatchEvent(new MouseEvent('click',init));`;
  const reply = await obEval(
    run.vaultId,
    `(async()=>{
      const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
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
        const file=await app.vault.create(${JSON.stringify(NOTE)},${JSON.stringify(note)}.replaceAll(${JSON.stringify(FILE_URL)},fileUrl));
        cleanup.defer(()=>app.vault.delete(file));
        if(${captureOff})s.settings.update({'reader.open-file-links':false});
        const leaf=app.workspace.getLeaf('tab');
        cleanup.adopt(leaf,(leaf)=>leaf.detach());
        await leaf.setViewState({type:'markdown',state:{file:file.path,...${state}},active:true});
        app.workspace.setActiveLeaf(leaf,{focus:true});
        const view=leaf.view;
        if(${gesture === "live-preview" || gesture === "properties"})view.editor.setCursor({line:view.editor.lastLine(),ch:0});
        ${follow}
        const lands=${JSON.stringify(lands === undefined ? null : JSON.stringify(lands))};
        if(lands===null){
          // A passed link is recorded as the open hands it on, which is the
          // whole of the gesture's work.
          for(const end=Date.now()+15000;window.__ztLinks.passed.length===0;await sleep(100))
            if(Date.now()>end)throw new Error('No link reached the system handler');
        }else{
          // The reader's binding decides the Landing as it draws the read it
          // starts once it names the Attachment; a later read replaces the
          // promise, so the wait runs until the one awaited is the last.
          let binding=null;
          for(const end=Date.now()+15000;!(binding=s.pdfAnnotationEditor.bindings.find((b)=>b.filePath===${JSON.stringify(PDF_PATH)}&&b.attachment.kind==='resolved'));await sleep(100))
            if(Date.now()>end)throw new Error('No reader named the PDF\\'s Attachment');
          for(let read=binding.refreshed;;read=binding.refreshed){await read;if(read===binding.refreshed)break;}
          // Obsidian's own page jump and the Landing's scroll frame follow.
          for(const end=Date.now()+15000;JSON.stringify(observe().reader)!==lands&&Date.now()<end;)await sleep(100);
        }
        outcome=observe();
      }
      return JSON.stringify(outcome);
    })()`,
    60000,
  );
  return JSON.parse(reply) as Outcome;
}

describe.skipIf(!reachable)("Annotation links", () => {
  registerEndToEndRunHooks();

  // The system handler would hand a passed link to the real Zotero on this
  // computer. ZotLit patches `window.open` once, as it loads, so it is
  // reloaded over a recorder that keeps every `zotero:` URL instead.
  //
  // Capture warms the Attachment index as it installs, so it answers before
  // any PDF is open; a lookup that still answered `pending` would hand every
  // click to Zotero. `indexed` only waits — a lookup would start the build
  // itself and hide a missing warm-up.
  beforeAll(async () => {
    expect(
      await obEval(
        run.vaultId,
        `(async()=>{await app.plugins.disablePlugin('zotlit');const s=window.__ztLinks={native:window.open,passed:[]};window.open=function(url,target,features){if(String(url).startsWith('zotero:')){s.passed.push({url:String(url),target:target??null});return null;}return s.native.apply(this,arguments);};await app.plugins.enablePlugin('zotlit');const timeout=new Promise((resolve)=>setTimeout(()=>resolve('not indexed'),20000));return await Promise.race([app.plugins.plugins.zotlit.services.attachmentResolver.indexed.then(()=>'indexed'),timeout]);})()`,
        60000,
      ),
      "the Attachment index is built with no lookup asking for it",
    ).toBe("indexed");
  }, 120000);

  afterAll(async () => {
    await obEval(
      run.vaultId,
      `(async()=>{const s=window.__ztLinks;if(!s)return true;await app.plugins.disablePlugin('zotlit');window.open=s.native;delete window.__ztLinks;await app.plugins.enablePlugin('zotlit');return true;})()`,
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
        const url = durableLink(annotationKey, "1", attachmentKey);

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
});
