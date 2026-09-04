// A CodeMirror pane bound to one slice of the master Profile document.

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { workbenchSlice } from "@zotlit/workbench/document";
import type {
  WorkbenchDocumentController,
  WorkbenchSliceId,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";
import { liquidMarkdown, yamlRule } from "@zotlit/workbench/language";

import { FIELD_TRIGGER } from "./fields";

/** The `{{` a reader just typed, in master offsets, with where it sits on screen. */
export interface FieldTrigger {
  readonly range: WorkbenchSliceRange;
  readonly left: number;
  readonly top: number;
}

/**
 * The text a pane holds: the note's own Liquid-in-Markdown, or the YAML a
 * Managed Frontmatter rule is written in. The `{{` accelerator belongs to
 * Liquid, so a rule pane offers the field list nowhere.
 */
export type SliceLanguage = "liquid" | "yaml";

export interface SliceEditorProps {
  controller: WorkbenchDocumentController;
  slice: WorkbenchSliceId;
  label: string;
  /** @default "liquid" */
  language?: SliceLanguage;
  /**
   * Master offsets to select and scroll to, so a problem opens on the text
   * that caused it. Each new object reveals again.
   */
  reveal?: WorkbenchSliceRange | null;
  /** The selection in master offsets, whenever it moves or the pane takes focus. */
  onSelection?: (selection: WorkbenchSliceRange) => void;
  /** A just-typed `{{`, so the host can offer the field list in its place. */
  onFieldTrigger?: (trigger: FieldTrigger) => void;
}

export function SliceEditor({
  controller,
  slice,
  label,
  language = "liquid",
  reveal,
  onSelection,
  onFieldTrigger,
}: SliceEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView>(null);
  // The view outlives every render, so it reads the current callbacks through
  // a ref instead of being rebuilt whenever the host passes new ones.
  const report = useRef({ onSelection, onFieldTrigger });
  report.current = { onSelection, onFieldTrigger };

  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: controller.sliceText(slice),
        extensions: [
          workbenchSlice(controller, slice),
          language === "yaml" ? yamlRule : liquidMarkdown,
          EditorView.lineWrapping,
          // The whole-file pane is the one place a reader counts lines, so the
          // gutter rides with Advanced alone.
          ...(slice === "advanced" ? [lineNumbers()] : []),
          EditorView.contentAttributes.of({ "aria-label": label }),
          EditorView.updateListener.of((update) => {
            if (!update.selectionSet && !update.focusChanged) return;
            const { from } = controller.sliceRange(slice);
            report.current.onSelection?.(sliceSelection(update.view, from));
            // A typed brace is the accelerator; a paste, an undo, or a
            // Backspace that lands after an existing `{{` is not.
            const typed =
              language === "liquid" &&
              update.transactions.some((transaction) =>
                transaction.isUserEvent("input.type"),
              );
            const trigger = typed ? fieldTriggerAt(update.view, from) : null;
            if (trigger) report.current.onFieldTrigger?.(trigger);
          }),
        ],
      }),
      parent: host.current!,
    });
    editor.current = view;
    // A pane mounts unfocused and sends no update, so it reports where its own
    // caret starts — the host follows the pane on screen, not the pane before it.
    report.current.onSelection?.(
      sliceSelection(view, controller.sliceRange(slice).from),
    );
    return () => {
      editor.current = null;
      view.destroy();
    };
  }, [controller, slice, label, language]);

  useEffect(() => {
    const view = editor.current;
    if (!view || !reveal) return;
    const { from } = controller.sliceRange(slice);
    const inSlice = (offset: number) =>
      Math.min(Math.max(offset - from, 0), view.state.doc.length);
    view.dispatch({
      selection: EditorSelection.range(
        inSlice(reveal.from),
        inSlice(reveal.to),
      ),
      scrollIntoView: true,
    });
    view.focus();
  }, [controller, slice, reveal]);

  return (
    <div
      ref={host}
      className="min-h-0 flex-1 overflow-auto [&_.cm-content]:font-mono [&_.cm-content]:text-[0.82rem] [&_.cm-editor]:h-full [&_.cm-editor.cm-focused]:outline-none [&_.cm-gutters]:border-fd-border [&_.cm-gutters]:bg-transparent [&_.cm-scroller]:leading-relaxed"
    />
  );
}

/** The pane's own selection in master offsets, which is what the host tracks. */
function sliceSelection(
  view: EditorView,
  sliceFrom: number,
): WorkbenchSliceRange {
  const { main } = view.state.selection;
  return { from: sliceFrom + main.from, to: sliceFrom + main.to };
}

/**
 * `{{` is the accelerator for the field list, so a just-typed one is reported
 * with the text it opened on and the place to draw the list.
 */
function fieldTriggerAt(
  view: EditorView,
  sliceFrom: number,
): FieldTrigger | null {
  const head = view.state.selection.main.head;
  const start = head - FIELD_TRIGGER.length;
  if (view.state.doc.sliceString(start, head) !== FIELD_TRIGGER) return null;
  const coords = view.coordsAtPos(head);
  return {
    range: { from: sliceFrom + start, to: sliceFrom + head },
    left: coords?.left ?? 0,
    top: coords?.bottom ?? 0,
  };
}
