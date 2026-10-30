// The CodeMirror side of annotation hover: the Durable Annotation Link under
// the pointer, the hover that shows the Annotation it names, and the
// Annotation Citation shown in Live Preview as the citation it is.

import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { editorInfoField, Keymap, livePreviewState } from "obsidian";

import { parseAnnotationOpenUri } from "@zotlit/db";
import type { AnnotationOpenUriOptions } from "@zotlit/db";

import {
  livePreviewOf,
  overlapsSelection,
  tokenNodes,
  visibleLineRanges,
} from "@/lib/editor-decoration";
import type { DocRange, TokenNode } from "@/lib/editor-decoration";
import { getLogger } from "@/lib/log";
import { themeHook } from "@/lib/theme-hooks";
import type { AnnotationHoverRequest } from "@/services/annotation-popover/service";
import {
  citationContent,
  citationElement,
  presentedCitationEqual,
} from "@/services/citation-text/present";
import type {
  DocumentCitations,
  PresentedCitation,
} from "@/services/citation-text/present";
import type { NavigationPane } from "@/services/citekey-navigation";
import type { Held } from "@/services/query-client/service";

import { citekeyDecorationsChanged } from "./extension";

const logger = getLogger("citekey-editor");

/** The Annotation one Durable Annotation Link names, by bare keys. */
export type DurableAnnotationLink = AnnotationOpenUriOptions;

export interface AnnotationLinkHoverHandlers {
  /** Show the popover of one hovered Durable Annotation Link. */
  showAnnotation: (request: AnnotationHoverRequest) => void;
  /**
   * Whether Live Preview shows an Annotation Citation as its formatted text.
   * Read per decoration build.
   */
  showCitations: () => boolean;
  /**
   * The formatted citations held for one document, or null while none are —
   * decorations are built synchronously, so a link can only show text that is
   * already there, and until then it stays the link it is.
   */
  citationText: (path: string) => Held<DocumentCitations> | null;
  /** Opens the Literature Note of the Item `indexedKey`. */
  openItem: (indexedKey: string, pane: NavigationPane) => void;
}

/**
 * Obsidian's classes for a Markdown link's text and its URL. A link written in
 * code, math, or a comment carries neither, so only a link Obsidian itself
 * draws as one is hovered.
 */
const LINK_SELECTOR = ".cm-link, .cm-url";

/** The one element wrapping a whole Durable Annotation Link, `[` to `)`. */
const LINK_CLASS = "zt-annotation-link";

/** The element an Annotation Citation shows its formatted text in. */
const CITATION_CLASS = "zt-annotation-citation";

const linkMark = Decoration.mark({ class: LINK_CLASS });

/**
 * Shows the Annotation a hovered Durable Annotation Link names, in Live
 * Preview and Source mode alike.
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
    annotationCitationWidgets(handlers),
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

/**
 * Shows each Annotation Citation in the visible lines of a Live Preview editor
 * as the text a style formatted for it — the parent Item's citation, located
 * by the Annotation's page — where the settings ask for it.
 *
 * A link the selection touches shows its Markdown, as every replaced
 * Citation does, and so does a link with no text held for it yet. A click on
 * the citation follows the link, as a click on the link itself does.
 */
function annotationCitationWidgets(handlers: AnnotationLinkHoverHandlers) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = citationWidgets(view, handlers);
      }

      update(update: ViewUpdate): void {
        const tree = syntaxTree(update.state);
        // As for the Pandoc Citation widgets: a short tree, a composition, or
        // a held mouse keeps the mapped set until the next update.
        if (
          tree.length < update.view.viewport.to ||
          update.view.composing ||
          update.view.plugin(livePreviewState)?.mousedown
        ) {
          if (update.docChanged)
            this.decorations = this.decorations.map(update.changes);
          return;
        }
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          update.focusChanged ||
          tree !== syntaxTree(update.startState) ||
          livePreviewOf(update.state) !== livePreviewOf(update.startState) ||
          update.transactions.some((tr) =>
            tr.effects.some((effect) => effect.is(citekeyDecorationsChanged)),
          )
        ) {
          this.decorations = citationWidgets(update.view, handlers);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      // Cursor motion steps over a citation in one go, and backspace removes
      // the link it shows whole.
      provide: (plugin) =>
        EditorView.atomicRanges.of(
          (view) => view.plugin(plugin)?.decorations ?? Decoration.none,
        ),
    },
  );
}

function citationWidgets(
  view: EditorView,
  handlers: AnnotationLinkHoverHandlers,
): DecorationSet {
  const held = heldCitations(view, handlers);
  if (held === null) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  // A blurred editor conceals everything, the way Obsidian's own live preview
  // reads its selection.
  const selection = view.hasFocus ? view.state.selection.ranges : [];
  for (const range of visibleLineRanges(view)) {
    for (const span of annotationLinksIn(view.state, range)) {
      if (overlapsSelection(selection, span.from, span.to)) continue;
      const content = annotationCitationContent(view.state, span, held);
      if (content === null) continue;
      builder.add(
        span.from,
        span.to,
        Decoration.replace({
          widget: new AnnotationCitationWidget(span.url, content),
        }),
      );
    }
  }
  return builder.finish();
}

/**
 * The citations held for the document a Live Preview editor shows, or null
 * where no Annotation Citation shows as one: the setting is off, the editor
 * shows Source mode, or no text is held yet.
 */
function heldCitations(
  view: EditorView,
  handlers: AnnotationLinkHoverHandlers,
): DocumentCitations | null {
  if (!handlers.showCitations() || !livePreviewOf(view.state)) return null;
  const file = view.state.field(editorInfoField, false)?.file;
  if (!file) return null;
  return handlers.citationText(file.path)?.value ?? null;
}

/**
 * The text formatted for the Annotation Citation `span` writes, or null where
 * the link is no Annotation Citation: it has text, or the Document Citation
 * Set leaves it out.
 */
function annotationCitationContent(
  state: EditorState,
  span: AnnotationLinkSpan,
  citations: DocumentCitations,
): PresentedCitation | null {
  if (!span.empty) return null;
  return citationContent(
    { source: state.sliceDoc(span.from, span.to), keys: [] },
    citations,
    { kind: "offset", start: span.from },
  );
}

/**
 * One Annotation Citation shown as the text a style formatted for it.
 *
 * The widget carries the link's wrapper class, so the hover reads it as the
 * link it stands for. CodeMirror ignores every event in it but that hover; a
 * click follows the link the way Obsidian follows one it draws, through
 * `window.open`.
 */
class AnnotationCitationWidget extends WidgetType {
  readonly #url;
  readonly #content;

  constructor(url: string, content: PresentedCitation) {
    super();
    this.#url = url;
    this.#content = content;
  }

  eq(other: AnnotationCitationWidget): boolean {
    return (
      other.#url === this.#url &&
      presentedCitationEqual(other.#content, this.#content)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    // Drawn as a rendered Pandoc Citation is: the citation key hook carries
    // the link appearance.
    const element = citationElement(view.dom.ownerDocument, this.#content, [
      themeHook.citationKey,
      LINK_CLASS,
      CITATION_CLASS,
    ]);
    const follow = (event: MouseEvent, pane: NavigationPane): void => {
      event.preventDefault();
      // oxlint-disable-next-line no-restricted-globals -- File Link Capture patches this global, which every link Obsidian follows reaches.
      window.open(this.#url, typeof pane === "string" ? pane : undefined);
    };
    element.addEventListener("click", (event) => {
      if (event.button === 0) follow(event, Keymap.isModEvent(event));
    });
    element.addEventListener("auxclick", (event) => {
      if (event.button === 1) follow(event, "tab");
    });
    return element;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== "mouseover";
  }
}

function hoverAt(
  event: MouseEvent,
  view: EditorView,
  handlers: AnnotationLinkHoverHandlers,
): void {
  const targetEl = linkElementAt(event);
  if (targetEl === null) return;
  const span = annotationLinkSpanAt(view.state, view.posAtDOM(targetEl));
  if (span === null) return;
  const { link } = span;

  const editorMode = view.dom.closest(".is-live-preview")
    ? "live-preview"
    : "source";
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
    open: handlers.openItem,
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
  if (
    target.closest(LINK_SELECTOR) === null &&
    target.closest(`.${CITATION_CLASS}`) === null
  )
    return null;
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
  return annotationLinkSpanAt(state, pos)?.link ?? null;
}

/** {@link annotationLinkAtPos}, with the whole span of the link it finds. */
function annotationLinkSpanAt(
  state: EditorState,
  pos: number,
): AnnotationLinkSpan | null {
  const line = state.doc.lineAt(pos);
  return (
    annotationLinksIn(state, line).findLast(
      ({ from, to }) => from <= pos && pos <= to,
    ) ?? null
  );
}

/** One Durable Annotation Link, spanning `[` to `)`. */
interface AnnotationLinkSpan extends DocRange {
  link: DurableAnnotationLink;
  /** The URL the link follows. */
  url: string;
  /** Whether the link has no text, which is what an Annotation Citation writes. */
  empty: boolean;
}

/** The Durable Annotation Links among the inline Markdown links of `range`. */
function annotationLinksIn(
  state: EditorState,
  range: DocRange,
): AnnotationLinkSpan[] {
  return markdownLinks(tokenNodes(state, range)).flatMap(
    ({ from, to, url, empty }) => {
      const link = parseAnnotationOpenUri(url);
      return link === null ? [] : [{ from, to, link, url, empty }];
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
): { from: number; to: number; url: string; empty: boolean }[] {
  const links: { from: number; to: number; url: string; empty: boolean }[] = [];
  let run: {
    from: number;
    /** Where the next node of the run must start. */
    at: number;
    phase: "text" | "closed" | "url";
    url: string;
    /** Whether the run opened on `[]`, which has no text. */
    empty: boolean;
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
        links.push({ from: run.from, to, url: run.url, empty: run.empty });
        run = null;
        continue;
      } else if (classes.includes(TOKEN_URL)) {
        run.url += text;
        continue;
      }
    }
    run =
      bracket && (text === "[" || text === "[]")
        ? {
            from,
            at: to,
            phase: text === "[" ? "text" : "closed",
            url: "",
            empty: text === "[]",
          }
        : null;
  }
  return links;
}
