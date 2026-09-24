// The Obsidian half of a gesture on a PDF page in the Paired Run: the reader's
// view as an eval expression, pointer events dispatched as the browser sends
// them, the window raised so the page lays out, and the reads a Geometry Edit
// test takes of the plugin around a gesture.

import { expect } from "vitest";

import { obEval, obEvalUntil } from "./obsidian-cli.ts";

/**
 * The Obsidian PDF view showing `attachmentPath` in a laid-out leaf, as an
 * eval expression.
 */
export function pdfViewOf(attachmentPath: string): string {
  return `app.workspace.getLeavesOfType('pdf').map(({view})=>view).find((view)=>view.file?.path===${JSON.stringify(attachmentPath)}&&view.containerEl.getBoundingClientRect().width>0)`;
}

/**
 * Declares `clientOf(x, y)` in an eval: a PDF point on page one of the view
 * `pdfView` as a client point, through the overlay the page draws — its box on
 * screen over its own `viewBox`, which is the frame a gesture on the page is
 * measured in.
 *
 * @param pdfView the PDF view as an eval expression, as {@link pdfViewOf} gives it.
 */
export function clientOfFirstPage(pdfView: string): string {
  return `const clientOf=(x,y)=>{const overlay=${pdfView}.viewer.child.getPage(1).div.querySelector('.zt-pdf-annotation-overlay');const box=overlay.getBoundingClientRect();const view=overlay.viewBox.baseVal;return {x:box.left+(x-view.x)*box.width/view.width,y:box.top+(view.y+view.height-y)*box.height/view.height};};`;
}

/**
 * The Creation Toolbar button of `tool` in the view `pdfView`, as an eval
 * expression.
 *
 * @param pdfView the PDF view as an eval expression, as {@link pdfViewOf} gives it.
 * @param tool the button's `data-zt-tool`.
 */
export function toolButtonOf(pdfView: string, tool: string): string {
  return `${pdfView}.containerEl.querySelector('[data-zt-tool=${JSON.stringify(tool)}]')`;
}

/**
 * The reader's page container, which scrolls the pages, as an eval expression.
 *
 * @param pdfView the PDF view as an eval expression, as {@link pdfViewOf} gives it.
 */
export function pageContainerOf(pdfView: string): string {
  return `${pdfView}.viewer.child.pdfViewer.pdfViewer.container`;
}

/**
 * Brings page one on screen in a window that lays it out, and arms `tool`
 * from the Creation Toolbar. With `at`, the PDF point `at` on page one is
 * first brought to the middle of the window.
 */
export async function armToolOnFirstPage(
  vaultId: string,
  {
    pdfView,
    tool,
    at,
  }: {
    /** The PDF view as an eval expression, as {@link pdfViewOf} gives it. */
    pdfView: string;
    /** The button's `data-zt-tool`. */
    tool: string;
    at?: readonly [number, number];
  },
): Promise<void> {
  await raiseWindow(vaultId);
  expect(
    await obEvalUntil(
      vaultId,
      `(function(){const view=${pdfView};if(!view)return 'no view';view.viewer.child.pdfViewer.pdfViewer.currentPageNumber=1;return String(!!view.viewer.child.getPage(1)?.div.querySelector('.zt-pdf-annotation-overlay'));})()`,
      { expected: "true" },
    ),
  ).toBe(true);
  if (at) {
    const clientOf = clientOfFirstPage(pdfView);
    const [x, y] = at;
    await obEval(
      vaultId,
      `(function(){${clientOf}const at=clientOf(${x},${y});${pageContainerOf(pdfView)}.scrollTop+=at.y-innerHeight/2;return true;})()`,
    );
    // Measured in its own eval, once the scroll has laid the page out.
    expect(
      await obEvalUntil(
        vaultId,
        `(function(){${clientOf}const at=clientOf(${x},${y});return String(Math.abs(at.y-innerHeight/2)<innerHeight/4&&!!document.elementFromPoint(at.x,at.y));})()`,
        { expected: "true" },
      ),
    ).toBe(true);
  }
  expect(
    await obEval(
      vaultId,
      `(function(){const tool=${toolButtonOf(pdfView, tool)};if(tool.getAttribute('aria-pressed')!=='true')tool.click();return tool.getAttribute('aria-pressed');})()`,
    ),
  ).toBe("true");
}

/**
 * Stands `tool` down from the Creation Toolbar where it is armed, so the next
 * test starts with no tool armed.
 */
export async function disarmTool(
  vaultId: string,
  { pdfView, tool }: { pdfView: string; tool: string },
): Promise<void> {
  await obEval(
    vaultId,
    `(function(){const tool=${toolButtonOf(pdfView, tool)};if(tool?.getAttribute('aria-pressed')==='true')tool.click();return true;})()`,
  );
}

/**
 * One field of the Editing Capability on the Attachment `attachmentKey`, read
 * after a fresh Capability Probe, as an eval expression.
 */
export function capabilityOf(
  attachmentKey: string,
  field: "kind" | "reason",
): string {
  return `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;await repository.probe();return String(repository.capabilityFor(${JSON.stringify(attachmentKey)}).${field});})()`;
}

/**
 * Settles once the blocked gesture a press reported in the view on
 * `attachmentPath` has run to its end: the probe it starts, and the notice
 * after it.
 */
export async function settledGesture(
  vaultId: string,
  attachmentPath: string,
): Promise<void> {
  await obEval(
    vaultId,
    `(async()=>{await app.plugins.plugins.zotlit.services.pdfAnnotationEditor.bindings.find((candidate)=>candidate.filePath===${JSON.stringify(attachmentPath)}).gestured;return true;})()`,
  );
}

/**
 * Declares `fire(type, x, y, target?, extra?)` in an eval: one pointer event,
 * or the click that follows a release, dispatched as the browser would at a
 * client point — to the node under it unless a target is named — answering
 * that node. `extra` overrides the event's own fields, such as a second
 * pointer's `pointerId`.
 */
export const FIRE = `const fire=(type,x,y,target,extra)=>{const node=target??document.elementFromPoint(x,y);const init={clientX:x,clientY:y,bubbles:true,cancelable:true,pointerId:1,button:0,buttons:type==='pointerup'||type==='click'?0:1,view:window,...extra};node.dispatchEvent(type==='click'?new MouseEvent(type,init):new PointerEvent(type,init));return node;};`;

/**
 * Declares `tap(x, y)` in an eval, after {@link FIRE}: a press, its release,
 * and the click that follows, all at one client point — a mark click as the
 * browser delivers it.
 */
export const TAP = `const tap=(x,y)=>{const node=fire('pointerdown',x,y);fire('pointerup',x,y,node);fire('click',x,y,node);return node;};`;

/**
 * Shows and raises the vault's window. A pointer gesture is hit-tested against
 * the page as laid out, and a hidden or occluded window neither lays out nor
 * paints it.
 */
export async function raiseWindow(vaultId: string): Promise<void> {
  expect(
    await obEvalUntil(
      vaultId,
      "(function(){const electronWindow=require('@electron/remote').getCurrentWindow();electronWindow.show();electronWindow.moveTop();return document.visibilityState;})()",
      { expected: "visible" },
    ),
  ).toBe(true);
}

/**
 * The Sort Index the reader's text structure gives a stored position, through
 * the binding of the view on `attachmentPath` — the value a Geometry Edit is
 * saved with.
 *
 * @param position the position as Zotero stores it, a JSON string.
 */
export async function recomputedSortIndex(
  vaultId: string,
  { attachmentPath, position }: { attachmentPath: string; position: string },
): Promise<string> {
  return JSON.parse(
    await obEval(
      vaultId,
      `(async()=>{const binding=app.plugins.plugins.zotlit.services.pdfAnnotationEditor.bindings.find((candidate)=>candidate.filePath===${JSON.stringify(attachmentPath)});return JSON.stringify(await binding.sortIndex(${position}));})()`,
    ),
  ) as string;
}

/**
 * Records the Annotations whose Excerpt Image pixels the repository announces
 * as changed, from now until disposal, which lets go of the listener on every
 * exit.
 */
export async function watchExcerptPixels(
  vaultId: string,
): Promise<AsyncDisposable & { keys(): Promise<string[]> }> {
  await obEval(
    vaultId,
    "(function(){window.__ztPixelsOff?.();window.__ztPixels=[];window.__ztPixelsOff=app.plugins.plugins.zotlit.services.annotationRepository.on('excerpt-pixels-changed',(record)=>window.__ztPixels.push(record.key));return true;})()",
  );
  return {
    async keys() {
      return JSON.parse(
        await obEval(vaultId, "JSON.stringify(window.__ztPixels)"),
      ) as string[];
    },
    async [Symbol.asyncDispose]() {
      await obEval(
        vaultId,
        "(function(){window.__ztPixelsOff?.();delete window.__ztPixelsOff;delete window.__ztPixels;return true;})()",
      );
    },
  };
}
