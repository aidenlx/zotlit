// The CodeMirror side of annotation hover: the Durable Annotation Link under
// the pointer, and the hover that shows the Annotation it names.

import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { editorInfoField } from "obsidian";

import { parseAnnotationOpenUri } from "@zotlit/db";
import type { AnnotationOpenUriOptions } from "@zotlit/db";

import { tokenNodes, visibleLineRanges } from "@/lib/editor-decoration";
import type { DocRange, TokenNode } from "@/lib/editor-decoration";
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
  /** Whether Obsidian's Page preview row for ZotLit citations asks for Mod. */
  pagePreviewRequiresMod: () => boolean;
  /** Show the popover of one hovered Durable Annotation Link. */
  showAnnotation: (request: AnnotationHoverRequest) => void;
}

/**
 * Obsidian's classes for a Markdown link's text and its URL. A link written in
 * code, math, or a comment carries neither, so only a link Obsidian itself
 * draws as one is hovered.
 */
const LINK_SELECTOR = ".cm-link, .cm-url";

/** The one element wrapping a whole Durable Annotation Link, `[` to `)`. */
const LINK_CLASS = "zt-annotation-link";

const linkMark = Decoration.mark({ class: LINK_CLASS });

/**
 * Shows the Annotation a hovered Durable Annotation Link names, in Live
 * Preview and Source mode alike, as the Hover Action asks.
 *
 * Obsidian raises no `hover-link` for an external link, so the hover is read
 * here, off the link Obsidian draws, and goes straight to the popover.
 *
 * The popover hangs off one element and follows the pointer in and out of it,
 * while Obsidian draws one link as several — Source mode shows its text and
 * its URL as spans of their own. Each link is therefore wrapped whole in one
 * mark, which the popover anchors on wherever in the link the pointer sits.
 */
export function annotationLinkHoverExtension(
  handlers: AnnotationLinkHoverHandlers,
): Extension {
  return [
    annotationLinkMarks,
    // A lower-precedence mark draws the outer element, and Obsidian's token
    // highlighter already sits at `Prec.lowest`, after every plugin. Only an
    // outer decoration wraps its spans whole rather than being split by them.
    EditorView.outerDecorations.of(
      (view) =>
        view.plugin(annotationLinkMarks)?.decorations ?? Decoration.none,
    ),
    EditorView.domEventHandlers({
      mouseover(event, view) {
        hoverAt(event, view, handlers);
        return false;
      },
    }),
  ];
}

/** Wraps every Durable Annotation Link in the visible lines in one mark. */
const annotationLinkMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = markLinks(view);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = markLinks(update.view);
      }
    }
  },
);

function markLinks(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of visibleLineRanges(view)) {
    for (const { from, to } of annotationLinksIn(view.state, range)) {
      builder.add(from, to, linkMark);
    }
  }
  return builder.finish();
}

function hoverAt(
  event: MouseEvent,
  view: EditorView,
  handlers: AnnotationLinkHoverHandlers,
): void {
  const targetEl = linkElementAt(event);
  if (targetEl === null) return;
  const link = annotationLinkAtPos(view.state, view.posAtDOM(targetEl));
  if (link === null) return;

  const editorMode = view.dom.closest(".is-live-preview")
    ? "live-preview"
    : "source";
  const intent = annotationHoverIntent(
    hoverGesture(event, { surface: "editor", editorMode }),
    handlers.hoverPreferences(),
    handlers.pagePreviewRequiresMod,
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
 * moving within one link — from its text to its URL too — fires a single
 * hover.
 *
 * @returns the element wrapping the whole link the pointer entered, or null
 *   when the event lands on nothing Obsidian draws as a link, or moves within
 *   the link it is already inside.
 */
function linkElementAt(event: MouseEvent): HTMLElement | null {
  const target = event.target as Node | null;
  const relatedTarget = event.relatedTarget as Node | null;
  if (!target?.instanceOf(HTMLElement)) return null;
  if (target.closest(LINK_SELECTOR) === null) return null;
  const targetEl = target.closest<HTMLElement>(`.${LINK_CLASS}`);
  if (targetEl === null) return null;
  if (relatedTarget?.instanceOf(Node) && targetEl.contains(relatedTarget)) {
    return null;
  }
  return targetEl;
}

/**
 * The Durable Annotation Link covering document position `pos`, in its text
 * or in its URL. `pos` counts as inside at either boundary, the range test
 * {@link citekeyAtPos} runs too. Where one link ends as the next begins, the
 * position answers the one beginning there — the start a hovered link's
 * wrapper reports.
 *
 * @returns the Annotation the link names, or null where `pos` sits in no
 *   inline link to a Zotero Annotation.
 */
export function annotationLinkAtPos(
  state: EditorState,
  pos: number,
): DurableAnnotationLink | null {
  const line = state.doc.lineAt(pos);
  const found = annotationLinksIn(state, line).findLast(
    ({ from, to }) => from <= pos && pos <= to,
  );
  return found?.link ?? null;
}

/** One Durable Annotation Link, spanning `[` to `)`. */
interface AnnotationLinkSpan extends DocRange {
  link: DurableAnnotationLink;
}

/** The Durable Annotation Links among the inline Markdown links of `range`. */
function annotationLinksIn(
  state: EditorState,
  range: DocRange,
): AnnotationLinkSpan[] {
  return markdownLinks(tokenNodes(state, range)).flatMap(
    ({ from, to, url }) => {
      const link = parseAnnotationOpenUri(url);
      return link === null ? [] : [{ from, to, link }];
    },
  );
}

/**
 * The token classes Obsidian's HyperMD mode gives an inline `[text](url)`:
 * `formatting formatting-link link` on each bracket, `link` on the text,
 * `formatting formatting-link-string string url` on each parenthesis and
 * `string url` on the URL. Like the wikilink vocabulary it is a fork internal
 * with no compatibility contract, so an unknown one finds no links.
 *
 * @see ../wikilink-editor/scan.ts
 */
const TOKEN_LINK = "link";
const TOKEN_LINK_BRACKET = "formatting-link";
const TOKEN_URL_PAREN = "formatting-link-string";
const TOKEN_URL = "url";

/**
 * Finds every inline `[text](url)` among `nodes` the way Obsidian's own
 * `getClickableTokenAt` reads one: a run of `link` nodes opened by `[`
 * and closed by `]`, met at once by `(`, the URL and `)`. Nodes must
 * touch, so plain text anywhere in between ends the run. Code, math and
 * frontmatter never carry the link classes, so they need no exclusion list.
 * Empty text leaves the two brackets touching, which the parser merges into
 * one `[]` node.
 *
 * @param nodes the token nodes of whole lines, so no link is cut by an edge.
 */
function markdownLinks(
  nodes: readonly TokenNode[],
): { from: number; to: number; url: string }[] {
  const links: { from: number; to: number; url: string }[] = [];
  let run: {
    from: number;
    /** Where the next node of the run must start. */
    at: number;
    phase: "text" | "closed" | "url";
    url: string;
  } | null = null;

  for (const { from, to, classes, text } of nodes) {
    const bracket =
      classes.includes(TOKEN_LINK_BRACKET) && classes.includes(TOKEN_LINK);
    const paren = classes.includes(TOKEN_URL_PAREN);

    if (run !== null && from === run.at) {
      run.at = to;
      if (run.phase === "text") {
        if (bracket && text === "]") run.phase = "closed";
        else if (!classes.includes(TOKEN_LINK)) run = null;
        continue;
      }
      if (run.phase === "closed") {
        if (paren && text === "(") {
          run.phase = "url";
          continue;
        }
      } else if (paren && text === ")") {
        links.push({ from: run.from, to, url: run.url });
        run = null;
        continue;
      } else if (classes.includes(TOKEN_URL)) {
        run.url += text;
        continue;
      }
    }
    run =
      bracket && (text === "[" || text === "[]")
        ? { from, at: to, phase: text === "[" ? "text" : "closed", url: "" }
        : null;
  }
  return links;
}
