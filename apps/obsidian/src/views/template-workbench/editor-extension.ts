// The CodeMirror side of the Obsidian look: code panes carry a class the
// stylesheet keys monospace typography on.
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

/** The class the stylesheet keys monospace typography on. */
export const CODE_PANE_CLASS = "zt-template-workbench-code";

const popoutCopy = EditorView.domEventHandlers({
  copy(event, view) {
    const { main } = view.state.selection;
    if (event.clipboardData || view.root === document || main.empty)
      return false;
    void navigator.clipboard.writeText(view.state.sliceDoc(main.from, main.to));
    return true;
  },
});

/**
 * What every Obsidian-hosted editor of the plugin's views needs: lint marks in
 * Obsidian's error color, and copy and styles that survive a move to a popout
 * window. A code pane adds the code font on top.
 */
export const hostedEditor: Extension = [
  EditorView.theme({
    ".cm-problem-button": { color: "var(--text-error)" },
    ".cm-lintRange-error": {
      backgroundImage: "none",
      textDecoration: "underline wavy var(--text-error)",
      textUnderlineOffset: "0.2em",
    },
    ".cm-diagnostic-error": { borderInlineStartColor: "var(--text-error)" },
    ".cm-tooltip-lint": {
      backgroundColor: "var(--background-primary)",
      color: "inherit",
    },
  }),
  popoutCopy,
  ViewPlugin.define((view) => {
    const dispose = view.dom.onWindowMigrated((win) => {
      view.setRoot(win.document);
      view.requestMeasure();
    });
    return { destroy: dispose };
  }),
];

export const codePane: Extension = [
  hostedEditor,
  EditorView.editorAttributes.of({ class: CODE_PANE_CLASS }),
];
