// A CodeMirror pane bound to one slice of the master Profile document.

import { EditorSelection, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";

import {
  workbenchSlice,
  jsonLayout,
  jsonPosition,
} from "@zotlit/workbench/document";
import type {
  WorkbenchDocumentController,
  WorkbenchSliceId,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";
import {
  liquidMarkdown,
  templatePairing,
  profileLanguage,
  embeddedLiquid,
  jsonRule,
  embeddedJsonE,
} from "@zotlit/workbench/language";
import type { SuggestionSource } from "@zotlit/workbench/language";

import { webCompletion } from "./completion";
import { editorTheme } from "./editor-theme";
import { completionFields } from "./fields";
import { webHover } from "./hover";
import { tagDescription } from "./tag-help";

export type { SuggestionSource } from "@zotlit/workbench/language";

/** The expression pane edits a bare Liquid expression; the note includes Markdown. */
export type SliceLanguage = "liquid" | "json-e" | "expression";

export interface SliceEditorProps {
  controller: WorkbenchDocumentController;
  slice: WorkbenchSliceId;
  label: string;
  invalid?: boolean;
  describedBy?: string;
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
  invalid = false,
  describedBy,
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
      const local =
        language === "json-e" && editor.current
          ? jsonPosition(
              editor.current.state.doc.toString(),
              controller.sliceText(slice),
              position,
            )
          : position;
      const masterPosition = sliceRange.from + local;
      const region = controller.templateRegions.find(
        (region) =>
          masterPosition >= region.from && masterPosition <= region.to,
      );
      if (!region && language !== "json-e") return null;
      const root = region?.root ?? "note";
      const expression = region?.expression ?? false;
      const supplied = report.current.suggest?.(masterPosition);
      return {
        partials: controller.dependencies,
        ...supplied,
        root,
        language: language === "json-e" ? "json-e" : region?.language,
        mode: expression ? "expression" : undefined,
        scope:
          language === "json-e"
            ? undefined
            : {
                from: region!.from - sliceRange.from,
                to: region!.to - sliceRange.from,
              },
        fields: completionFields(root),
        tagDescription,
      };
    };
    const view = new EditorView({
      state: EditorState.create({
        doc:
          language === "json-e"
            ? jsonLayout(controller.sliceText(slice), true).text
            : controller.sliceText(slice),
        extensions: [
          workbenchSlice(controller, slice, language === "json-e"),
          language === "json-e"
            ? jsonRule
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
          templatePairing((position) => {
            const config = read(position);
            return config?.language === "json-e" ? null : config;
          }),
          webCompletion(read),
          webHover(read),
          ...(language === "json-e" || slice === "advanced"
            ? [
                embeddedJsonE((source) =>
                  language === "json-e"
                    ? [{ from: 0, to: source.length }]
                    : controller.templateRegions
                        .filter(
                          (region) =>
                            region.language === "json-e" &&
                            region.from >= controller.sliceRange(slice).from &&
                            region.to <= controller.sliceRange(slice).to,
                        )
                        .map((region) => ({
                          from: region.from - controller.sliceRange(slice).from,
                          to: region.to - controller.sliceRange(slice).from,
                        })),
                ),
              ]
            : []),
          ...(slice === "filename" ||
          language === "expression" ||
          language === "json-e"
            ? [EditorView.theme({ ".cm-content": { minHeight: "5rem" } })]
            : []),
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
            report.current.onSelection?.(
              sliceSelection(
                update.view,
                from,
                language === "json-e" ? controller.sliceText(slice) : undefined,
              ),
            );
          }),
        ],
      }),
      parent: host.current!,
    });
    editor.current = view;
    // A pane mounts unfocused and sends no update, so it reports where its own
    // caret starts — the host follows the pane on screen, not the pane before it.
    report.current.onSelection?.(
      sliceSelection(
        view,
        controller.sliceRange(slice).from,
        language === "json-e" ? controller.sliceText(slice) : undefined,
      ),
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
    const inSlice = (offset: number) => {
      const local = Math.min(
        Math.max(offset - from, 0),
        controller.sliceText(slice).length,
      );
      return language === "json-e"
        ? jsonPosition(
            controller.sliceText(slice),
            view.state.doc.toString(),
            local,
          )
        : local;
    };
    view.dispatch({
      selection: EditorSelection.range(
        inSlice(reveal.from),
        inSlice(reveal.to),
      ),
      scrollIntoView: true,
    });
    view.focus();
  }, [controller, slice, reveal, language]);

  useEffect(() => {
    const content = editor.current?.contentDOM;
    if (!content) return;
    content.setAttribute("aria-invalid", String(invalid));
    if (describedBy) content.setAttribute("aria-describedby", describedBy);
    else content.removeAttribute("aria-describedby");
  }, [invalid, describedBy]);

  return (
    <div
      ref={host}
      dir="ltr"
      className="min-h-0 flex-1 overflow-auto rounded-md [&_.cm-content]:px-3 [&_.cm-content]:py-3 [&_.cm-content]:font-mono [&_.cm-content]:text-base sm:[&_.cm-content]:text-sm [&_.cm-editor]:h-full [&_.cm-editor.cm-focused]:outline-2 [&_.cm-editor.cm-focused]:-outline-offset-2 [&_.cm-editor.cm-focused]:outline-fd-foreground [&_.cm-gutters]:border-fd-border [&_.cm-gutters]:bg-transparent [&_.cm-scroller]:leading-relaxed"
    />
  );
}

/** The pane's own selection in master offsets, which is what the host tracks. */
function sliceSelection(
  view: EditorView,
  sliceFrom: number,
  jsonSource?: string,
): WorkbenchSliceRange {
  const { main } = view.state.selection;
  const map = (position: number) =>
    sliceFrom +
    (jsonSource === undefined
      ? position
      : jsonPosition(view.state.doc.toString(), jsonSource, position));
  return { from: map(main.from), to: map(main.to) };
}
