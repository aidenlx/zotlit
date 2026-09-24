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
