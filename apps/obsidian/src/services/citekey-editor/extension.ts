// The CodeMirror side of the citekey editor treatment: citekey marks and
// citation widgets over the visible ranges, the lookup that answers which
// citekey covers a document position, the click that opens the marked key's
// Literature Note, and the hover that shows its entry. Wherever a Citation does
// not open as a link, a plain click on its widget stays the editor's own and
// places the caret in the source the widget hides.

import {
  lineClassNodeProp,
  syntaxTree,
  tokenClassNodeProp,
} from "@codemirror/language";
import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { editorInfoField, livePreviewState } from "obsidian";
import type { TFile } from "obsidian";

import { livePreviewOf, overlapsSelection } from "@/lib/editor-decoration";
import { getLogger } from "@/lib/log";
import { themeHook } from "@/lib/theme-hooks";
import {
  citationContent,
  citationElement,
  citedWorks,
  literalSummaryOf,
  unresolvedKeys,
} from "@/services/citation-text/present";
import type {
  CitationCoordinate,
  DocumentCitations,
  PresentedCitation,
  ShownCitation,
} from "@/services/citation-text/present";
import {
  attachCitationNavigation,
  attachClosedCitationGestures,
  citationHoverIntent,
  hoverGesture,
  markCitationClick,
  mouseGesture,
  navigationIntent,
  triggerCitekeyHover,
} from "@/services/citekey-navigation";
import type {
  CitationHoverRequest,
  CitationNavigation,
  CitedWork,
  EditorMode,
  HoverPreferences,
  NavigationPane,
} from "@/services/citekey-navigation";

import {
  citationRanges,
  citekeyMarks,
  FOOTNOTE_WIDGET_CLASS,
  isExcludedTokenClass,
  isFootnoteTokenClass,
  marksOutside,
  resolveCitekeyMarks,
} from "./decorate";
import type { CitationRange } from "./decorate";
import "./style.css";

const logger = getLogger("citekey-editor");

/** Opens the Literature Note of `citekey`, creating it when none exists yet. */
export type OpenCitekey = (citekey: string, pane: NavigationPane) => void;

/**
 * The Item a citekey names — read synchronously from the Citation Index's
 * resolution snapshot.
 *
 * @returns the Item's Indexed Key, which is the identity a work is joined to
 *   its entry by, or null for a key naming no live Zotero Item.
 */
export type ResolveCitekey = (citekey: string) => string | null;

/**
 * The resolution state the page preview branch reads.
 *
 * @returns the vault path of the one Literature Note `citekey` names, or null
 *   when zero or several name it.
 */
export type ResolveHoverNote = (citekey: string) => string | null;

export interface CitekeyEditorHandlers {
  open: OpenCitekey;
  /** Show the Citation Popover of one hovered citation. */
  showPopover: (request: CitationHoverRequest) => void;
  /** What hover answers with, read once per hover. */
  hoverPreferences: () => HoverPreferences;
  hoverNotePath: ResolveHoverNote;
  resolveCitekey: ResolveCitekey;
  /** Whether literal Citations expose ZotLit navigation. */
  navigationEnabled: () => boolean;
  /** Whether Live Preview replaces complete Citations with formatted text. */
  showFormatted: () => boolean;
  /**
   * The formatted citations held for one document, or null while none are —
   * decorations are built synchronously, so a widget can only show text that is
   * already there.
   */
  citationText: (path: string) => DocumentCitations | null;
  /** Asks for a document's citations, so a later rebuild finds them held. */
  requestCitationText: (file: TFile) => void;
}

/**
 * Dispatched by the citekey editor service whenever something outside the
 * document changed what these decorations should say — a citekey's resolution,
 * or the citation text a widget shows. Both invalidations are coarse, so this
 * one effect asks for a rebuild rather than naming what it touched.
 */
export const citekeyDecorationsChanged = StateEffect.define<void>();

/**
 * `cm-underline` is Obsidian's own link-text class: it draws the link
 * decoration line and, together with the plugin's cursor rule, gives a
 * recognized citekey the affordance of an internal link.
 */
const MARK_CLASS = `cm-underline ${themeHook.citationKey}`;

/** A citekey with no indexed Literature Note: a broken reference. */
const UNRESOLVED_MARK_CLASS = `${MARK_CLASS} ${themeHook.citationKeyUnresolved}`;

/**
 * What a plain click on a marked citekey reaches wherever Citations stay closed
 * as links: the caret, in both editor modes. The mark says so the same way a
 * rendered Citation does, which is what its cursor and its hover colour are
 * drawn from.
 *
 * @see markCitationClick
 */
const EDIT_ATTRIBUTES = { "data-zt-click": "edit" };

/**
 * The marks of one resolution state, in the two states Citekey Navigation
 * leaves a citekey in. A citekey that opens on click carries the link
 * affordance whole and states nothing further.
 */
const CITEKEY_MARKS = {
  open: {
    resolved: Decoration.mark({ class: MARK_CLASS }),
    unresolved: Decoration.mark({ class: UNRESOLVED_MARK_CLASS }),
  },
  edit: {
    resolved: Decoration.mark({
      class: MARK_CLASS,
      attributes: EDIT_ATTRIBUTES,
    }),
    unresolved: Decoration.mark({
      class: UNRESOLVED_MARK_CLASS,
      attributes: EDIT_ATTRIBUTES,
    }),
  },
} as const;

/** What the decoration pass produced, kept apart so the widgets can be atomic. */
interface CitekeyDecorations {
  /** The marks and the widgets together, which is what the editor draws. */
  all: DecorationSet;
  /** The widgets alone, which cursor motion treats as atoms. */
  widgets: DecorationSet;
}

/**
 * Marks every recognized `@citekey` in the visible ranges and replaces each
 * Citation with its formatted text in Live Preview. Navigation handlers apply
 * independently when their setting is enabled.
 *
 * Marks and widgets are provided from a view plugin, which the CodeMirror
 * provisioning rule allows because nothing here changes the vertical block
 * structure. Obsidian's own clickable-token machinery never sees a citekey —
 * its Markdown mode emits no token for one — so the click and hover paths are
 * the plugin's own.
 */
export function citekeyEditorExtension(
  handlers: CitekeyEditorHandlers,
): Extension {
  return ViewPlugin.fromClass(
    class CitekeyEditorPlugin {
      decorations: DecorationSet = Decoration.none;
      /** The widget ranges, which {@link EditorView.atomicRanges} reads. */
      widgets: DecorationSet = Decoration.none;

      constructor(view: EditorView) {
        this.#rebuild(view);
      }

      update(update: ViewUpdate): void {
        // Obsidian freezes its own live-preview decorations while the mouse is
        // down, so a drag-selection never moves the text under the pointer;
        // the frozen set is mapped through the changes instead.
        if (update.view.plugin(livePreviewState)?.mousedown) {
          if (update.docChanged) {
            this.decorations = this.decorations.map(update.changes);
            this.widgets = this.widgets.map(update.changes);
          }
          return;
        }
        if (
          update.docChanged ||
          update.viewportChanged ||
          // A widget hides its Citation's source, so every selection and focus
          // change decides again which Citations show raw text.
          update.selectionSet ||
          update.focusChanged ||
          syntaxTree(update.state) !== syntaxTree(update.startState) ||
          livePreviewOf(update.state) !== livePreviewOf(update.startState) ||
          update.transactions.some((tr) =>
            tr.effects.some((effect) => effect.is(citekeyDecorationsChanged)),
          )
        ) {
          this.#rebuild(update.view);
        }
      }

      /**
       * @returns whether the citekey under the pointer was opened, which also
       *   tells CodeMirror to stop handling the event.
       */
      openAt(event: MouseEvent, view: EditorView): boolean {
        if (!handlers.navigationEnabled()) return false;
        // A widget runs its own handlers on its own element, so this delegated
        // one leaves everything the widget covers to it.
        if (citationElementAt(event) !== null) return false;

        const editorMode = editorModeOf(view);
        // A drag that ended on a citekey is a selection, not a click. Source
        // mode still lets a modifier click through: Shift-click extends the
        // selection on mousedown, and native links navigate regardless.
        if (!view.state.selection.main.empty && editorMode === "live-preview")
          return false;
        const citekey = citekeyAtEvent(view, event);
        if (citekey === null) return false;

        const gesture = mouseGesture(event, "click", {
          surface: "editor",
          editorMode,
        });
        const { button, mod } = gesture;
        const intent = navigationIntent(gesture, {
          resolution: "open-or-create",
          citekey,
        });
        if (intent.kind !== "open") {
          // A Source-mode plain click falls through to CodeMirror's caret
          // placement; every other non-open intent means this shell does not
          // handle the gesture yet.
          logger.debug("Citekey click not followed", {
            citekey,
            editorMode,
            button,
            mod,
            intent: intent.kind,
          });
          return false;
        }
        logger.debug("Citekey click opens note", {
          citekey,
          editorMode,
          button,
          mod,
          pane: intent.pane,
        });

        event.preventDefault();
        handlers.open(citekey, intent.pane);
        return true;
      }

      /**
       * Shows what the Hover Action asks of the marked citekey under the
       * pointer — the surface a Citation keeps wherever its source text stays
       * visible. The Hover Action alone owns this result, so it answers
       * wherever the treatment marks a citekey.
       */
      hoverAt(event: MouseEvent, view: EditorView): void {
        // A widget hovers on its own element, and its formatted text carries
        // the citekey hook too, so this delegated handler leaves it alone.
        if (citationElementAt(event) !== null) return;
        const targetEl = citekeyElementAt(event);
        if (targetEl === null) return;

        const citekey = citekeyAtEvent(view, event);
        if (citekey === null) return;

        const editorMode = editorModeOf(view);
        const intent = citationHoverIntent(
          hoverGesture(event, { surface: "editor", editorMode }),
          handlers.hoverPreferences(),
          [citekey],
        );
        if (intent.kind === "nothing") {
          logger.trace("Citekey hover suppressed", {
            citekey,
            editorMode,
            reason: intent.reason,
          });
          return;
        }

        const info = view.state.field(editorInfoField, false);
        if (!info) return;

        if (intent.kind === "page-preview") {
          // A key naming zero or several notes previews nothing, so no popover
          // path can reach the create-then-open flow.
          const notePath = handlers.hoverNotePath(intent.citekey);
          if (notePath === null) {
            logger.trace("Citekey hover suppressed", {
              citekey,
              editorMode,
              reason: "no-note",
            });
            return;
          }
          logger.trace("Citekey hover previews note", {
            citekey,
            editorMode,
            path: notePath,
          });
          triggerCitekeyHover(info.app.workspace, {
            event,
            hoverParent: info,
            targetEl,
            linktext: notePath,
            sourcePath: info.file?.path ?? "",
          });
          return;
        }

        logger.trace("Citekey shows its entry", { citekey, editorMode });
        handlers.showPopover({
          event,
          hoverParent: info,
          targetEl,
          sourcePath: info.file?.path ?? "",
          works: intent.citekeys.map((key) => ({
            citekey: key,
            indexedKey: handlers.resolveCitekey(key) ?? undefined,
          })),
          open: handlers.open,
        });
      }

      /**
       * The Citations of the document this editor shows, or null when none can
       * be shown yet: Source mode keeps raw text, a view with no file has no
       * document to read, and a read still running leaves the marked source in
       * place until it settles.
       */
      #editedDocument(view: EditorView): EditedDocument | null {
        if (!handlers.showFormatted()) return null;
        if (!livePreviewOf(view.state)) return null;
        const file = view.state.field(editorInfoField, false)?.file;
        if (!file) return null;
        const held = handlers.citationText(file.path);
        if (held === null) {
          handlers.requestCitationText(file);
          return null;
        }
        return { citations: held, path: file.path };
      }

      #rebuild(view: EditorView): void {
        const built = buildDecorations(
          view,
          handlers,
          this.#editedDocument(view),
        );
        this.decorations = built.all;
        this.widgets = built.widgets;
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      // Cursor motion steps over a widget in one go, and backspace removes the
      // Citation it hides whole, rather than entering text that is not shown.
      provide: (plugin) =>
        EditorView.atomicRanges.of(
          (view) => view.plugin(plugin)?.widgets ?? Decoration.none,
        ),
      eventHandlers: {
        click(event, view) {
          if (event.button !== 0) return false;
          return this.openAt(event, view);
        },
        // Obsidian reads middle-click off `mousedown`; `click` never fires for it.
        mousedown(event, view) {
          if (event.button !== 1) return false;
          return this.openAt(event, view);
        },
        mouseover(event, view) {
          this.hoverAt(event, view);
          return false;
        },
      },
    },
  );
}

/** The document an editor shows, with the citation text held for it. */
interface EditedDocument {
  citations: DocumentCitations;
  path: string;
}

/**
 * One Citation shown as the text a style formatted.
 *
 * Two widgets are the same when they stand for the same source and show the
 * same content: formatted content is the immutable value the document's held
 * citations carry, so the comparison is a reference test and a fresh read of
 * that document is a fresh value that redraws.
 */
class CitationWidget extends WidgetType {
  readonly #source;
  readonly #content;
  readonly #shown;
  readonly #works;
  readonly #sourcePath;
  readonly #handlers;
  readonly #themeClasses;
  readonly #footnote;
  readonly #navigable;

  constructor(options: {
    source: string;
    content: PresentedCitation;
    /** Which occurrence the widget stands for, read again on every popover read. */
    shown: ShownCitation;
    works: readonly CitedWork[];
    sourcePath: string;
    handlers: CitekeyEditorHandlers;
    themeClasses: readonly string[];
    /** Whether the Citation is written inside a footnote. */
    footnote: boolean;
    /** Whether the Citation opens on click, which Citekey Navigation owns. */
    navigable: boolean;
  }) {
    super();
    this.#source = options.source;
    this.#content = options.content;
    this.#shown = options.shown;
    this.#works = options.works;
    this.#sourcePath = options.sourcePath;
    this.#handlers = options.handlers;
    this.#themeClasses = options.themeClasses;
    this.#footnote = options.footnote;
    this.#navigable = options.navigable;
  }

  eq(other: CitationWidget): boolean {
    return (
      other.#source === this.#source &&
      other.#content === this.#content &&
      other.#navigable === this.#navigable &&
      other.#footnote === this.#footnote
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = citationElement(view.dom.ownerDocument, this.#content, [
      themeHook.citationKey,
      ...this.#themeClasses,
      ...(this.#footnote ? [FOOTNOTE_WIDGET_CLASS] : []),
    ]);
    const navigation: CitationNavigation = {
      works: this.#works,
      // The occurrence this widget stands in the citation's place, which is
      // where a note-class style's own note text is read from, however often
      // the popover reads it again.
      shown: this.#shown,
      where: { surface: "editor", editorMode: "live-preview" },
      open: this.#handlers.open,
      showPopover: this.#handlers.showPopover,
      hoverPreferences: this.#handlers.hoverPreferences,
      hoverNotePath: this.#handlers.hoverNotePath,
      hoverTarget: () => {
        const info = view.state.field(editorInfoField, false);
        return info
          ? {
              workspace: info.app.workspace,
              hoverParent: info,
              sourcePath: this.#sourcePath,
            }
          : null;
      },
    };
    // The Hover Action owns hover on every rendered citation. A plain click is
    // Citekey Navigation's where it opens the work the citation names, and the
    // editor's own where it does not: the caret lands in the source this widget
    // stands in place of, and the Citation is written again as raw text.
    markCitationClick(element, this.#navigable ? "open" : "edit");
    if (this.#navigable) attachCitationNavigation(element, navigation);
    else attachClosedCitationGestures(element, navigation);
    return element;
  }

  /** The widget owns every gesture on its own element. */
  ignoreEvent(): boolean {
    return true;
  }
}

/** One decoration of a line, before the whole line is sorted into the builder. */
interface PlacedDecoration {
  from: number;
  to: number;
  decoration: Decoration;
  /** Whether it replaces a Citation, which also makes its range atomic. */
  replaces: boolean;
}

function buildDecorations(
  view: EditorView,
  handlers: CitekeyEditorHandlers,
  edited: EditedDocument | null,
): CitekeyDecorations {
  const all = new RangeSetBuilder<Decoration>();
  const widgets = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const marksOf = CITEKEY_MARKS[handlers.navigationEnabled() ? "open" : "edit"];
  // A blurred editor conceals everything, the way Obsidian's own live preview
  // reads its selection.
  const selection = view.hasFocus ? state.selection.ranges : [];
  let lastLineFrom = -1;
  for (const range of view.visibleRanges) {
    for (let pos = range.from; pos <= range.to; ) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      // A line straddling two visible ranges is offered twice; decorate it once.
      if (line.from === lastLineFrom) continue;
      lastLineFrom = line.from;

      const isRuledOut = (span: { start: number; end: number }): boolean =>
        isExcluded(state, line.from + span.start, line.from + span.end);

      const replaced: CitationRange[] = [];
      const placed: PlacedDecoration[] = [];
      if (edited !== null) {
        for (const citation of citationRanges(line.text, isRuledOut)) {
          const from = line.from + citation.start;
          const to = line.from + citation.end;
          if (overlapsSelection(selection, from, to)) continue;
          const widget = citationWidget({
            citation,
            start: from,
            edited,
            handlers,
            footnote: statesFootnoteTreatment(state, from, to),
          });
          if (widget === null) continue;
          replaced.push(citation);
          placed.push({
            from,
            to,
            decoration: Decoration.replace({ widget }),
            replaces: true,
          });
        }
      }

      const marks = resolveCitekeyMarks(
        marksOutside(citekeyMarks(line.text, isRuledOut), replaced),
        (citekey) => handlers.resolveCitekey(citekey) !== null,
      );
      for (const mark of marks) {
        placed.push({
          from: line.from + mark.start,
          to: line.from + mark.end,
          decoration: mark.resolved ? marksOf.resolved : marksOf.unresolved,
          replaces: false,
        });
      }

      // Marks never fall inside a widget's range, so ordering by start alone
      // gives the builder the sorted, non-overlapping ranges it requires.
      placed.sort((a, b) => a.from - b.from);
      for (const { from, to, decoration, replaces } of placed) {
        all.add(from, to, decoration);
        if (replaces) widgets.add(from, to, decoration);
      }
    }
  }
  return { all: all.finish(), widgets: widgets.finish() };
}

/**
 * @returns the widget for one Citation. An unresolved Citation keeps its
 *   source text and error hook, without navigation handlers.
 */
function citationWidget(options: {
  citation: CitationRange;
  /** Document offset the Citation starts at, which picks out its occurrence. */
  start: number;
  edited: EditedDocument;
  handlers: CitekeyEditorHandlers;
  /** Whether the Citation is written inside a footnote. */
  footnote: boolean;
}): CitationWidget | null {
  const {
    citation,
    start,
    edited: { citations, path },
    handlers,
    footnote,
  } = options;
  const at: CitationCoordinate = { kind: "offset", start };
  const content = citationContent(citation, citations, at);
  if (content === null) return null;
  const summaryOf = literalSummaryOf(citations);
  const unresolved = unresolvedKeys(citation, summaryOf);
  const themeClasses =
    unresolved === 0
      ? []
      : [
          unresolved === citation.keys.length
            ? themeHook.citationKeyUnresolved
            : themeHook.citationKeyPartiallyUnresolved,
        ];
  return new CitationWidget({
    source: citation.source,
    content,
    shown: { citation, at },
    works: citedWorks(citation, citations),
    sourcePath: path,
    handlers,
    themeClasses,
    footnote,
    navigable: handlers.navigationEnabled(),
  });
}

/**
 * Applies the same re-entry guard Obsidian runs before its own `hover-link`,
 * so moving within one mark fires a single hover.
 *
 * @returns the citekey mark the pointer entered, or null when the event lands
 *   on no mark or moves within the one it is already inside.
 */
function citekeyElementAt(event: MouseEvent): HTMLElement | null {
  const { target, relatedTarget } = event;
  if (!(target instanceof HTMLElement)) return null;
  const targetEl = target.closest<HTMLElement>(`.${themeHook.citationKey}`);
  if (targetEl === null) return null;
  if (relatedTarget instanceof Node && targetEl.contains(relatedTarget)) {
    return null;
  }
  return targetEl;
}

/** @returns the citation widget the event landed in, or null when it landed in none. */
function citationElementAt(event: MouseEvent): HTMLElement | null {
  const { target } = event;
  if (!(target instanceof HTMLElement)) return null;
  return target.closest<HTMLElement>(`.${themeHook.citation}`);
}

/** @returns the citekey under the pointer, or null when it covers none. */
function citekeyAtEvent(view: EditorView, event: MouseEvent): string | null {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return null;
  return citekeyAtPos(view.state, pos);
}

function editorModeOf(view: EditorView): EditorMode {
  return view.dom.closest(".is-live-preview") ? "live-preview" : "source";
}

/**
 * The citekey covering document position `pos` — the one lookup the click and
 * the palette commands share. `pos` counts as inside the key at either
 * boundary, the same `from <= pos && to >= pos` range test Obsidian runs on
 * its own tokens.
 *
 * @see Editor.getClickableTokenAt in Obsidian 1.13
 */
export function citekeyAtPos(state: EditorState, pos: number): string | null {
  const line = state.doc.lineAt(pos);
  const from = line.from;
  for (const mark of citekeyMarks(line.text, (span) =>
    isExcluded(state, from + span.start, from + span.end),
  )) {
    if (pos >= from + mark.start && pos <= from + mark.end) {
      return mark.citekey;
    }
  }
  return null;
}

/**
 * Whether a widget over `[from, to)` has to carry the footnote treatment
 * itself, which the range's own tokens decide.
 *
 * A node meeting the range only at a boundary describes the text beside it —
 * the `^[` opening an inline note is such a neighbor — so the range's own
 * tokens are the ones that overlap it. Of those, a footnote run reaching past
 * both ends is one CodeMirror wraps the replacement in, which passes the
 * treatment down on its own; the class would then shrink the same em-relative
 * step a second time. Every other footnote range leaves the replacement
 * outside the run, with nothing to inherit from.
 *
 * @see FOOTNOTE_WIDGET_CLASS
 */
function statesFootnoteTreatment(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  let inside = false;
  let wrapped = false;
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (wrapped) return false;
      if (node.to <= from || node.from >= to) return false;
      const classes = node.type.prop(tokenClassNodeProp);
      if (classes === undefined || !isFootnoteTokenClass(classes)) return true;
      inside = true;
      wrapped = node.from < from && node.to > to;
      return !wrapped;
    },
  });
  return inside && !wrapped;
}

/** Whether Obsidian's syntax tree classifies `[from, to)` as non-citation text. */
function isExcluded(state: EditorState, from: number, to: number): boolean {
  let excluded = false;
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (excluded) return false;
      const classes =
        node.type.prop(tokenClassNodeProp) ?? node.type.prop(lineClassNodeProp);
      if (classes !== undefined && isExcludedTokenClass(classes)) {
        excluded = true;
        return false;
      }
      return true;
    },
  });
  return excluded;
}
