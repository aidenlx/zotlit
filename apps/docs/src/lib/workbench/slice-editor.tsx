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
import { liquidMarkdown } from "@zotlit/workbench/language";

export interface SliceEditorProps {
  controller: WorkbenchDocumentController;
  slice: WorkbenchSliceId;
  label: string;
  /**
   * Master offsets to select and scroll to, so a problem opens on the text
   * that caused it. Each new object reveals again.
   */
  reveal?: WorkbenchSliceRange | null;
}

export function SliceEditor({
  controller,
  slice,
  label,
  reveal,
}: SliceEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView>(null);

  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: controller.sliceText(slice),
        extensions: [
          workbenchSlice(controller, slice),
          liquidMarkdown,
          EditorView.lineWrapping,
          // The whole-file pane is the one place a reader counts lines, so the
          // gutter rides with Advanced alone.
          ...(slice === "advanced" ? [lineNumbers()] : []),
          EditorView.contentAttributes.of({ "aria-label": label }),
        ],
      }),
      parent: host.current!,
    });
    editor.current = view;
    return () => {
      editor.current = null;
      view.destroy();
    };
  }, [controller, slice, label]);

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
