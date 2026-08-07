// The CodeMirror side of the citekey editor treatment: citekey marks over the
// visible ranges, the lookup that answers which citekey covers a document
// position, the click that opens the marked key's Literature Note, and the
// hover that previews it.

import {
  lineClassNodeProp,
  syntaxTree,
  tokenClassNodeProp,
} from "@codemirror/language";
import {
  RangeSetBuilder,
  StateEffect,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { editorInfoField } from "obsidian";

import { getLogger } from "@/lib/log";
import {
  mouseGesture,
  navigationIntent,
  triggerCitekeyHover,
  type EditorMode,
  type NavigationPane,
} from "@/services/citekey-navigation";

import {
  citekeyMarks,
  isExcludedTokenClass,
  resolveCitekeyMarks,
} from "./decorate";
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
 * Whether a citekey names at least one Literature Note — the Citation Index's
 * lazy query, through the Citation Key Property.
 */
export type ResolveCitekey = (citekey: string) => boolean;

export interface CitekeyEditorHandlers {
  open: OpenCitekey;
  hoverNotePath: ResolveHoverNote;
  resolves: ResolveCitekey;
}

/**
 * Dispatched by the citekey editor service whenever the Note Index reports a
 * change that could flip a citekey's resolution — since index invalidation is
 * coarse, this effect is the external trigger the decoration layer rebuilds
 * from, rather than trying to track which citekeys the change touched.
 */
export const citekeyIndexChanged = StateEffect.define<void>();

/** The plugin's own class on every citekey mark, and the hover target. */
const CITEKEY_CLASS = "zt-citekey";

/**
 * `cm-underline` is Obsidian's own link-text class: it draws the link
 * decoration line and, together with the plugin's cursor rule, gives a
 * recognized citekey the affordance of an internal link.
 */
const MARK_CLASS = `cm-underline ${CITEKEY_CLASS}`;

const CITEKEY_MARK = Decoration.mark({ class: MARK_CLASS });

/** A citekey with no indexed Literature Note: a broken reference. */
const CITEKEY_MARK_UNRESOLVED = Decoration.mark({
  class: `${MARK_CLASS} ${CITEKEY_CLASS}-unresolved`,
});

/**
 * Marks every recognized `@citekey` in the visible ranges, makes it open its
 * Literature Note on click, and previews that note on hover.
 *
 * Marks are provided from a view plugin, which the CodeMirror provisioning rule
 * allows because nothing here changes the vertical block structure. Obsidian's
 * own clickable-token machinery never sees a citekey — its Markdown mode emits
 * no token for one — so the click and hover paths are the plugin's own.
 */
export function citekeyEditorExtension(
  handlers: CitekeyEditorHandlers,
): Extension {
  return ViewPlugin.fromClass(
    class CitekeyEditorPlugin {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildMarks(view, handlers.resolves);
      }

      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.viewportChanged ||
          syntaxTree(update.state) !== syntaxTree(update.startState) ||
          update.transactions.some((tr) =>
            tr.effects.some((effect) => effect.is(citekeyIndexChanged)),
          )
        ) {
          this.decorations = buildMarks(update.view, handlers.resolves);
        }
      }

      /**
       * @returns whether the citekey under the pointer was opened, which also
       *   tells CodeMirror to stop handling the event.
       */
      openAt(event: MouseEvent, view: EditorView): boolean {
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
    },
    {
      decorations: (plugin) => plugin.decorations,
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
  const targetEl = target.closest<HTMLElement>(`.${CITEKEY_CLASS}`);
  if (targetEl === null) return null;
  if (relatedTarget instanceof Node && targetEl.contains(relatedTarget)) {
    return null;
  }
  return targetEl;
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

function buildMarks(view: EditorView, resolves: ResolveCitekey): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  let lastLineFrom = -1;
  for (const range of view.visibleRanges) {
    for (let pos = range.from; pos <= range.to; ) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      // A line straddling two visible ranges is offered twice; mark it once.
      if (line.from === lastLineFrom) continue;
      lastLineFrom = line.from;

      const marks = resolveCitekeyMarks(
        citekeyMarks(line.text, (span) =>
          isExcluded(state, line.from + span.start, line.from + span.end),
        ),
        resolves,
      );
      for (const mark of marks) {
        builder.add(
          line.from + mark.start,
          line.from + mark.end,
          mark.resolved ? CITEKEY_MARK : CITEKEY_MARK_UNRESOLVED,
        );
      }
    }
  }
  return builder.finish();
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
