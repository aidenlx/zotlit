// Annotation links in a note: a Durable Annotation Link clicked in any
// Obsidian surface lands on its Annotation in Obsidian's reader, or reaches
// Zotero when this computer cannot open the PDF. Later scenarios of the same
// spec (hover, the annotation suggester) join this file.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ATTACHMENTS } from "@zotlit/scripts/fixture";

import {
  annotationAttachment,
  attachmentAnnotations,
  reachable,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import {
  clearNotices,
  obEval,
  obEvalUntil,
  obJson,
  WINDOW_DOCUMENTS,
} from "./obsidian-cli.ts";

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

/** The link Zotero writes into a child note for one Annotation. */
function durableLink(
  annotationKey: string,
  pageLabel: string,
  attachmentKey = annotationAttachment.key,
): string {
  return `zotero://open/library/items/${attachmentKey}?annotation=${annotationKey}&page=${pageLabel}`;
}

/** Every `zotero:` URL the system handler was asked to open. */
interface Passed {
  url: string;
  target: string | null;
}

/** What the Rougier PDF shows: its page, and the Marks it selects. */
const READER = `(function(){const view=app.workspace.getLeavesOfType('pdf').map(({view})=>view).find((view)=>view.file?.path===${JSON.stringify(PDF_PATH)});if(!view)return JSON.stringify(null);const selected=[...new Set([...view.containerEl.querySelectorAll('.zt-pdf-annotation-mark.is-selected')].map((mark)=>mark.dataset.zoteroAnnotationKey))];return JSON.stringify({page:view.viewer.child?.pdfViewer?.pdfViewer?.currentPageNumber??null,selected});})()`;

const reader = () =>
  obJson<{ page: number | null; selected: string[] } | null>(
    run.vaultId,
    READER,
  );

const passed = () =>
  obJson<Passed[]>(run.vaultId, "JSON.stringify(window.__ztLinks.passed)");

const poll = { timeout: 20000, interval: 250 };

/**
 * A press, release, and click near the start of the first line box of
 * `target`, once it has rendered. Live Preview finds the link under the
 * pointer from the event's coordinates, so they name a point the link covers:
 * a wrapped link has none at the middle of its bounding box, and a long
 * Properties value runs on under the sidebar. The End-to-end Run's window stays
 * behind other apps, where Chromium delivers no trusted input.
 */
async function click(target: string): Promise<void> {
  expect(
    await obEvalUntil(run.vaultId, `String(!!(${target}))`, {
      expected: "true",
    }),
    "the link renders",
  ).toBe(true);
  expect(
    await obEval(
      run.vaultId,
      `(function(){const target=${target};target.scrollIntoView({block:"center",inline:"nearest",behavior:"instant"});const box=target.getClientRects()[0];const x=box.left+Math.min(box.width/2,12),y=box.top+box.height/2;const hit=target.ownerDocument.elementFromPoint(x,y);if(!hit||!(hit===target||target.contains(hit)))return 'covered by '+(hit?hit.outerHTML.slice(0,300)+' in '+hit.parentElement?.className+' box '+JSON.stringify(box)+' visible '+target.checkVisibility():'nothing');const init={clientX:x,clientY:y,bubbles:true,cancelable:true,button:0,view:target.ownerDocument.defaultView};target.dispatchEvent(new MouseEvent('mousedown',{...init,buttons:1}));target.dispatchEvent(new MouseEvent('mouseup',init));target.dispatchEvent(new MouseEvent('click',init));return 'clicked';})()`,
    ),
  ).toBe("clicked");
}

/** The query key the Attachment Resolver holds its path index under. */
const PATH_INDEX_KEY = ["attachment-resolver", "path-index"];

/**
 * Registers, before the case changes anything, the restore of everything it
 * may change: the workspace layout (the note's tab, the PDF tab a click opens,
 * and the Annotation View the reader reveals beside it), the note itself, and
 * the open-file-links setting.
 */
async function scope(cleanup: AsyncDisposableStack): Promise<void> {
  const saved = await obEval(
    run.vaultId,
    "JSON.stringify({layout:app.workspace.getLayout(),openFileLinks:app.plugins.plugins.zotlit.services.settings.current['reader.open-file-links']})",
  );
  cleanup.defer(async () => {
    await obEval(
      run.vaultId,
      `(async()=>{const saved=JSON.parse(${JSON.stringify(saved)});for(const leaf of app.workspace.getLeavesOfType('pdf'))leaf.detach();await app.workspace.changeLayout(saved.layout);return true;})()`,
    );
  });
  cleanup.defer(async () => {
    await obEval(
      run.vaultId,
      `(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(NOTE)});if(file)await app.vault.delete(file);return true;})()`,
    );
  });
  cleanup.defer(async () => {
    await obEval(
      run.vaultId,
      `(app.plugins.plugins.zotlit.services.settings.update({'reader.open-file-links':JSON.parse(${JSON.stringify(saved)}).openFileLinks}),true)`,
    );
  });
}

/** The text of every notice on screen, in every window of the vault. */
const notices = () =>
  obJson<string[]>(
    run.vaultId,
    `JSON.stringify(${WINDOW_DOCUMENTS}.flatMap((doc)=>[...doc.querySelectorAll('.notice')].map((n)=>n.textContent)))`,
  );

/**
 * Writes the note and shows it in one tab, in Live Preview or Reading view,
 * with no PDF open anywhere and the cursor on the empty last line, away
 * from every link and from the Properties.
 */
async function showNote(
  content: string,
  mode: "live-preview" | "reading",
): Promise<void> {
  const state =
    mode === "reading" ? "{mode:'preview'}" : "{mode:'source',source:false}";
  expect(
    await obEval(
      run.vaultId,
      `(async()=>{for(const leaf of app.workspace.getLeavesOfType('pdf'))leaf.detach();const content=${JSON.stringify(content)};const existing=app.vault.getFileByPath(${JSON.stringify(NOTE)});const file=existing??await app.vault.create(${JSON.stringify(NOTE)},content);if(existing)await app.vault.modify(file,content);const leaf=app.workspace.getLeavesOfType('markdown').find((leaf)=>leaf.view.file?.path===file.path)??app.workspace.getLeaf('tab');await leaf.setViewState({type:'markdown',state:{file:file.path,...${state}},active:true});app.workspace.setActiveLeaf(leaf,{focus:true});if(${mode === "live-preview"}){leaf.view.editor.setCursor({line:leaf.view.editor.lastLine(),ch:0});}return 'shown';})()`,
    ),
  ).toBe("shown");
}

/** The rendered link to `url` in the note's view, as an eval expression. */
function linkIn(
  surface: "live-preview" | "reading" | "properties",
  url: string,
): string {
  const view = `app.workspace.getLeavesOfType('markdown').find((leaf)=>leaf.view.file?.path===${JSON.stringify(NOTE)})?.view`;
  switch (surface) {
    case "reading":
      return `[...(${view}?.previewMode.containerEl.querySelectorAll('a.external-link')??[])].find((a)=>a.getAttribute('href')===${JSON.stringify(url)})`;
    case "properties":
      return `[...(${view}?.metadataEditor?.containerEl.querySelectorAll('.metadata-link-inner.external-link')??[])].find((link)=>link.dataset.href===${JSON.stringify(url)})`;
    case "live-preview":
      return `[...(${view}?.editor.cm.contentDOM.querySelectorAll('.cm-link .cm-underline')??[])].find((el)=>el.textContent===${JSON.stringify(LINK_TEXT)})`;
  }
}

const LINK_TEXT = "the quoted passage";

/** A note quoting one passage, ending on an empty line that holds no link. */
function noteWith(url: string, properties = ""): string {
  return `${properties}# Draft\n\nAs Rougier argues, [${LINK_TEXT}](${url}).\n`;
}

describe.skipIf(!reachable)("Annotation links", () => {
  registerEndToEndRunHooks();

  // The system handler would hand a passed link to the real Zotero on this
  // computer. ZotLit patches `window.open` once, as it loads, so it is
  // reloaded over a recorder that keeps every `zotero:` URL instead.
  beforeAll(async () => {
    expect(
      await obEval(
        run.vaultId,
        `(async()=>{await app.plugins.disablePlugin('zotlit');const s=window.__ztLinks={native:window.open,passed:[]};window.open=function(url,target,features){if(String(url).startsWith('zotero:')){s.passed.push({url:String(url),target:target??null});return null;}return s.native.apply(this,arguments);};await app.plugins.enablePlugin('zotlit');await app.plugins.plugins.zotlit.services.attachmentResolver.ready;return 'recording';})()`,
      ),
    ).toBe("recording");
    // Capture warms the Attachment index as it installs, so it answers before
    // any PDF is open; a lookup that still answered `pending` would hand every
    // click to Zotero. The wait reads the held index without asking for it —
    // a lookup would start the build itself and hide a missing warm-up.
    expect(
      await obEvalUntil(
        run.vaultId,
        `String(app.plugins.plugins.zotlit.services.queryClient.peek(${JSON.stringify(PATH_INDEX_KEY)})!==null)`,
        { expected: "true" },
      ),
      "the Attachment index is built with no lookup asking for it",
    ).toBe(true);
  }, 120000);

  afterAll(async () => {
    await obEval(
      run.vaultId,
      `(async()=>{const s=window.__ztLinks;if(!s)return true;await app.plugins.disablePlugin('zotlit');window.open=s.native;delete window.__ztLinks;await app.plugins.enablePlugin('zotlit');return true;})()`,
    );
  }, 120000);

  // Observations reset per case; the vault state each case changes is
  // restored by its own scope.
  beforeEach(async () => {
    await obEval(run.vaultId, "(window.__ztLinks.passed=[],true)");
    await clearNotices(run.vaultId);
  });

  it("opens the reader on the Annotation a link names, clicked in Live Preview", async () => {
    await using cleanup = new AsyncDisposableStack();
    await scope(cleanup);
    const url = durableLink(SECOND_PAGE.key, SECOND_PAGE.pageLabel);
    await showNote(noteWith(url), "live-preview");

    await click(linkIn("live-preview", url));

    await expect
      .poll(reader, poll)
      .toEqual({ page: 2, selected: [SECOND_PAGE.key] });
    expect(await passed()).toEqual([]);
  }, 120000);

  it("opens the reader on the Annotation a link names, clicked in Reading view", async () => {
    await using cleanup = new AsyncDisposableStack();
    await scope(cleanup);
    const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);
    await showNote(noteWith(url), "reading");

    await click(linkIn("reading", url));

    await expect
      .poll(reader, poll)
      .toEqual({ page: 1, selected: [FIRST_PAGE.key] });
    expect(await passed()).toEqual([]);
  }, 120000);

  it("opens the reader on the Annotation a link names, clicked in a Properties value", async () => {
    await using cleanup = new AsyncDisposableStack();
    await scope(cleanup);
    const url = durableLink(ALSO_FIRST_PAGE.key, ALSO_FIRST_PAGE.pageLabel);
    await showNote(
      noteWith(
        durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        `---\nsource: "${url}"\n---\n`,
      ),
      "live-preview",
    );

    await click(linkIn("properties", url));

    await expect
      .poll(reader, poll)
      .toEqual({ page: 1, selected: [ALSO_FIRST_PAGE.key] });
    expect(await passed()).toEqual([]);
  }, 120000);

  // An Annotation Zotero no longer has still names its Attachment and page,
  // so the click reaches the neighbourhood of the passage, in silence.
  it("lands on the page alone for an Annotation Zotero no longer has", async () => {
    await using cleanup = new AsyncDisposableStack();
    await scope(cleanup);
    const url = durableLink("ZZZZZZZ2", SECOND_PAGE.pageLabel);
    await showNote(noteWith(url), "reading");

    await click(linkIn("reading", url));

    await expect.poll(reader, poll).toEqual({ page: 2, selected: [] });
    expect(await notices()).toEqual([]);
  }, 120000);

  // The regression guard: the device-local link ZotLit wrote before keeps
  // landing exactly as it did.
  it("still lands an Attachment File Link that carries an Annotation Anchor", async () => {
    await using cleanup = new AsyncDisposableStack();
    await scope(cleanup);
    const fileUrl = await obEval(
      run.vaultId,
      `require('url').pathToFileURL(app.vault.adapter.getFullPath(${JSON.stringify(PDF_PATH)})).href+'#page=2&zt-annotation=${SECOND_PAGE.key}'`,
    );
    await showNote(noteWith(fileUrl), "reading");

    await click(linkIn("reading", fileUrl));

    await expect
      .poll(reader, poll)
      .toEqual({ page: 2, selected: [SECOND_PAGE.key] });
  }, 120000);

  describe("hands the click to Zotero", () => {
    it("for a PDF this computer does not hold, and an Attachment Zotero does not know", async () => {
      await using cleanup = new AsyncDisposableStack();
      await scope(cleanup);
      // The missing PDF is located and claimed; the reader finds no file as it
      // opens and hands the link on, with no missing-file notice of its own.
      for (const url of [
        durableLink("ZZZZZZZ2", "1", MISSING_PDF.key),
        durableLink(FIRST_PAGE.key, "1", "ZZZZZZZ3"),
      ]) {
        await showNote(noteWith(url), "reading");
        await click(linkIn("reading", url));
        await expect
          .poll(passed, poll)
          .toEqual([expect.objectContaining({ url })]);
        expect(await reader()).toBeNull();
        expect(await notices()).toEqual([]);
        await obEval(run.vaultId, "(window.__ztLinks.passed=[],true)");
      }
    }, 120000);

    it("while the reader's open-file-links setting is off", async () => {
      await using cleanup = new AsyncDisposableStack();
      await scope(cleanup);
      const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);
      await obEval(
        run.vaultId,
        "(app.plugins.plugins.zotlit.services.settings.update({'reader.open-file-links':false}),true)",
      );
      await showNote(noteWith(url), "reading");

      await click(linkIn("reading", url));

      await expect
        .poll(passed, poll)
        .toEqual([expect.objectContaining({ url })]);
      expect(await reader()).toBeNull();
    }, 120000);

    // Obsidian's own "Open in default browser" item calls `window.open` with
    // this target, which is the whole of that gesture as Capture sees it.
    it("for Obsidian's explicit external target", async () => {
      await using cleanup = new AsyncDisposableStack();
      await scope(cleanup);
      const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);
      await showNote(noteWith(url), "reading");

      await obEval(
        run.vaultId,
        `(window.open(${JSON.stringify(url)},'_external'),true)`,
      );

      expect(await passed()).toEqual([{ url, target: "_external" }]);
      expect(await reader()).toBeNull();
    }, 120000);
  });
});
