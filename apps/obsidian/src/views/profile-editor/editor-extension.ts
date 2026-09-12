// The CodeMirror side of the Obsidian look: code panes carry a class the
// stylesheet keys monospace typography on.
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

/** The class the stylesheet keys monospace typography on. */
export const CODE_PANE_CLASS = "zt-profile-editor-code";

const popoutCopy = EditorView.domEventHandlers({
  copy(event, view) {
    const { main } = view.state.selection;
    if (event.clipboardData || view.root === document || main.empty)
      return false;
    void navigator.clipboard.writeText(view.state.sliceDoc(main.from, main.to));
    return true;
  },
});

export const codePane: Extension = [
  EditorView.editorAttributes.of({ class: CODE_PANE_CLASS }),
  popoutCopy,
  ViewPlugin.define((view) => {
    const dispose = view.dom.onWindowMigrated((win) => {
      view.setRoot(win.document);
      view.requestMeasure();
    });
    return { destroy: dispose };
  }),
];
