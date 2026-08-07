// The CodeMirror side of the citekey editor treatment: citekey marks over the
// visible ranges, and the click that opens the marked key's Literature Note.

import {
  lineClassNodeProp,
  syntaxTree,
  tokenClassNodeProp,
} from "@codemirror/language";
import {
  RangeSetBuilder,
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
import { Keymap } from "obsidian";

import { getLogger } from "@/lib/log";
import {
  navigationIntent,
  type EditorMode,
  type NavigationPane,
} from "@/services/citekey-navigation";

import { citekeyMarks, isExcludedTokenClass } from "./decorate";
import "./style.css";

const logger = getLogger("citekey-editor");

/** Opens the Literature Note of `citekey`, creating it when none exists yet. */
export type OpenCitekey = (citekey: string, pane: NavigationPane) => void;

/**
 * `cm-underline` is Obsidian's own link-text class: it draws the link
 * decoration line and, together with the plugin's cursor rule, gives a
 * recognized citekey the affordance of an internal link.
 */
const MARK_CLASS = "cm-underline zt-citekey";

/** The `citekey` spec field the click handler reads back off a mark. */
interface CitekeyMarkSpec {
  citekey?: string;
}

/**
 * Marks every recognized `@citekey` in the visible ranges and makes it open its
 * Literature Note on click.
 *
 * Marks are provided from a view plugin, which the CodeMirror provisioning rule
 * allows because nothing here changes the vertical block structure. Obsidian's
 * own clickable-token machinery never sees a citekey — its Markdown mode emits
 * no token for one — so the click path is the plugin's own.
 */
export function citekeyEditorExtension(open: OpenCitekey): Extension {
  return ViewPlugin.fromClass(
    class CitekeyEditorPlugin {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildMarks(view);
      }

      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.viewportChanged ||
          syntaxTree(update.state) !== syntaxTree(update.startState)
        ) {
          this.decorations = buildMarks(update.view);
        }
      }

      /**
       * @returns whether the citekey under the pointer was opened, which also
       *   tells CodeMirror to stop handling the event.
       */
      openAt(event: MouseEvent, view: EditorView): boolean {
        const editorMode: EditorMode = view.dom.closest(".is-live-preview")
          ? "live-preview"
          : "source";
        // A drag that ended on a citekey is a selection, not a click. Source
        // mode still lets a modifier click through: Shift-click extends the
        // selection on mousedown, and native links navigate regardless.
        if (!view.state.selection.main.empty && editorMode === "live-preview")
          return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;

        let citekey: string | null = null;
        this.decorations.between(pos, pos, (_from, _to, mark) => {
          citekey = (mark.spec as CitekeyMarkSpec).citekey ?? null;
          return false;
        });
        if (citekey === null) return false;

        const button = event.button === 1 ? "middle" : "left";
        const mod = Keymap.isModifier(event, "Mod");
        const intent = navigationIntent(
          {
            action: "click",
            button,
            mod,
            shift: event.shiftKey,
            alt: event.altKey,
            editorMode,
            surface: "editor",
            pane: event.button === 1 ? "tab" : Keymap.isModEvent(event),
          },
          { resolution: "open-or-create", citekey },
        );
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
        open(citekey, intent.pane);
        return true;
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
      },
    },
  );
}

function buildMarks(view: EditorView): DecorationSet {
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

      const marks = citekeyMarks(line.text, (span) =>
        isExcluded(state, line.from + span.start, line.from + span.end),
      );
      for (const mark of marks) {
        builder.add(
          line.from + mark.start,
          line.from + mark.end,
          Decoration.mark({
            class: MARK_CLASS,
            citekey: mark.citekey,
          } satisfies CitekeyMarkSpec & { class: string }),
        );
      }
    }
  }
  return builder.finish();
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
