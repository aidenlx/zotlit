// The textarea a Text Draft is typed into, over its page.
//
// It is placed, sized and styled from the same box, font and line height the
// saved text mark is drawn from, so the create that ends the draft moves no
// line. A plain textarea, as Zotero's own text box is: the stored text is
// plain.
//
// One residual stays: the textarea is `LINE_SLACK` wider than the box, so a
// line whose width falls in `(width, width + 1]` points stays whole in the
// textarea and wraps in the saved mark.
//
// @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/page.js#L860-L947
import { themeHook } from "@/lib/theme-hooks";

import { readingAngle } from "./free-text-layout";
import type { TextDraft } from "./reader-surface-state";
import { darken, pageUnitSize, unitPointOf, unitsPerPixel } from "./render";
import type { MeasuredFont, OverlayPageView } from "./render";

/**
 * The room a line gets past its fitted width, in PDF points. A box fitted to
 * lines its newlines split is exactly as wide as the widest of them, and the
 * textarea lays that line out up to a hundredth of a point wider than the
 * canvas measure does; one point keeps it on one line, and is narrower than
 * any word the measure could have wrapped.
 */
const LINE_SLACK = 1;

/** What the textarea hands back to the creation surfaces. */
export interface TextDraftEvents {
  /** The textarea now holds this text. */
  input: (text: string) => void;
  /** Escape, or the focus left the textarea while it stood on its page. */
  finish: () => void;
}

/**
 * Builds the textarea once for a draft. A press on it stays its own, so no
 * reader gesture under it acts; Escape finishes the draft and goes no
 * further. The page's own re-render takes the textarea off the page for a
 * moment, and a focus lost to that is no finish.
 */
export function createTextDraftArea(
  document_: Document,
  { input, finish }: TextDraftEvents,
): HTMLTextAreaElement {
  const area = document_.createElement("textarea");
  area.classList.add(themeHook.pdfTextDraft);
  area.dir = "auto";
  area.spellcheck = false;
  area.addEventListener("input", () => input(area.value));
  area.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    finish();
  });
  area.addEventListener("blur", () => {
    queueMicrotask(() => {
      if (area.isConnected) finish();
    });
  });
  for (const type of ["pointerdown", "pointerup", "click"] as const)
    area.addEventListener(type, (event) => event.stopPropagation());
  return area;
}

/**
 * Places the textarea on its page from the draft's box: its top-left corner
 * where the box's is, turned as the page turns its text, in the font the
 * saved mark is drawn in and its colour darkened as Zotero's reader draws
 * text on screen.
 *
 * The textarea is laid out at one CSS pixel per PDF point, the size the
 * measure fits the box at, and scaled to the page as a whole, as the saved
 * mark is drawn at its stored size and scaled with the overlay. Laid out at
 * the page's own font size instead, a small zoom rounds each glyph's advance
 * and wraps a line the measure keeps whole.
 */
export function placeTextDraft(
  area: HTMLTextAreaElement,
  page: OverlayPageView,
  { draft, font }: { draft: TextDraft; font: MeasuredFont },
): void {
  // CSS pixels per PDF point.
  const scale = 1 / unitsPerPixel(page);
  const unit = pageUnitSize(page);
  const [left, bottom, right, top] = draft.box;
  const corner = unitPointOf(page, [left, top]);
  const angle = readingAngle(
    (x, y) => {
      const { x: px, y: py } = unitPointOf(page, [x, y]);
      return [px, py];
    },
    left,
    top,
  );
  area.setCssProps({
    "--zt-text-draft-left": `${(corner.x / unit.width) * 100}%`,
    "--zt-text-draft-top": `${(corner.y / unit.height) * 100}%`,
    "--zt-text-draft-width": `${right - left + LINE_SLACK}px`,
    "--zt-text-draft-height": `${top - bottom}px`,
    "--zt-text-draft-angle": `${angle}deg`,
    "--zt-text-draft-scale": String(scale),
    "--zt-text-draft-font-family": font.family,
    "--zt-text-draft-font-size": `${draft.fontSize}px`,
    "--zt-text-draft-color": darken(draft.color),
  });
  if (area.value !== draft.text) area.value = draft.text;
  area.readOnly = draft.phase === "saving";
}

/**
 * Takes the textarea off its page. Where it held the focus, the focus goes to
 * the page's text layer, where a click on the page leaves it, so the next key
 * still reaches the reader: a second Escape after a finished draft closes the
 * Mark Popup on the saved mark. A focus the finish already moved elsewhere
 * stays there.
 */
export function removeTextDraftArea(area: HTMLTextAreaElement): void {
  const focused = area.doc.activeElement === area;
  const textLayer =
    area.parentElement?.querySelector<HTMLElement>(".textLayer");
  area.remove();
  if (focused) textLayer?.focus({ preventScroll: true });
}
