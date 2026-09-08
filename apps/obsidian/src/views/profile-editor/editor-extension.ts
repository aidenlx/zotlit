// The CodeMirror side of the Obsidian look: code panes carry a class the
// stylesheet keys monospace typography on.
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { WorkbenchSliceId } from "@zotlit/workbench/document";
import type { SliceLanguage } from "@zotlit/workbench/ui";

/** The class the stylesheet keys monospace typography on. */
export const CODE_PANE_CLASS = "zt-profile-editor-code";

/** A pane over code — the whole file, an expression, a rule, the note name — reads in monospace. */
export function isCodePane(
  slice: WorkbenchSliceId,
  language: SliceLanguage,
): boolean {
  return slice === "advanced" || slice === "filename" || language !== "liquid";
}

export const codePane: Extension = EditorView.editorAttributes.of({
  class: CODE_PANE_CLASS,
});
