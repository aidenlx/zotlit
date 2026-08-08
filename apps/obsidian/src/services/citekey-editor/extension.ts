// The CodeMirror side of the citekey editor treatment: citekey marks and
// citation widgets over the visible ranges, the lookup that answers which
// citekey covers a document position, the click that opens the marked key's
// Literature Note, and the hover that previews it.

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
} from "@/services/citation-text/present";
import type { DocumentCitations } from "@/services/citation-text/present";
import {
  attachCitationNavigation,
  mouseGesture,
  navigationIntent,
  triggerCitekeyHover,
} from "@/services/citekey-navigation";
import type {
  CitedWork,
  EditorMode,
  NavigationPane,
} from "@/services/citekey-navigation";

import {
  citationRanges,
  citekeyMarks,
  isExcludedTokenClass,
  marksOutside,
  resolveCitekeyMarks,
} from "./decorate";
import type { CitationRange } from "./decorate";
import "./style.css";

const logger = getLogger("citekey-editor");

/** Opens the Literature Note of `citekey`, creating it when none exists yet. */
export type OpenCitekey = (citekey: string, pane: NavigationPane) => void;

/**
 * The resolution state hover reads.
 *
 * @returns the vault path of the one Literature Note `citekey` names, or null
 *   when zero or several name it.
 */
export type ResolveHoverNote = (citekey: string) => string | null;

/**
 * Whether a citekey names a live Zotero Item — read synchronously from the
 * Citation Index's resolution snapshot.
 */
export type ResolveCitekey = (citekey: string) => boolean;

export interface CitekeyEditorHandlers {
  open: OpenCitekey;
  hoverNotePath: ResolveHoverNote;
  resolves: ResolveCitekey;
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

const CITEKEY_MARK = Decoration.mark({ class: MARK_CLASS });

/** A citekey with no indexed Literature Note: a broken reference. */
const CITEKEY_MARK_UNRESOLVED = Decoration.mark({
  class: `${MARK_CLASS} ${themeHook.citationKeyUnresolved}`,
});

/** What the decoration pass produced, kept apart so the widgets can be atomic. */
interface CitekeyDecorations {
  /** The marks and the widgets together, which is what the editor draws. */
  all: DecorationSet;
  /** The widgets alone, which cursor motion treats as atoms. */
  widgets: DecorationSet;
}

/**
 * Marks every recognized `@citekey` in the visible ranges, replaces each
 * Citation with its formatted text in Live Preview, makes both open their
 * Literature Note on click, and previews that note on hover.
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
       * Asks the Page preview core plugin for the Literature Note of the
       * citekey under the pointer. Obsidian owns the Ctrl-gating and the
       * popover itself; this shell only names the source and the target.
       */
      hoverAt(event: MouseEvent, view: EditorView): void {
        const targetEl = citekeyElementAt(event);
        if (targetEl === null) return;

        const citekey = citekeyAtEvent(view, event);
        if (citekey === null) return;

        // A key naming zero or several notes reaches the intent module as an
        // unavailable target, which answers with no hover — so no popover can
        // reach the create-then-open flow.
        const notePath = handlers.hoverNotePath(citekey);
        const intent = navigationIntent(
          mouseGesture(event, "hover", {
            surface: "editor",
            editorMode: editorModeOf(view),
          }),
          notePath === null
            ? { resolution: "unavailable" }
            : { resolution: "direct", citekey },
        );
        // The second test repeats the target's own input so TypeScript sees
        // the path a `direct` resolution always carries.
        if (intent.kind !== "hover" || notePath === null) {
          logger.trace("Citekey hover suppressed", { citekey });
          return;
        }

        const info = view.state.field(editorInfoField, false);
        if (!info) return;
        logger.trace("Citekey hover previews note", {
          citekey,
          path: notePath,
        });
        triggerCitekeyHover(info.app.workspace, {
          event,
          hoverParent: info,
          targetEl,
          linktext: notePath,
          sourcePath: info.file?.path ?? "",
        });
      }

      /**
       * The Citations of the document this editor shows, or null when none can
       * be shown yet: Source mode keeps raw text, a view with no file has no
       * document to read, and a read still running leaves the marked source in
       * place until it settles.
       */
      #editedDocument(view: EditorView): EditedDocument | null {
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
 * One Citation shown as the text a style formatted, or — with no engine
 * installed — as the item summaries of the works it names.
 *
 * Two widgets are the same when they stand for the same source and show the
 * same content: formatted content is the very object the document's held
 * citations carry, so a fresh read of that document is a fresh object and
 * redraws, while summary text compares by value.
 */
class CitationWidget extends WidgetType {
  readonly #source;
  readonly #content;
  readonly #works;
  readonly #sourcePath;
  readonly #handlers;
  readonly #themeClasses;
  readonly #navigable;

  constructor(options: {
    source: string;
    content: DocumentFragment | string;
    works: readonly CitedWork[];
    sourcePath: string;
    handlers: CitekeyEditorHandlers;
    themeClasses: readonly string[];
    navigable: boolean;
  }) {
    super();
    this.#source = options.source;
    this.#content = options.content;
    this.#works = options.works;
    this.#sourcePath = options.sourcePath;
    this.#handlers = options.handlers;
    this.#themeClasses = options.themeClasses;
    this.#navigable = options.navigable;
  }

  eq(other: CitationWidget): boolean {
    return other.#source === this.#source && other.#content === this.#content;
  }

  toDOM(view: EditorView): HTMLElement {
    const element = citationElement(view.dom.ownerDocument, this.#content, [
      themeHook.citationKey,
      ...this.#themeClasses,
    ]);
    if (this.#navigable) {
      attachCitationNavigation(element, {
        works: this.#works,
        where: { surface: "editor", editorMode: "live-preview" },
        open: this.#handlers.open,
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
      });
    }
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
          const widget = citationWidget(citation, edited, handlers);
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
        handlers.resolves,
      );
      for (const mark of marks) {
        placed.push({
          from: line.from + mark.start,
          to: line.from + mark.end,
          decoration: mark.resolved ? CITEKEY_MARK : CITEKEY_MARK_UNRESOLVED,
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
function citationWidget(
  citation: CitationRange,
  { citations, path }: EditedDocument,
  handlers: CitekeyEditorHandlers,
): CitationWidget {
  const content = citationContent(citation, citations);
  const unresolved = citation.keys.filter(
    (key) => !citations.summaries.has(key.citekey),
  ).length;
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
    content: content ?? citation.source,
    works: citedWorks(citation, (citekey) => citations.summaries.get(citekey)),
    sourcePath: path,
    handlers,
    themeClasses,
    navigable: content !== null,
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
