// The CodeMirror side of annotation hover: the Durable Annotation Link under
// the pointer, and the hover that shows the Annotation it names.

import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";

import { parseAnnotationOpenUri } from "@zotlit/db";
import type { AnnotationOpenUriOptions } from "@zotlit/db";

import { getLogger } from "@/lib/log";
import type { AnnotationHoverRequest } from "@/services/annotation-popover/service";
import {
  annotationHoverIntent,
  hoverGesture,
} from "@/services/citekey-navigation";
import type { HoverPreferences } from "@/services/citekey-navigation";

const logger = getLogger("citekey-editor");

/** The Annotation one Durable Annotation Link names, by bare keys. */
export type DurableAnnotationLink = AnnotationOpenUriOptions;

export interface AnnotationLinkHoverHandlers {
  /** What hover answers with, read once per hover. */
  hoverPreferences: () => HoverPreferences;
  /** Show the popover of one hovered Durable Annotation Link. */
  showAnnotation: (request: AnnotationHoverRequest) => void;
}

/**
 * Obsidian's classes for a Markdown link's text and its URL. A link written in
 * code, math, or a comment carries neither, so only a link Obsidian itself
 * draws as one is hovered.
 */
const LINK_SELECTOR = ".cm-link, .cm-url";

/**
 * Shows the Annotation a hovered Durable Annotation Link names, in Live
 * Preview and Source mode alike, as the Hover Action asks.
 *
 * Obsidian raises no `hover-link` for an external link, so the hover is read
 * here, off the link Obsidian draws, and goes straight to the popover.
 */
export function annotationLinkHoverExtension(
  handlers: AnnotationLinkHoverHandlers,
): Extension {
  return EditorView.domEventHandlers({
    mouseover(event, view) {
      hoverAt(event, view, handlers);
      return false;
    },
  });
}

function hoverAt(
  event: MouseEvent,
  view: EditorView,
  handlers: AnnotationLinkHoverHandlers,
): void {
  const targetEl = linkElementAt(event);
  if (targetEl === null) return;
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return;
  const link = annotationLinkAtPos(view.state, pos);
  if (link === null) return;

  const editorMode = view.dom.closest(".is-live-preview")
    ? "live-preview"
    : "source";
  const intent = annotationHoverIntent(
    hoverGesture(event, { surface: "editor", editorMode }),
    handlers.hoverPreferences(),
  );
  if (intent.kind === "nothing") {
    logger.trace("Annotation link hover suppressed", {
      annotationKey: link.annotationKey,
      editorMode,
      reason: intent.reason,
    });
    return;
  }
  const info = view.state.field(editorInfoField, false);
  if (!info) return;
  logger.trace("Annotation link shows its annotation", {
    annotationKey: link.annotationKey,
    editorMode,
  });
  handlers.showAnnotation({
    event,
    hoverParent: info,
    targetEl,
    sourcePath: info.file?.path ?? "",
    link,
  });
}

/**
 * Applies the re-entry guard Obsidian runs before its own `hover-link`, so
 * moving within one link fires a single hover.
 *
 * @returns the link element the pointer entered, or null when the event lands
 *   on no link or moves within the one it is already inside.
 */
function linkElementAt(event: MouseEvent): HTMLElement | null {
  const target = event.target as Node | null;
  const relatedTarget = event.relatedTarget as Node | null;
  if (!target?.instanceOf(HTMLElement)) return null;
  const targetEl = target.closest<HTMLElement>(LINK_SELECTOR);
  if (targetEl === null) return null;
  if (relatedTarget?.instanceOf(Node) && targetEl.contains(relatedTarget)) {
    return null;
  }
  return targetEl;
}

/**
 * The `](zotero://open/…)` tail of an inline Markdown link, which is the form
 * every Durable Annotation Link ZotLit writes takes.
 */
const OPEN_LINK_TAIL = /\]\(zotero:\/\/open\/[^\s)]*\)/g;

/**
 * The Durable Annotation Link covering document position `pos`, in its text
 * or in its URL. `pos` counts as inside at either boundary, the range test
 * {@link citekeyAtPos} runs too.
 *
 * @returns the Annotation the link names, or null where `pos` sits in no
 *   inline link to a Zotero Annotation.
 */
export function annotationLinkAtPos(
  state: EditorState,
  pos: number,
): DurableAnnotationLink | null {
  const line = state.doc.lineAt(pos);
  const offset = pos - line.from;
  for (const tail of line.text.matchAll(OPEN_LINK_TAIL)) {
    const end = tail.index + tail[0].length;
    if (offset > end) continue;
    const start = openingBracket(line.text, tail.index);
    if (start === null || offset < start) return null;
    // `](` and `)` are the two characters either side of the URL.
    return parseAnnotationOpenUri(tail[0].slice(2, -1));
  }
  return null;
}

/**
 * @param close the index of the `]` that closes the link text.
 * @returns the index of the `[` that opens it, counting nested brackets, or
 *   null when the line opens none.
 */
function openingBracket(text: string, close: number): number | null {
  let depth = 0;
  for (let index = close - 1; index >= 0; index--) {
    const char = text[index];
    if (text[index - 1] === "\\") continue;
    if (char === "]") depth++;
    else if (char === "[") {
      if (depth === 0) return index;
      depth--;
    }
  }
  return null;
}
