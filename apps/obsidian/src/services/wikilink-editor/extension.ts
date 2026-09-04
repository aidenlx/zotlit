// The CodeMirror side of the Wikilink Editor Treatment: one replace decoration
// per Literature Note wikilink in the visible ranges, carrying the Citation
// Display Text and everything Obsidian's own rendering would have supplied, so
// drag, the context menu, and every click this treatment leaves alone keep
// running Obsidian's handlers — plus the two delegated listeners that hand the
// hover of a rendered Citation to the Citation Popover and its plain click to
// the caret.

import { syntaxTree, tokenClassNodeProp } from "@codemirror/language";
import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import { editorInfoField, livePreviewState } from "obsidian";

import { livePreviewOf } from "@/lib/editor-decoration";
import type { DocRange } from "@/lib/editor-decoration";
import type { Held } from "@/lib/held-reads";
import { themeHook } from "@/lib/theme-hooks";
import type { LiteratureNoteTarget } from "@/lib/wikilink-citation";
import {
  citationContent,
  showCitation,
} from "@/services/citation-text/present";
import type {
  CitationCoordinate,
  DocumentCitations,
  PresentedCitation,
  ShownCitation,
} from "@/services/citation-text/present";
import {
  clickWikilinkCitation,
  hoverWikilinkCitation,
  markCitationClick,
} from "@/services/citekey-navigation";
import type {
  CitationClickAffordance,
  CitationHover,
  CitationHoverRequest,
  HoveredWork,
  HoverPreferences,
  NavigationPane,
} from "@/services/citekey-navigation";

import { wikilinkDecorations } from "./decorate";
import type { WikilinkDecoration } from "./decorate";
import { scanWikilinks } from "./scan";
import type { TokenNode } from "./scan";
import "./style.css";

/**
 * Obsidian's own link-text class. Its live-preview click gate looks for it on
 * the event target's ancestor chain, and nothing of Obsidian's wraps a plugin
 * widget, so the widget carries it itself.
 *
 * @see docs/research/wikilink-display-decoration-interaction.md — section 2.5
 */
const UNDERLINE_CLASS = "cm-underline";

export interface WikilinkEditorHandlers {
  /**
   * The Literature Note `linkpath` names, seen from the document at
   * `sourcePath`, or null when it names none.
   */
  literatureNote: (
    linkpath: string,
    sourcePath: string,
  ) => LiteratureNoteTarget | null;
  /** Read once per decoration build to apply the source-membership choice. */
  enabled: () => boolean;
  /**
   * The formatted citations held for one document, or null while none are —
   * decorations are built synchronously, so a widget can only show text that is
   * already there, and until then it keeps native wikilink presentation.
   */
  citationText: (path: string) => Held<DocumentCitations> | null;
  /** The open-or-create flow every citation surface shares. */
  open: (citekey: string, pane: NavigationPane) => void;
  /** Show the Citation Popover of one hovered Citation. */
  showPopover: (request: CitationHoverRequest) => void;
  /** What hover answers with, read once per hover. */
  hoverPreferences: () => HoverPreferences;
  /**
   * Whether a rendered Citation carries the Citation Popover's own hover, which
   * is the one Hover Action this surface listens for a hover under at all.
   */
  popoverHover: () => boolean;
  /**
   * Whether a plain click on a rendered Citation places the caret in the
   * wikilink's own source instead of opening the note, which is what this
   * surface listens for a click under at all.
   */
  clickIntercepted: () => boolean;
}

/**
 * The Citation each rendered wikilink stands for, which the delegated hover
 * reads the hovered element back to.
 *
 * CodeMirror builds a widget's DOM again whenever the decoration is rebuilt, so
 * the element is the key and a dropped one is collected with its entry.
 */
const renderedCitations = new WeakMap<HTMLElement, RenderedWikilinkCitation>();

/** What one rendered wikilink Citation shows, and the works it names. */
interface RenderedWikilinkCitation {
  works: readonly HoveredWork[];
  /** The occurrence it stands for, which a note-class style's note is read from. */
  shown: ShownCitation;
}

/**
 * Dispatched by the wikilink editor service whenever something outside the
 * document changed what these decorations should say — a Literature Note
 * appearing, the Citation Index's resolution snapshot rebuilding, or the
 * source and display settings. Every such invalidation is
 * coarse, so this one effect asks for a rebuild rather than naming what it
 * touched.
 */
export const wikilinkDecorationsChanged = StateEffect.define<void>();

/**
 * Replaces the inner text of each Literature Note wikilink with its Citation
 * Display Text in Live Preview, hands the hover of such a Citation to the
 * Citation Popover under that Hover Action alone, and answers its plain click
 * with the caret wherever Citations stay closed as links.
 *
 * The decorations come from a view plugin, which the CodeMirror provisioning
 * rule allows because a wikilink never crosses a line and so no replacement
 * changes the block structure. Precedence stays default: nothing Obsidian draws
 * on a wikilink can wrap the replacement whatever the precedence, because the
 * exclusion is geometric — its marks cover exactly the replaced range — so the
 * widget supplies those classes itself instead.
 *
 * @see docs/research/wikilink-display-decoration-interaction.md — sections 1, 7
 */
export function wikilinkEditorExtension(
  handlers: WikilinkEditorHandlers,
): Extension {
  return ViewPlugin.fromClass(
    class WikilinkEditorPlugin {
      decorations: DecorationSet = Decoration.none;
      /** The tree the current set was built from, which gates the rebuild. */
      #tree;
      readonly #view;
      /**
       * The capture-phase listeners that answer a Citation's hover and its
       * plain click, each installed for as long as its own setting asks for it.
       *
       * They sit on the editor's own element rather than on each widget,
       * because CodeMirror builds widget DOM again on every rebuild. Capture is
       * what puts them ahead of the delegated `mouseover` and the bubbling
       * `click` Obsidian hangs above that same element, so a gesture this
       * surface answers reaches nothing else.
       *
       * @see docs/research/wikilink-display-decoration-interaction.md — section 2.1
       */
      readonly #listeners = new Map<GestureType, (event: MouseEvent) => void>();

      constructor(view: EditorView) {
        this.#view = view;
        this.#tree = syntaxTree(view.state);
        this.decorations = buildDecorations(view, handlers);
        this.#watchGestures();
      }

      destroy(): void {
        // Deleting the entry a Map iteration is on leaves the rest in place.
        for (const type of this.#listeners.keys()) {
          this.#remove(type);
        }
      }

      /**
       * Follows the settings that decide which of a Citation's gestures this
       * surface answers itself. Wherever one of them does not — the hover under
       * Off and Page preview, the click wherever Citations open as links — a
       * Literature Note wikilink keeps that gesture as the link it is, with no
       * code of the plugin's on it.
       */
      #watchGestures(): void {
        this.#watch("mouseover", handlers.popoverHover(), (event) => {
          hoverRenderedCitation(event, this.#view, handlers);
        });
        this.#watch("click", handlers.clickIntercepted(), (event) => {
          clickRenderedCitation(event, this.#view, handlers);
        });
      }

      /** Installs or removes one delegated listener, as `wanted` asks. */
      #watch(
        type: GestureType,
        wanted: boolean,
        answer: (event: MouseEvent) => void,
      ): void {
        const installed = this.#listeners.has(type);
        if (wanted === installed) return;
        if (installed) {
          this.#remove(type);
          return;
        }
        this.#view.dom.addEventListener(type, answer, true);
        this.#listeners.set(type, answer);
      }

      /** Removes one delegated listener, where one is installed. */
      #remove(type: GestureType): void {
        const installed = this.#listeners.get(type);
        if (installed === undefined) return;
        this.#view.dom.removeEventListener(type, installed, true);
        this.#listeners.delete(type);
      }

      update(update: ViewUpdate): void {
        this.#watchGestures();
        const tree = syntaxTree(update.state);
        // The stream parse stops just past the viewport, so a tree shorter than
        // the viewport has no nodes over part of it — rebuilding from it would
        // drop every link there and bring it back a tick later. Obsidian
        // freezes for the same reason during IME composition and while the
        // mouse is down, so a drag-selection never moves the text under the
        // pointer. In all three the mapped set stands in until the next update.
        if (
          tree.length < update.view.viewport.to ||
          update.view.composing ||
          update.view.plugin(livePreviewState)?.mousedown
        ) {
          if (update.docChanged) {
            this.decorations = this.decorations.map(update.changes);
          }
          return;
        }
        if (
          tree !== this.#tree ||
          update.docChanged ||
          update.viewportChanged ||
          // A widget hides the link's source, so every selection and focus
          // change decides again which links show raw text.
          update.selectionSet ||
          update.focusChanged ||
          livePreviewOf(update.state) !== livePreviewOf(update.startState) ||
          update.transactions.some((tr) =>
            tr.effects.some((effect) => effect.is(wikilinkDecorationsChanged)),
          )
        ) {
          this.#tree = tree;
          this.decorations = buildDecorations(update.view, handlers);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/** The gestures of a rendered Citation this surface answers itself. */
type GestureType = "mouseover" | "click";

/**
 * Answers the hover of the rendered Citation under the pointer, and leaves
 * every other hover in the editor to Obsidian.
 */
function hoverRenderedCitation(
  event: MouseEvent,
  view: EditorView,
  handlers: WikilinkEditorHandlers,
): void {
  const citation = renderedCitationAt(event, view, handlers);
  if (citation === null) return;
  hoverWikilinkCitation(event, citation.element, citation.hover);
}

/**
 * Answers the plain click of the rendered Citation under the pointer with the
 * caret, and leaves every other click in the editor to Obsidian.
 *
 * The caret goes where the click landed, which is what a click on any other
 * rendered Markdown does in Live Preview: the selection then overlaps the
 * replaced range, and the rebuild writes the wikilink back as source text to
 * edit. Obsidian's own handler would have opened the note, so the click is
 * stopped before it and the caret placed here in its place.
 */
function clickRenderedCitation(
  event: MouseEvent,
  view: EditorView,
  handlers: WikilinkEditorHandlers,
): void {
  const citation = renderedCitationAt(event, view, handlers);
  if (citation === null) return;
  clickWikilinkCitation(event, {
    where: citation.hover.where,
    edit: () => placeCaret(event, view),
  });
}

/** Places the caret where a click landed, and gives the editor the focus. */
function placeCaret(event: MouseEvent, view: EditorView): void {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return;
  view.dispatch({ selection: { anchor: pos } });
  view.focus();
}

/**
 * The rendered Citation one gesture landed on, as the Citation Popover
 * addresses it.
 *
 * @returns null when the gesture landed on anything else in the editor.
 */
function renderedCitationAt(
  event: MouseEvent,
  view: EditorView,
  handlers: WikilinkEditorHandlers,
): { element: HTMLElement; hover: CitationHover } | null {
  const { target } = event;
  if (!(target instanceof HTMLElement)) return null;
  const element = target.closest<HTMLElement>(
    `.${themeHook.literatureNoteLink}`,
  );
  const citation =
    element === null ? undefined : renderedCitations.get(element);
  if (element === null || citation === undefined) return null;

  return {
    element,
    hover: {
      works: citation.works,
      shown: citation.shown,
      // A widget is drawn in Live Preview alone, so that is the mode the
      // Require Mod gate of every hover on one is read for.
      where: { surface: "editor", editorMode: "live-preview" },
      open: handlers.open,
      showPopover: handlers.showPopover,
      hoverPreferences: handlers.hoverPreferences,
      hoverTarget: () => {
        const info = view.state.field(editorInfoField, false);
        return info
          ? {
              workspace: info.app.workspace,
              hoverParent: info,
              sourcePath: info.file?.path ?? "",
            }
          : null;
      },
    },
  };
}

/**
 * One decorated wikilink Citation, shown as the text a style formatted.
 *
 * The element carries exactly what Obsidian's own rendering would have put on
 * the replaced text: the `cm-*` classes of the token it stands for, the class
 * the click gate reads, and the `draggable` attribute that both clears the
 * structural gate around replaced widgets and gives drag something to latch
 * onto. No event handler of the plugin's sits on it — drag, the context menu,
 * and every click this treatment leaves alone reach Obsidian's own handlers,
 * which resolve the link from the document position rather than from the DOM,
 * and the two delegated listeners read the element back to the Citation it
 * stands for.
 *
 * A lone Citation therefore behaves exactly as it did before it was rendered,
 * bar the hover the Hover Action names and the plain click the caret answers
 * wherever Citations stay closed as links. A Citation Run is the one
 * narrowing:
 * its widget covers several links, and Obsidian's handlers read the position
 * its start maps to, so the whole run clicks and drags as the first work it
 * names. Its hover is the run's own: the popover stacks every work it names.
 *
 * @see docs/research/wikilink-display-decoration-interaction.md — sections 2, 2.5
 */
class CitationDisplayWidget extends WidgetType {
  readonly #content;
  readonly #shown;
  readonly #className;
  readonly #works;
  readonly #click;

  constructor(
    content: PresentedCitation,
    tokenClasses: readonly string[],
    options: {
      works: readonly HoveredWork[];
      /** Which occurrence the widget stands for, read again on every popover read. */
      shown: ShownCitation;
      /** What a plain left-click on the Citation does. */
      click: CitationClickAffordance;
    },
  ) {
    super();
    this.#content = content;
    this.#shown = options.shown;
    this.#works = options.works;
    this.#click = options.click;
    this.#className = [
      ...tokenClasses.map((name) => `cm-${name}`),
      UNDERLINE_CLASS,
      themeHook.citation,
      themeHook.literatureNoteLink,
    ].join(" ");
  }

  /**
   * Formatted content is the immutable value the document's held citations
   * carry, so the comparison is a reference test and a fresh read of that
   * document is a fresh value that redraws.
   */
  eq(other: CitationDisplayWidget): boolean {
    return (
      other.#content === this.#content &&
      other.#className === this.#className &&
      other.#click === this.#click
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = view.dom.win.createSpan();
    element.className = this.#className;
    element.tabIndex = -1;
    element.draggable = true;
    markCitationClick(element, this.#click);
    // The widget stands for a link Obsidian's own handlers navigate, so a link
    // the style wrote shows as the text it carries rather than as an anchor
    // that would take the gesture away from them.
    showCitation(element, this.#content, "suppress");
    renderedCitations.set(element, {
      works: this.#works,
      shown: this.#shown,
    });
    return element;
  }
}

function buildDecorations(
  view: EditorView,
  handlers: WikilinkEditorHandlers,
): DecorationSet {
  const { state } = view;
  const file = state.field(editorInfoField, false)?.file ?? null;
  const sourcePath = file?.path ?? "";
  const context = {
    literatureNote: (linkpath: string) =>
      handlers.literatureNote(linkpath, sourcePath),
    enabled: handlers.enabled(),
    selection: view.hasFocus ? state.selection.ranges : [],
    textBetween: (from: number, to: number) => state.doc.sliceString(from, to),
  };

  const spans = [];
  for (const range of visibleLineRanges(view)) {
    spans.push(...scanWikilinks(tokenNodes(state, range)));
  }
  // Live Preview replaces only links with complete formatted text. Source mode
  // and native Live Preview links keep Obsidian's presentation and classes.
  const decorations: WikilinkDecoration[] = livePreviewOf(state)
    ? wikilinkDecorations(spans, context)
    : [];
  if (decorations.length === 0) return Decoration.none;

  // Asked for only once a Citation is on screen, so a document that writes none
  // is never read. A document whose citations are not held yet keeps native
  // link presentation, and the read announces itself when it settles, which
  // brings the formatted text in without a document change.
  const citations = file === null ? null : handlers.citationText(file.path);

  // A Citation opens as the link it is wherever the plugin leaves its click
  // alone; where it does not, the click reaches the source instead.
  const click: CitationClickAffordance = handlers.clickIntercepted()
    ? "edit"
    : "open";
  const replacements =
    citations === null
      ? []
      : decorations.flatMap((candidate) => {
          const decoration = replacement(candidate, citations.value, click);
          return decoration === null
            ? []
            : [{ from: candidate.from, to: candidate.to, decoration }];
        });
  replacements.sort((a, b) => a.from - b.from);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, decoration } of replacements) {
    builder.add(from, to, decoration);
  }
  return builder.finish();
}

function replacement(
  decoration: WikilinkDecoration,
  citations: DocumentCitations,
  click: CitationClickAffordance,
): Decoration | null {
  const at: CitationCoordinate = { kind: "offset", start: decoration.start };
  const formatted = citationContent(decoration.citation, citations, at);
  if (formatted === null) return null;
  return Decoration.replace({
    widget: new CitationDisplayWidget(formatted, decoration.tokenClasses, {
      works: citedWorks(decoration),
      shown: { citation: decoration.citation, at },
      click,
    }),
  });
}

/**
 * The works one decorated Citation names, in the order it names them. The
 * derivation writes a key and an Indexed Key per work in that same order, so a
 * work reaches its entry by the Item it names rather than by its spelling.
 */
function citedWorks({ citation }: WikilinkDecoration): HoveredWork[] {
  return citation.keys.map(({ citekey }, at) => ({
    citekey,
    indexedKey: citation.works[at],
  }));
}

/**
 * The visible ranges widened to whole lines and merged, so a link straddling a
 * range edge is scanned once and in full. Wikilinks never cross a line, so
 * whole lines are enough, and the merge keeps the ranges disjoint and ordered —
 * which is what {@link RangeSetBuilder} requires of the additions built from
 * them.
 */
function visibleLineRanges(view: EditorView): DocRange[] {
  const { doc } = view.state;
  const ranges: DocRange[] = [];
  for (const range of view.visibleRanges) {
    const from = doc.lineAt(range.from).from;
    const to = doc.lineAt(range.to).to;
    const last = ranges.at(-1);
    if (last !== undefined && from <= last.to) last.to = Math.max(last.to, to);
    else ranges.push({ from, to });
  }
  return ranges;
}

/**
 * The token nodes of one region, in document order. Line-class nodes are left
 * out: they span a whole line and would break the node adjacency the scan reads
 * conceal groups from.
 */
function tokenNodes(state: EditorState, range: DocRange): TokenNode[] {
  const nodes: TokenNode[] = [];
  syntaxTree(state).iterate({
    from: range.from,
    to: range.to,
    enter(node) {
      const classes = node.type.prop(tokenClassNodeProp);
      if (classes === undefined) return;
      nodes.push({
        from: node.from,
        to: node.to,
        classes: classes.split(" "),
        text: state.doc.sliceString(node.from, node.to),
      });
    },
  });
  return nodes;
}
