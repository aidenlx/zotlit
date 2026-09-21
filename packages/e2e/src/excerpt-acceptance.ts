// Real Obsidian acceptance for the excerpt behaviours this release added: a
// crop that reuses the document an open reader already holds, the note import
// that reuses what that crop produced, the fallback to detached rendering once
// the reader is gone, and the card that goes on painting its previous image
// while a saved edit's pixels are rendered and published.
//
// Every claim here is read out of the running app: the renderer's own
// diagnostics count the PDF work, the Annotation View's card is the surface
// that paints and releases an image, and the write path is the repository the
// cards themselves call.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import {
  ANNOTATIONS,
  ATTACHMENTS,
  ITEMS,
  NOTES,
} from "@zotlit/scripts/fixture";

import { obEval, obEvalUntil } from "./obsidian-cli.ts";

/** The Fixture Attachment the reader opens and every excerpt here resolves. */
const attachment = ATTACHMENTS.find(({ key }) => key === "RGRPDF24")!;
/** Its vault-relative path, the one the Fixture Vault's reader opens. */
const vaultPath = attachment.path;
/** The Item it hangs off: the Item whose literature note the import case writes. */
const item = ITEMS.find(({ itemID }) => itemID === attachment.parentItemID)!;
/** Every Fixture Annotation the Attachment carries. */
const annotations = ANNOTATIONS.filter(
  ({ parentItemID }) => parentItemID === attachment.itemID,
);
/**
 * The Annotations the note template embeds: the two types Zotero keeps an
 * excerpt cache image for, and so the ones an import resolves.
 */
const embedded = annotations.filter(({ type }) => type === 3 || type === 4);
/**
 * The one ink Annotation the colour filter isolates: an ink crop paints its
 * colour into the image, so it is the one a saved edit's pixels move, and no
 * other Fixture Annotation on this Attachment carries its colour.
 */
const target = annotations.find(
  ({ type, color }) =>
    type === 4 &&
    annotations.filter((other) => other.color === color).length === 1,
)!;
/**
 * The Fixture Note whose pasted images are the target Attachment's own
 * Annotations — the one an import resolves the target Annotation through.
 */
const noteItem = NOTES.find(
  (candidate) =>
    candidate.libraryID === attachment.libraryID &&
    candidate.note.includes(target.key),
)!;
/** The colour a saved pixel edit moves the target to. */
const editedColor = "#2ea8e5";
/** The comment a saved metadata edit leaves, and the empty string that clears it. */
const editedComment = "Saved-edit acceptance";

/** Where the reader owns the document excerpt work borrows from. */
const borrowedDocument = `app.plugins.plugins.zotlit.services.pdfAnnotationEditor.borrowDocument(app.vault.adapter.getFullPath(${JSON.stringify(vaultPath)}))`;

/**
 * One renderer diagnostics instant, without the worker evidence a snapshot
 * carries: the counters that say what PDF work a resolution did.
 */
const diagnostics = `(()=>{
  const snapshot=app.plugins.plugins.zotlit.services.excerptImage.rendererDiagnostics.snapshot();
  return {loads:snapshot.loads,phase:snapshot.phase,jobActive:snapshot.jobActive,fileOpen:snapshot.fileOpen,documentOpen:snapshot.documentOpen,renderTaskActive:snapshot.renderTaskActive};
})()`;

/**
 * Declares `requestFor`, the excerpt request one Annotation of the Fixture
 * Attachment resolves through: the repository's own record and source, the
 * Fixture Vault's paths, and the personal library the Fixture files it in.
 *
 * Declared inside the eval that uses it because the app's own request builder
 * lives behind the Annotation View, which this case only opens once its crop
 * must be attributable to one resolution.
 */
const requester = `
  const services=app.plugins.plugins.zotlit.services;
  const list=await services.annotationRepository.read(${JSON.stringify(attachment.key)});
  if(!list)throw new Error('The Fixture Attachment has no Annotations');
  const requestFor=key=>{
    const annotation=list.annotations.find(candidate=>candidate.key===key);
    if(!annotation)throw new Error('The Fixture holds no Annotation '+key);
    return {annotation,source:list.source,sourceScope:services.zoteroPref.dataDir,attachmentKey:annotation.parentKey,libraryID:${attachment.libraryID},pdfPath:app.vault.adapter.getFullPath(${JSON.stringify(vaultPath)}),zoteroPngPath:require('path').join(services.zoteroPref.dataDir,'cache','library',key+'.png')};
  };`;

/**
 * The image element the card of one Annotation paints, in any Annotation View
 * window. The card owns that element's `src`, which is the object URL it holds.
 */
function findImage(key: string): string {
  return `app.workspace.getLeavesOfType('zotero-annotation-view').map(leaf=>leaf.view.containerEl.querySelector(${JSON.stringify(
    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(key)}]`,
  )})).find(Boolean)?.querySelector('img')`;
}

/** Whether that card paints a decoded image. */
function painted(key: string): string {
  return `!!(()=>{const image=${findImage(key)};return image&&image.complete&&image.naturalWidth>0&&image.src.startsWith('blob:');})()`;
}

/**
 * The colour-filter swatch for one colour, as the FilterBar paints it: the
 * pointer target is the swatch's parent, and the colour lives in the swatch's
 * own `--zt-swatch-color` declaration.
 */
function swatch(color: string): string {
  return `Array.from(app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view.containerEl.querySelectorAll('span[style*="--zt-swatch-color"]')??[]).find(element=>element.style.getPropertyValue('--zt-swatch-color').trim().toLowerCase()===${JSON.stringify(
    color.toLowerCase(),
  )})?.parentElement`;
}

/**
 * What the reader holds for the Fixture PDF: its leaf, the drawn page the
 * target Annotation sits on, and whether excerpt work may borrow its document.
 */
const reader = `(function(){
  const leaves=app.workspace.getLeavesOfType('pdf');
  const leaf=leaves.find(candidate=>candidate.view.file?.path===${JSON.stringify(vaultPath)});
  const page=leaf?.view.containerEl.querySelector('.page[data-page-number="${target.position.pageIndex + 1}"]');
  const canvas=page?.querySelector('canvas');
  return JSON.stringify({
    leaves:leaves.length,
    page:!!page,
    canvas:!!canvas&&canvas.width>0&&canvas.height>0,
    borrowed:!!${borrowedDocument},
  });
})()`;

/** The object-URL probe: one window's creations and revocations, in order. */
const probe = `window.__zotlitExcerptUrlProbe`;

interface Loads {
  borrowed: number;
  detached: number;
  fileOpens: number;
  documentLoads: number;
}

interface RendererDiagnostics {
  loads: Loads;
  phase: string;
  jobActive: boolean;
  fileOpen: boolean;
  documentOpen: boolean;
  renderTaskActive: boolean;
}

/** What the renderer did between two diagnostics instants, per load kind. */
function loadsBetween(
  before: RendererDiagnostics,
  after: RendererDiagnostics,
): Loads {
  return {
    borrowed: after.loads.borrowed - before.loads.borrowed,
    detached: after.loads.detached - before.loads.detached,
    fileOpens: after.loads.fileOpens - before.loads.fileOpens,
    documentLoads: after.loads.documentLoads - before.loads.documentLoads,
  };
}

async function evalJson<T>(vaultId: string, code: string): Promise<T> {
  return JSON.parse(await obEval(vaultId, code)) as T;
}

/**
 * Run one cleanup step, retrying once: the Obsidian CLI child is occasionally
 * killed under load — a known flake of this suite — and a step that never ran
 * would leave the vault changed. A step that still fails warns instead of
 * masking the case's own failure.
 */
async function cleanupStep(step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch {
    try {
      await step();
    } catch (error) {
      console.warn(
        `Excerpt acceptance cleanup step failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * What the app is showing while a note import has not settled: the modals on
 * screen, the Notices it raised, and the files the import has written so far.
 */
async function importState(vaultId: string): Promise<string> {
  return obEval(
    vaultId,
    `JSON.stringify({
      settled:app.__zotlitExcerptImport?.settled??null,
      error:app.__zotlitExcerptImport?.error??null,
      modals:Array.from(document.querySelectorAll('.modal-container .modal')).map(element=>(element.textContent??'').slice(0,300)),
      notices:Array.from(document.querySelectorAll('.notice')).map(element=>(element.textContent??'').slice(0,200)),
      imported:app.vault.getFiles().map(file=>file.path).filter(path=>path.includes('zotlit')),
    })`,
  ).catch((error: unknown) => `import state unavailable: ${String(error)}`);
}

/**
 * The app's own settlement of the note import this case starts — the authority
 * every observation of it follows.
 *
 * An import writes a note and its assets, and the CLI child's deadline is not
 * that work's lifetime: a poll that expires, or a child killed under load, is an
 * observation failure rather than a signal that the in-app work stopped. The
 * cleanup steps below delete the import's completion state, close the dialogs it
 * uses, and restore the settings and the note it overwrote, so none of them may
 * start beside a write still in flight (`policies/test-timing.md`). Every path —
 * this case's own observation and each cleanup step — goes through the one wait
 * this returns, so the app is asked once however the case ends.
 */
function importSettlement(vaultId: string): () => Promise<void> {
  let asked: Promise<void> | null = null;
  return () => (asked ??= settleImport(vaultId));
}

/** Poll the import to settlement, answering the overwrite confirm when it asks. */
async function settleImport(vaultId: string): Promise<void> {
  const settled = "String(!!app.__zotlitExcerptImport?.settled)";
  if (await obEvalUntil(vaultId, settled, { expected: "true", tries: 60 }))
    return;
  // The Fixture Vault's own Imported Note makes the import ask before it
  // overwrites; this answers that confirm the way a user answers it.
  const answered = await obEval(
    vaultId,
    "(()=>{const button=document.querySelector('.modal-container .modal .modal-button-container button.mod-destructive');if(!button)return false;button.click();return true;})()",
  );
  if (answered !== "true")
    throw new Error(
      `the note import raised no confirm to answer: ${await importState(vaultId)}`,
    );
  if (await obEvalUntil(vaultId, settled, { expected: "true", tries: 240 }))
    return;
  throw new Error(
    `the note import did not settle: ${await importState(vaultId)}`,
  );
}

/** Install the object-URL probe, so a card's publication is observable. */
async function installUrlProbe(vaultId: string): Promise<void> {
  expect(
    await obEval(
      vaultId,
      `(()=>{
        if(${probe})throw new Error('The URL probe is already installed');
        const create=URL.createObjectURL.bind(URL);
        const revoke=URL.revokeObjectURL.bind(URL);
        const state={create,revoke,created:[],revoked:[]};
        URL.createObjectURL=blob=>{const url=create(blob);state.created.push(url);return url;};
        URL.revokeObjectURL=url=>{state.revoked.push(url);return revoke(url);};
        ${probe}=state;
        return true;
      })()`,
    ),
  ).toBe("true");
}

/** Take the object-URL probe away, restoring both browser APIs as they were. */
async function removeUrlProbe(vaultId: string): Promise<void> {
  await obEval(
    vaultId,
    `(()=>{const state=${probe};if(!state)return true;URL.createObjectURL=state.create;URL.revokeObjectURL=state.revoke;delete ${probe};return true;})()`,
  );
}

/** What one card holds at this instant: the URL it paints and what moved. */
function cardState(key: string): string {
  return `(()=>{const state=${probe};const image=${findImage(key)};return JSON.stringify({src:image?.src??null,decoded:!!(image&&image.complete&&image.naturalWidth>0),created:state.created.slice(),revoked:state.revoked.slice(),diagnostics:${diagnostics}});})()`;
}

/**
 * What the renderer's own Node view reports for its process, or the error that
 * reading it raised: Electron's `process.getProcessMemoryInfo()` is a Chromium
 * probe this environment answers with `null`, while `process.memoryUsage()` is
 * the renderer process's own Node measurement.
 */
type MemorySample =
  | { rss: number; heapUsed: number; heapTotal: number }
  | string;

/** The decoded pixels of one image the app holds: its size and an RGBA digest. */
interface DecodedPixels {
  width: number;
  height: number;
  pixels: string;
}

/**
 * Decode one image's bytes the way the card's own `<img>` does, and digest what
 * came out. Two images compare equal here only if they really paint the same
 * pixels at the same size: the crop offset, the drawn content and the scale all
 * move the digest, which a URL or a byte-length comparison cannot see.
 */
const decodedPixels = `(async (bytes, mimeType) => {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
  let canvas;
  try {
    canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Excerpt pixel canvas unavailable');
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    return { width: bitmap.width, height: bitmap.height, pixels: require('crypto').createHash('sha256').update(new Uint8Array(data.buffer)).digest('hex') };
  } finally {
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    bitmap.close();
  }
})`;

/** Decode what one card really paints: the `<img>` it holds, drawn and digested. */
function paintedPixels(key: string): string {
  return `(async()=>{
    const image=${findImage(key)};
    if(!image||!image.complete||image.naturalWidth===0)return JSON.stringify(null);
    const canvas=document.createElement('canvas');
    canvas.width=image.naturalWidth;
    canvas.height=image.naturalHeight;
    try{
      const context=canvas.getContext('2d');
      if(!context)throw new Error('Card pixel canvas unavailable');
      context.drawImage(image,0,0);
      const data=context.getImageData(0,0,canvas.width,canvas.height).data;
      return JSON.stringify({width:canvas.width,height:canvas.height,pixels:require('crypto').createHash('sha256').update(new Uint8Array(data.buffer)).digest('hex')});
    }finally{canvas.width=0;canvas.height=0;}
  })()`;
}

/**
 * The reader-backed excerpt path, end to end in one run: a crop that draws
 * from the open reader's own document, the note import that reuses what it
 * produced, and the fallback to detached rendering once the reader is gone.
 *
 * @see apps/obsidian/docs/adr/0054-reader-and-detached-excerpts-share-cache-publication.md
 */
export async function verifyReaderBackedExcerpts(
  vaultId: string,
): Promise<void> {
  const layout = await obEval(
    vaultId,
    "JSON.stringify(app.workspace.getLayout())",
  );
  const basePath = await obEval(vaultId, "app.vault.adapter.getBasePath()");
  // The runtime the evidence below is against, read from the app itself.
  const runtime = await evalJson<Record<string, string>>(
    vaultId,
    `(()=>{const versions=process.versions;return JSON.stringify({userAgent:navigator.userAgent,electron:versions.electron??null,chrome:versions.chrome??null,node:versions.node});})()`,
  );
  const existingFiles = new Set(
    await evalJson<string[]>(
      vaultId,
      "JSON.stringify(app.vault.getFiles().map(file=>file.path))",
    ),
  );
  await using cleanup = new AsyncDisposableStack();
  // Disposal is LIFO, so these read bottom to top: the case leaves the layout
  // it found last of all, once the view that holds the filter is gone.
  cleanup.defer(() =>
    cleanupStep(async () => {
      await obEval(
        vaultId,
        `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    }),
  );
  cleanup.defer(() =>
    cleanupStep(async () => {
      await obEval(
        vaultId,
        `(()=>{const element=${swatch(target.color)};if(element&&element.getAttribute('aria-pressed')==='true')element.click();return true;})()`,
      );
    }),
  );

  // ── A reader-backed crop ────────────────────────────────────────────────
  // The Attachment opens in the reader the Fixture Annotations live on, with
  // no Annotation View to demand anything: the one resolution measured here is
  // therefore the only PDF work the renderer can be doing.
  expect(
    await obEval(
      vaultId,
      `(async()=>{
        for(const leaf of app.workspace.getLeavesOfType('zotero-annotation-view'))leaf.detach();
        await app.plugins.plugins.zotlit.services.excerptImage.clear();
        const file=app.vault.getFileByPath(${JSON.stringify(vaultPath)});
        if(!file)throw new Error('The Fixture PDF is not in the Fixture Vault');
        const leaf=app.workspace.getLeaf('tab');
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf,{focus:true});
        return true;
      })()`,
    ),
  ).toBe("true");
  expect(
    await obEvalUntil(
      vaultId,
      `(()=>{const state=JSON.parse(${reader});return String(state.page&&state.canvas&&state.borrowed);})()`,
      { expected: "true", tries: 80 },
    ),
    `the Fixture PDF must open in the reader and lend its document: ${await obEval(vaultId, reader)}`,
  ).toBe(true);
  const held = await evalJson<{
    leaves: number;
    page: boolean;
    canvas: boolean;
    borrowed: boolean;
  }>(vaultId, reader);
  expect(held).toMatchObject({ page: true, canvas: true, borrowed: true });

  const borrowed = await evalJson<{
    before: RendererDiagnostics;
    after: RendererDiagnostics;
    outcome: { kind: string; provenance?: string; sha256?: string };
    pixels: DecodedPixels | null;
  }>(
    vaultId,
    `(async()=>{
      ${requester}
      const service=services.excerptImage;
      const request=requestFor(${JSON.stringify(target.key)});
      await service.clear();
      const before=${diagnostics};
      const outcome=await service.resolve(request);
      const after=${diagnostics};
      return JSON.stringify({
        before,
        after,
        outcome:outcome.kind==='available'?{kind:outcome.kind,provenance:outcome.provenance,sha256:require('crypto').createHash('sha256').update(outcome.bytes).digest('hex')}:{kind:outcome.kind},
        pixels:outcome.kind==='available'?await (${decodedPixels})(outcome.bytes,outcome.format.mimeType):null,
      });
    })()`,
  );
  expect(borrowed.outcome).toMatchObject({
    kind: "available",
    provenance: "rendered",
  });
  expect(borrowed.outcome.sha256).toMatch(/^[0-9a-f]{64}$/);
  // The crop the reader's document produced, decoded once: the fallback below
  // compares the detached crop's own pixels against these.
  expect(borrowed.pixels).toMatchObject({
    width: expect.any(Number),
    height: expect.any(Number),
    pixels: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
  expect(borrowed.pixels!.width).toBeGreaterThan(0);
  // The whole claim: one crop, drawn from a document this renderer never
  // opened and never loaded.
  expect(loadsBetween(borrowed.before, borrowed.after)).toEqual({
    borrowed: 1,
    detached: 0,
    fileOpens: 0,
    documentLoads: 0,
  });
  expect(borrowed.after).toMatchObject({
    phase: "idle",
    jobActive: false,
    fileOpen: false,
    documentOpen: false,
    renderTaskActive: false,
  });
  // The reader keeps its document, its page, and its own rendering of it.
  expect(await evalJson(vaultId, reader)).toEqual(held);

  // ── The note import reuses that image ───────────────────────────────────
  // The Fixture Vault already holds the Imported Note for the Fixture Note that
  // pastes the target Annotation's own image, so this import asks before it
  // overwrites — and rendering annotations as templates is what makes it
  // resolve those Annotations through the excerpt service the cards share.
  const importedNote = await evalJson<{ path: string; source: string }>(
    vaultId,
    `(async()=>{
      const services=app.plugins.plugins.zotlit.services;
      await services.noteIndex.whenIndexed();
      const file=services.noteIndex.getImportedNoteByNoteKey(${JSON.stringify(noteItem.key)})[0];
      if(!file)throw new Error('The Fixture Vault holds no Imported Note for ${noteItem.key}');
      return JSON.stringify({path:file.path,source:await app.vault.read(file)});
    })()`,
  );
  const templateBinding = await evalJson<{ enabled: boolean }>(
    vaultId,
    `(()=>{const settings=app.plugins.plugins.zotlit.services.settings;return JSON.stringify({enabled:settings.current['note.default-profile'].bindings['note.import-annotations-as-template']});})()`,
  );
  const settleImport = importSettlement(vaultId);
  // The import overwrites a note the Fixture wrote and turns a setting on, so
  // both go back the way they were found — once the import has settled, so no
  // step here writes beside it.
  cleanup.defer(() =>
    cleanupStep(async () => {
      await settleImport();
      await obEval(
        vaultId,
        `(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(importedNote.path)});if(file)await app.vault.modify(file,${JSON.stringify(importedNote.source)});return true;})()`,
      );
    }),
  );
  cleanup.defer(() =>
    cleanupStep(async () => {
      await settleImport();
      await obEval(
        vaultId,
        `(()=>{app.plugins.plugins.zotlit.services.settings.updateDefaultLiteratureNoteProfileBindings({'note.import-annotations-as-template':${templateBinding.enabled}});return true;})()`,
      );
    }),
  );

  // Every excerpt the note template embeds resolves against the open reader
  // first, so the cache stands for them when the import runs.
  const prepared = await evalJson<{
    keys: string[];
    outcomes: { key: string; kind: string; sha256: string | null }[];
  }>(
    vaultId,
    `(async()=>{
      ${requester}
      const service=services.excerptImage;
      const keys=list.annotations.filter(annotation=>annotation.type==='image'||annotation.type==='ink').map(annotation=>annotation.key);
      const outcomes=[];
      for(const key of keys){
        const outcome=await service.resolve(requestFor(key));
        outcomes.push({key,kind:outcome.kind,sha256:outcome.kind==='available'?require('crypto').createHash('sha256').update(outcome.bytes).digest('hex'):null});
      }
      return JSON.stringify({keys,outcomes});
    })()`,
  );
  expect(prepared.keys.slice().sort()).toEqual(
    embedded.map(({ key }) => key).sort(),
  );
  expect(prepared.outcomes.map(({ kind }) => kind)).toEqual(
    embedded.map(() => "available"),
  );
  expect(prepared.outcomes.find(({ key }) => key === target.key)?.sha256).toBe(
    borrowed.outcome.sha256,
  );

  // The import leaves state and, when it asks, a confirm behind; both go — and
  // both wait for the app's settlement first, so this step can never delete the
  // state the import is still publishing under.
  cleanup.defer(() =>
    cleanupStep(async () => {
      await settleImport();
      await obEval(
        vaultId,
        `(()=>{delete app.__zotlitExcerptImport;for(const button of document.querySelectorAll('.modal-container .modal .modal-close-button'))button.click();return true;})()`,
      );
    }),
  );
  // The import writes a note and its assets, which outlive the CLI's own child
  // deadline, so it runs as the app's own job and reports its own settlement,
  // completion time, and the memory its renderer process held around it.
  expect(
    await obEval(
      vaultId,
      `(async()=>{
        const services=app.plugins.plugins.zotlit.services;
        const memory=()=>{try{const value=process.memoryUsage();return {rss:value.rss,heapUsed:value.heapUsed,heapTotal:value.heapTotal};}catch(error){return String(error);}};
        services.settings.updateDefaultLiteratureNoteProfileBindings({'note.import-annotations-as-template':true});
        const state=app.__zotlitExcerptImport={settled:false,startedAt:performance.now(),settledAt:null,before:${diagnostics},memoryBefore:memory(),memoryAfter:null,after:null,result:null,error:null};
        await services.noteIndex.whenIndexed();
        void services.batchImport.runBatchImport('note',[${noteItem.itemID}]).then((result)=>{state.after=${diagnostics};state.result=result;},(error)=>{state.after=${diagnostics};state.error=error?.stack??String(error);}).finally(()=>{state.memoryAfter=memory();state.settledAt=performance.now();state.settled=true;});
        return true;
      })()`,
    ),
  ).toBe("true");
  await settleImport();
  const imported = await evalJson<{
    before: RendererDiagnostics;
    after: RendererDiagnostics;
    result: { outcome: string; write?: string };
    elapsedMs: number;
    memoryBefore: MemorySample;
    memoryAfter: MemorySample;
  }>(
    vaultId,
    `(()=>{const state=app.__zotlitExcerptImport;if(!state)throw new Error('The note import state is gone');if(state.error)throw new Error(state.error);const value={before:state.before,after:state.after,result:state.result,elapsedMs:state.settledAt-state.startedAt,memoryBefore:state.memoryBefore,memoryAfter:state.memoryAfter};delete app.__zotlitExcerptImport;return JSON.stringify(value);})()`,
  );
  expect(imported.result).toMatchObject({ outcome: "single" });
  expect(imported.elapsedMs).toBeGreaterThan(0);
  // Reuse, not a second rendering: the import draws no crop at all, opens no
  // PDF file, and loads no PDF document.
  expect(loadsBetween(imported.before, imported.after)).toEqual({
    borrowed: 0,
    detached: 0,
    fileOpens: 0,
    documentLoads: 0,
  });
  const written = (
    await evalJson<string[]>(
      vaultId,
      "JSON.stringify(app.vault.getFiles().map(file=>file.path))",
    )
  ).filter((path) => !existingFiles.has(path));
  cleanup.defer(() =>
    cleanupStep(async () => {
      await obEval(
        vaultId,
        `(async()=>{for(const path of ${JSON.stringify(written)}){const file=app.vault.getFileByPath(path);if(file)await app.vault.delete(file);}return true;})()`,
      );
    }),
  );
  // The durable asset carries the reader-backed bytes, so the image the import
  // links and the crop that preceded it are one image.
  const assets = written.filter((path) =>
    path.split("/").at(-1)!.startsWith("zotlit-excerpt-"),
  );
  const digests = await Promise.all(
    assets.map(async (path) =>
      createHash("sha256")
        .update(await readFile(join(basePath, path)))
        .digest("hex"),
    ),
  );
  const published = assets.filter(
    (_path, index) => digests[index] === borrowed.outcome.sha256,
  );
  expect(published).toHaveLength(1);
  const overwritten = await readFile(
    join(basePath, importedNote.path),
    "utf-8",
  );
  expect(overwritten).not.toBe(importedNote.source);
  expect(overwritten).toContain(published[0]!.split("/").at(-1)!);

  // ── The reader goes, the demand stays ───────────────────────────────────
  // Pinned to the Item, the card outlives the reader it was following; the
  // colour filter leaves the one card whose pixels this case can tell apart,
  // so the fallback below is one resolution and one publication.
  await obEval(
    vaultId,
    `(()=>{app.commands.executeCommandById('zotlit:open-annot-view');return true;})()`,
  );
  expect(
    await obEvalUntil(
      vaultId,
      `(async()=>{
        const leaf=app.workspace.getLeavesOfType('zotero-annotation-view')[0];
        if(!leaf)return JSON.stringify('no view');
        const state=leaf.view.snapshot;
        if(state.followMode!=='pinned'||state.pinnedItemKey!==${JSON.stringify(item.key)})
          await leaf.setViewState({type:'zotero-annotation-view',state:{followMode:'pinned',previousMode:'active-tab',pinnedItemKey:${JSON.stringify(item.key)}},active:true});
        const element=${swatch(target.color)};
        if(!element)return JSON.stringify('no swatch');
        if(element.getAttribute('aria-pressed')!=='true')element.click();
        return JSON.stringify('demanded');
      })()`,
      { expected: JSON.stringify("demanded"), tries: 80 },
    ),
    "the Annotation View must pin the Item and leave the target Annotation's card alone",
  ).toBe(true);
  expect(
    await obEvalUntil(
      vaultId,
      `(()=>{const cards=Array.from(new Set(Array.from(app.workspace.getLeavesOfType('zotero-annotation-view')[0].view.containerEl.querySelectorAll('.zt-annot-card[data-zotero-annotation-key]')).map(card=>card.getAttribute('data-zotero-annotation-key'))));return JSON.stringify(cards);})()`,
      { expected: JSON.stringify([target.key]), tries: 80 },
    ),
  ).toBe(true);
  expect(
    await obEvalUntil(vaultId, `String(${painted(target.key)})`, {
      expected: "true",
      tries: 80,
    }),
  ).toBe(true);

  cleanup.defer(() =>
    cleanupStep(async () => {
      await obEval(
        vaultId,
        `(()=>{app.plugins.plugins.zotlit.services.excerptImage.rendererDiagnostics.release();return true;})()`,
      );
    }),
  );
  cleanup.defer(() => removeUrlProbe(vaultId));
  await installUrlProbe(vaultId);
  const demand = await evalJson<{
    src: string;
    created: string[];
    revoked: string[];
    diagnostics: RendererDiagnostics;
  }>(vaultId, cardState(target.key));
  expect(demand.src).toMatch(/^blob:/);
  expect(demand.revoked).toEqual([]);

  // The reader closes while the card still demands its excerpt, and the card's
  // own Refresh gesture asks for those pixels again: with no reader to borrow
  // from, the resolution reads the file. Held inside that load, the card's
  // behaviour while the replacement runs is observable rather than a race.
  expect(
    await obEval(
      vaultId,
      `(()=>{app.plugins.plugins.zotlit.services.excerptImage.rendererDiagnostics.hold('document-loading');return true;})()`,
    ),
  ).toBe("true");
  expect(
    await obEval(
      vaultId,
      `(async()=>{
        await app.plugins.plugins.zotlit.services.excerptImage.clear();
        for(const leaf of app.workspace.getLeavesOfType('pdf'))leaf.detach();
        return true;
      })()`,
    ),
  ).toBe("true");
  expect(
    await obEvalUntil(
      vaultId,
      `String(app.workspace.getLeavesOfType('pdf').length===0&&!${borrowedDocument})`,
      { expected: "true", tries: 40 },
    ),
  ).toBe(true);
  expect(
    await obEval(
      vaultId,
      `(()=>{app.workspace.getLeavesOfType('zotero-annotation-view')[0].view.gestures.onRefresh();return true;})()`,
    ),
  ).toBe("true");
  expect(
    await obEvalUntil(
      vaultId,
      `(()=>{const state=${diagnostics};return String(state.phase==='document-loading'&&state.jobActive);})()`,
      { expected: "true", tries: 80 },
    ),
    "the replacement must reach the detached load while the card still paints its previous image",
  ).toBe(true);
  const replacing = await evalJson<{
    src: string | null;
    decoded: boolean;
    created: string[];
    revoked: string[];
  }>(vaultId, cardState(target.key));
  expect(replacing).toMatchObject({
    src: demand.src,
    decoded: true,
    created: demand.created,
    revoked: [],
  });

  await obEval(
    vaultId,
    `(()=>{app.plugins.plugins.zotlit.services.excerptImage.rendererDiagnostics.release();return true;})()`,
  );
  // The one request these pixels answer never changed, so the fallback's crop is
  // the reader's crop: its decoded pixels must equal the borrowed crop's, at the
  // same size. That is the parity the two routes' shared cache publication
  // depends on, and it is read off the card that paints it.
  //
  // The wait is on the replacement *landing* rather than on a URL changing,
  // because a card that keeps the URL of an unchanged image has published just
  // as truly as one that allocated a fresh URL: what it must show is the crop,
  // with either the URL it held and no work left, or a fresh URL painted while
  // the previous image's was released.
  expect(
    await obEvalUntil(
      vaultId,
      `(async()=>{
        const pixels=JSON.parse(await ${paintedPixels(target.key)});
        if(!pixels||pixels.width!==${borrowed.pixels!.width}||pixels.height!==${borrowed.pixels!.height}||pixels.pixels!==${JSON.stringify(borrowed.pixels!.pixels)})return 'false';
        const state=${probe};
        const image=${findImage(target.key)};
        const diagnostics=${diagnostics};
        if(state.created.length===${demand.created.length}&&image.src===${JSON.stringify(demand.src)}&&!diagnostics.jobActive&&diagnostics.phase==='idle')return 'true';
        return String(state.created.length>${demand.created.length}&&image.src===state.created[state.created.length-1]&&state.revoked.includes(${JSON.stringify(demand.src)}));
      })()`,
      { expected: "true", tries: 80 },
    ),
    "the detached fallback must paint the reader's crop and settle its URL",
  ).toBe(true);
  const replaced = await evalJson<{
    src: string;
    created: string[];
    revoked: string[];
    diagnostics: RendererDiagnostics;
  }>(vaultId, cardState(target.key));
  // URL lifetime, not an allocation count: the previous URL stayed usable while
  // the replacement ran (the card painted it, and nothing revoked it), and once
  // the new image is shown the card either keeps that URL — the pixels did not
  // move — or holds a fresh one it allocated and released the previous. What it
  // must never do is paint a URL it released, or orphan the one it replaced.
  const allocated = replaced.created.slice(demand.created.length);
  if (replaced.src === demand.src) {
    expect(allocated, "an unchanged URL needs no new allocation").toEqual([]);
    expect(replaced.revoked).not.toContain(replaced.src);
  } else {
    expect(replaced.src).toBe(allocated.at(-1));
    expect(
      replaced.revoked.filter((url) => url === demand.src),
      "the replaced image's URL is released exactly as the new one is shown",
    ).toHaveLength(1);
  }
  expect(replaced.src).toMatch(/^blob:/);
  expect(replaced.diagnostics).toMatchObject({
    jobActive: false,
    renderTaskActive: false,
  });
  expect(loadsBetween(demand.diagnostics, replaced.diagnostics)).toEqual({
    borrowed: 0,
    detached: 1,
    fileOpens: 1,
    documentLoads: 1,
  });
  console.info("Reader-backed excerpt evidence", {
    runtime,
    sha256: borrowed.outcome.sha256,
    borrowed: loadsBetween(borrowed.before, borrowed.after),
    pixels: borrowed.pixels,
    import: {
      outcome: imported.result.outcome,
      write: imported.result.write,
      note: importedNote.path,
      loads: loadsBetween(imported.before, imported.after),
      // The Fixture corpus's only excerpt-bearing note, imported warm: how long
      // the app took to settle it, and the memory its renderer process held
      // around it (`process.getProcessMemoryInfo()` answers null here, so the
      // renderer's own Node view is what this record has).
      elapsedMs: imported.elapsedMs,
      memoryBefore: imported.memoryBefore,
      memoryAfter: imported.memoryAfter,
      prepared: prepared.outcomes.length,
    },
    asset: published[0],
    detachedFallback: {
      loads: loadsBetween(demand.diagnostics, replaced.diagnostics),
      pixels: borrowed.pixels,
      url: {
        painted: replaced.src,
        previous: demand.src,
        reused: replaced.src === demand.src,
      },
    },
  });
}

/**
 * A saved edit's pixels: the card that shows an Annotation goes on painting
 * the image of the record that stood before the write while the replacement
 * resolves, then publishes the new pixels and releases the previous object URL.
 * A metadata-only edit says nothing at all and keeps the same image.
 *
 * A confirmed write needs Zotero's Local API, so this runs where the Attachment
 * is writable — the Paired Run — and skips where it is not.
 */
export async function verifySavedEditDisplay(
  vaultId: string,
  context: { skip: (note?: string) => void },
): Promise<void> {
  const card = await evalJson<{
    capability: { kind: string; reason?: string };
    record: { color: string | null; comment: string | null } | null;
  }>(
    vaultId,
    `(async()=>{
      const repository=app.plugins.plugins.zotlit.services.annotationRepository;
      await repository.ready;
      const list=await repository.read(${JSON.stringify(attachment.key)});
      const record=list?.annotations?.find(annotation=>annotation.key===${JSON.stringify(target.key)})??null;
      return JSON.stringify({capability:repository.capabilityFor(${JSON.stringify(target.key)}),record:record&&{color:record.color,comment:record.comment}});
    })()`,
  );
  if (card.capability.kind !== "writable") {
    context.skip(
      `a confirmed write needs a writable Attachment; this one is ${JSON.stringify(card.capability)}`,
    );
    return;
  }
  expect(card.record).not.toBeNull();
  expect(
    await obEvalUntil(vaultId, `String(${painted(target.key)})`, {
      expected: "true",
      tries: 80,
    }),
    "the card must paint an excerpt before a saved edit can replace it",
  ).toBe(true);

  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() =>
    cleanupStep(async () => {
      await obEval(
        vaultId,
        `(()=>{app.plugins.plugins.zotlit.services.excerptImage.rendererDiagnostics.release();return true;})()`,
      );
    }),
  );
  cleanup.defer(() => removeUrlProbe(vaultId));
  // The Fixture Annotation goes back to the record it was read with, so the
  // saved edit leaves the Library as it found it. An empty comment is how a
  // comment is cleared, so a null one is restored as written.
  cleanup.defer(() =>
    cleanupStep(async () => {
      const repository =
        "app.plugins.plugins.zotlit.services.annotationRepository";
      await obEval(
        vaultId,
        `(async()=>{
        const repository=${repository};
        const comment=await repository.patchComment(${JSON.stringify(target.key)},${JSON.stringify(card.record!.comment ?? "")});
        if(comment.kind!=='idle')throw new Error('The saved comment was not restored');
        const color=await repository.patchColor(${JSON.stringify(target.key)},${JSON.stringify(card.record!.color ?? editedColor)});
        if(color.kind!=='idle')throw new Error('The saved colour was not restored');
        return true;
      })()`,
      );
    }),
  );
  await installUrlProbe(vaultId);
  const before = await evalJson<{
    src: string;
    created: string[];
    diagnostics: RendererDiagnostics;
  }>(vaultId, cardState(target.key));
  expect(before.src).toMatch(/^blob:/);
  // The record a note import or a batch resolution captures while it runs, taken
  // here as the edit arrives: it is resolved again after the edit has answered,
  // and the store's latest reference must still name the edit.
  const staleSnapshot = await evalJson<{
    version: number | null;
    color: string | null;
  }>(
    vaultId,
    `(async()=>{
      ${requester}
      const request=requestFor(${JSON.stringify(target.key)});
      app.__zotlitExcerptStale=request;
      return JSON.stringify({version:request.annotation.version??null,color:request.annotation.color??null});
    })()`,
  );
  expect(staleSnapshot.color).toBe(card.record!.color);
  expect(
    staleSnapshot.version,
    "the Fixture Annotations must carry a version for saved order to be an order",
  ).not.toBeNull();
  // What the card paints now, decoded: the edit's own replacement is compared
  // against it, so a fresh URL over the old pixels cannot pass.
  const beforePixels = await evalJson<DecodedPixels | null>(
    vaultId,
    paintedPixels(target.key),
  );
  expect(beforePixels?.pixels).toMatch(/^[0-9a-f]{64}$/);

  // A colour edit moves an ink Annotation's pixels, so the card's image is
  // replaced. Held inside the crop that replacement needs, the previous image
  // is observable on screen rather than inferred from timing.
  expect(
    await obEval(
      vaultId,
      `(()=>{app.plugins.plugins.zotlit.services.excerptImage.rendererDiagnostics.hold('page-rendering');return true;})()`,
    ),
  ).toBe("true");
  const saved = await evalJson<{ kind: string }>(
    vaultId,
    `(async()=>{const outcome=await app.plugins.plugins.zotlit.services.annotationRepository.patchColor(${JSON.stringify(target.key)},${JSON.stringify(editedColor)});return JSON.stringify(outcome);})()`,
  );
  expect(saved).toMatchObject({ kind: "idle" });
  expect(
    await obEvalUntil(
      vaultId,
      `(()=>{const state=${diagnostics};return String(state.phase==='page-rendering'&&state.jobActive);})()`,
      { expected: "true", tries: 80 },
    ),
    "the saved edit must start a replacement rendering of the same Annotation",
  ).toBe(true);
  const held = await evalJson<{
    src: string | null;
    decoded: boolean;
    created: string[];
    revoked: string[];
  }>(vaultId, cardState(target.key));
  expect(held).toMatchObject({
    src: before.src,
    decoded: true,
    created: before.created,
    revoked: [],
  });

  await obEval(
    vaultId,
    `(()=>{app.plugins.plugins.zotlit.services.excerptImage.rendererDiagnostics.release();return true;})()`,
  );
  expect(
    await obEvalUntil(
      vaultId,
      `String(${painted(target.key)}&&${findImage(target.key)}.src!==${JSON.stringify(before.src)})`,
      { expected: "true", tries: 80 },
    ),
    "the replacement must publish the edited pixels",
  ).toBe(true);
  const edited = await evalJson<{
    src: string;
    created: string[];
    revoked: string[];
    diagnostics: RendererDiagnostics;
  }>(vaultId, cardState(target.key));
  expect(edited.created.slice(before.created.length)).toHaveLength(1);
  expect(edited.src).toBe(edited.created.at(-1));
  expect(edited.revoked).toEqual([before.src]);
  expect(
    loadsBetween(before.diagnostics, edited.diagnostics).detached +
      loadsBetween(before.diagnostics, edited.diagnostics).borrowed,
  ).toBeGreaterThan(0);
  // The replacement publishes pixels, not just a URL: what the card paints now
  // is the image the saved record resolves to, and it is not the image the
  // pre-edit record resolved to.
  const editedPixels = await evalJson<DecodedPixels | null>(
    vaultId,
    paintedPixels(target.key),
  );
  const resolved = await evalJson<{ pixels: DecodedPixels | null }>(
    vaultId,
    `(async()=>{
      ${requester}
      const outcome=await services.excerptImage.resolve(requestFor(${JSON.stringify(target.key)}));
      return JSON.stringify({pixels:outcome.kind==='available'?await (${decodedPixels})(outcome.bytes,outcome.format.mimeType):null});
    })()`,
  );
  expect(editedPixels).toMatchObject({
    width: expect.any(Number),
    height: expect.any(Number),
    pixels: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
  expect(editedPixels!.pixels).not.toBe(beforePixels!.pixels);
  expect(editedPixels).toEqual(resolved.pixels);

  // A comment moves no pixels: the record's own image stands, no crop runs, and
  // the card keeps the very URL it paints from.
  const idle = await evalJson<{
    before: RendererDiagnostics;
    after: RendererDiagnostics;
    outcome: { kind: string };
  }>(
    vaultId,
    `(async()=>{
      const repository=app.plugins.plugins.zotlit.services.annotationRepository;
      const before=${diagnostics};
      const outcome=await repository.patchComment(${JSON.stringify(target.key)},${JSON.stringify(editedComment)});
      const after=${diagnostics};
      return JSON.stringify({before,after,outcome});
    })()`,
  );
  expect(idle.outcome).toMatchObject({ kind: "idle" });
  expect(
    await obEvalUntil(
      vaultId,
      `String(app.workspace.getLeavesOfType('zotero-annotation-view').some(leaf=>leaf.view.containerEl.textContent?.includes(${JSON.stringify(editedComment)})))`,
      { expected: "true", tries: 80 },
    ),
    "the saved comment must reach the Annotation View",
  ).toBe(true);
  const unchanged = await evalJson<{
    src: string;
    created: string[];
    revoked: string[];
    diagnostics: RendererDiagnostics;
  }>(vaultId, cardState(target.key));
  expect(unchanged).toMatchObject({
    src: edited.src,
    created: edited.created,
    revoked: [before.src],
  });
  expect(loadsBetween(idle.before, idle.after)).toEqual({
    borrowed: 0,
    detached: 0,
    fileOpens: 0,
    documentLoads: 0,
  });

  // ── A captured older request, resolved after the saved edit ─────────────
  // A note import or a batch resolution holds the record as it was when the
  // batch started. This one is resolved now that the edit has already answered,
  // and it must not become the Annotation's latest image: the reference a
  // remount seeds from names the latest *saved* record, not the latest answer.
  const superseded = await evalJson<{
    version: number | null;
    currentVersion: number | null;
    before: RendererDiagnostics;
    after: RendererDiagnostics;
    outcome: {
      kind: string;
      provenance?: string;
      pixels: DecodedPixels | null;
    };
    stored: DecodedPixels | null;
  }>(
    vaultId,
    `(async()=>{
      ${requester}
      const request=app.__zotlitExcerptStale;
      if(!request)throw new Error('The pre-edit snapshot is gone');
      const before=${diagnostics};
      const outcome=await services.excerptImage.resolve(request);
      const after=${diagnostics};
      const current=requestFor(${JSON.stringify(target.key)});
      const reference=await services.excerptImage.stored(current);
      delete app.__zotlitExcerptStale;
      return JSON.stringify({
        version:request.annotation.version??null,
        currentVersion:current.annotation.version??null,
        before,
        after,
        outcome:outcome.kind==='available'?{kind:outcome.kind,provenance:outcome.provenance,pixels:await (${decodedPixels})(outcome.bytes,outcome.format.mimeType)}:{kind:outcome.kind,pixels:null},
        stored:reference&&reference.kind==='available'?await (${decodedPixels})(reference.bytes,reference.format.mimeType):null,
      });
    })()`,
  );
  expect(superseded.outcome.kind).toBe("available");
  expect(
    superseded.version!,
    "the captured snapshot must predate the saved edit",
  ).toBeLessThan(superseded.currentVersion!);
  // The snapshot really carries the superseded pixels, so what the store keeps
  // is a decision rather than the same image twice.
  expect(superseded.outcome.pixels!.pixels).toBe(beforePixels!.pixels);
  expect(superseded.outcome.pixels!.pixels).not.toBe(editedPixels!.pixels);
  // The latest reference is the saved edit's image, not the answer that arrived
  // last — this is what a card seeds from.
  expect(
    superseded.stored?.pixels,
    "the store's latest reference must still name the saved edit's pixels",
  ).toBe(editedPixels!.pixels);

  // ── What a remount shows ────────────────────────────────────────────────
  // Reopening the view drops its cards and mounts them again, which is the
  // surface a restart shows: the card seeds from that reference, and what it
  // paints must be the saved edit's pixels.
  const viewState = await evalJson<{ state: unknown }>(
    vaultId,
    `(async()=>{
      const leaves=app.workspace.getLeavesOfType('zotero-annotation-view');
      if(leaves.length===0)throw new Error('The Annotation View is not open');
      const state=leaves[0].getViewState();
      for(const leaf of leaves)leaf.detach();
      return JSON.stringify({state});
    })()`,
  );
  expect(
    await obEval(
      vaultId,
      `(async()=>{const leaf=app.workspace.getLeaf('tab');await leaf.setViewState(Object.assign({},${JSON.stringify(viewState.state)},{active:true}));return true;})()`,
    ),
  ).toBe("true");
  expect(
    await obEvalUntil(vaultId, `String(${painted(target.key)})`, {
      expected: "true",
      tries: 80,
    }),
    "the reopened Annotation View must mount the target Annotation's card",
  ).toBe(true);
  const remounted = await evalJson<DecodedPixels | null>(
    vaultId,
    paintedPixels(target.key),
  );
  expect(
    remounted?.pixels,
    "a remount paints the saved edit's pixels, never the superseded answer's",
  ).toBe(editedPixels!.pixels);

  console.info("Saved-edit display evidence", {
    annotation: target.key,
    color: { from: card.record!.color, to: editedColor },
    objectUrl: {
      painted: before.src,
      edited: edited.src,
      revoked: edited.revoked,
    },
    pixels: {
      painted: beforePixels!.pixels,
      edited: editedPixels!.pixels,
      superseded: superseded.outcome.pixels!.pixels,
      stored: superseded.stored?.pixels ?? null,
      remounted: remounted?.pixels ?? null,
    },
    superseded: {
      version: superseded.version,
      currentVersion: superseded.currentVersion,
      provenance: superseded.outcome.provenance ?? null,
      loads: loadsBetween(superseded.before, superseded.after),
    },
  });
}
