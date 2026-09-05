// A CodeMirror pane bound to one slice of the master Profile document.

import { EditorSelection, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { workbenchSlice } from "@zotlit/workbench/document";
import type {
  WorkbenchDocumentController,
  WorkbenchSliceId,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";
import {
  liquidMarkdown,
  profileLanguage,
  embeddedLiquid,
  yamlRule,
} from "@zotlit/workbench/language";
import type { SuggestionSource } from "@zotlit/workbench/language";

import { webCompletion } from "./completion";
import { editorTheme } from "./editor-theme";
import { completionFields } from "./fields";
import { webHover } from "./hover";
import { tagDescription } from "./tag-help";

export type { SuggestionSource } from "@zotlit/workbench/language";

/** The expression pane edits a bare Liquid expression; the note includes Markdown. */
export type SliceLanguage = "liquid" | "yaml" | "expression";

export interface SliceEditorProps {
  controller: WorkbenchDocumentController;
  slice: WorkbenchSliceId;
  label: string;
  /** @default "liquid" */
  language?: SliceLanguage;
  /**
   * Refuses a line break. A pane over a manifest scalar — the note name is the
   * one — holds a value a break would end, taking the document with it.
   */
  singleLine?: boolean;
  /**
   * The host's own extensions over this pane — the boxes it draws on the text.
   * They are read once, when the view is built, so a caller keeps one value.
   */
  extensions?: Extension;
  /**
   * Master offsets to select and scroll to, so a problem opens on the text
   * that caused it. Each new object reveals again.
   */
  reveal?: WorkbenchSliceRange | null;
  /**
   * The contract this pane's completion and hover resolve against. It is read
   * per keystroke, so a pane that follows the caret into another root needs no
   * new editor. A rule pane holds YAML, where the Template contract says
   * nothing, so it offers neither.
   */
  suggest?: SuggestionSource;
  /** The selection in master offsets, whenever it moves or the pane takes focus. */
  onSelection?: (selection: WorkbenchSliceRange) => void;
  /** The pane took focus, so the host knows which editor the reader is in. */
  onFocus?: () => void;
}

export function SliceEditor({
  controller,
  slice,
  label,
  language = "liquid",
  singleLine = false,
  extensions,
  reveal,
  suggest,
  onSelection,
  onFocus,
}: SliceEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView>(null);
  // The view outlives every render, so it reads the current callbacks through
  // a ref instead of being rebuilt whenever the host passes new ones.
  const report = useRef({ onSelection, onFocus, suggest });
  report.current = { onSelection, onFocus, suggest };

  useEffect(() => {
    const read: SuggestionSource = (position) => {
      const sliceRange = controller.sliceRange(slice);
      const masterPosition = sliceRange.from + position;
      const region = controller.templateRegions.find(
        (region) =>
          masterPosition >= region.from && masterPosition <= region.to,
      );
      if (!region) return null;
      const { root, expression } = region;
      const supplied = report.current.suggest?.(masterPosition);
      return {
        partials: controller.dependencies,
        ...supplied,
        root,
        mode: expression ? "expression" : undefined,
        scope: {
          from: region.from - sliceRange.from,
          to: region.to - sliceRange.from,
        },
        fields: completionFields(root),
        tagDescription,
      };
    };
    const view = new EditorView({
      state: EditorState.create({
        doc: controller.sliceText(slice),
        extensions: [
          workbenchSlice(controller, slice),
          language === "yaml"
            ? yamlRule
            : slice === "advanced"
              ? profileLanguage
              : language === "expression"
                ? []
                : liquidMarkdown,
          ...(language === "expression"
            ? [
                embeddedLiquid((source) => [
                  { from: 0, to: source.length, expression: true },
                ]),
              ]
            : []),
          ...(slice === "advanced"
            ? [
                embeddedLiquid(() =>
                  controller.templateRegions.filter(
                    (region) => region.expression || region.root === "filename",
                  ),
                ),
              ]
            : []),
          editorTheme,
          ...(language === "yaml" ? [] : [webCompletion(read), webHover(read)]),
          ...(singleLine
            ? [
                EditorState.transactionFilter.of((transaction) =>
                  transaction.newDoc.lines > 1 ? [] : transaction,
                ),
              ]
            : []),
          EditorView.lineWrapping,
          // The whole-file pane is the one place a reader counts lines, so the
          // gutter rides with Advanced alone.
          ...(slice === "advanced" ? [lineNumbers()] : []),
          EditorView.contentAttributes.of({ "aria-label": label }),
          extensions ?? [],
          EditorView.updateListener.of((update) => {
            if (!update.selectionSet && !update.focusChanged) return;
            if (update.focusChanged && update.view.hasFocus) {
              report.current.onFocus?.();
            }
            const { from } = controller.sliceRange(slice);
            report.current.onSelection?.(sliceSelection(update.view, from));
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
  }, [controller, slice, label, language, singleLine, extensions]);

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
