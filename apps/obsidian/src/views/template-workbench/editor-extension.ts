// The CodeMirror side of the Obsidian look: code panes carry a class the
// stylesheet keys monospace typography on, and expression editors draw their
// tooltips in the top-layer surface they sit in.
import { Compartment } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, tooltips } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";

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

const tooltipPlacement = new Compartment();

/**
 * Draws an expression editor's tooltips in the popover it sits in, such as
 * the Filter popover or the chooser page of a Formula, and in the page's body
 * outside one. A popover is in the top layer, so a tooltip in the body would
 * draw under it, and a click on that tooltip would light-dismiss the popover.
 * The popover's root does not clip — its contents scroll in an inner box — so
 * a tooltip drawn there reaches past the popover's edge.
 *
 * An editor's tooltips open as the user types in it, so the place is chosen
 * each time the editor takes focus. By then the editor stands in the page,
 * which it does not while its plugins are made, and it stands in the window
 * it is typed in: a view moved to a popout window loses focus on the way, so
 * its next focus moves the tooltips of an editor outside a popover to the
 * popout's body.
 *
 * The place is chosen once CodeMirror has told the editor of the focus, after
 * that update. A dispatch from the focus event itself would come first, and
 * CodeMirror drops its own notice of the focus when the next dispatch, such
 * as the caret a click puts down, comes before that notice.
 */
export const popoverTooltips: Extension = ViewPlugin.fromClass(
  class {
    #parent: HTMLElement | null = null;
    #destroyed = false;
    constructor(readonly view: EditorView) {}
    update(update: ViewUpdate) {
      if (!update.focusChanged || !update.view.hasFocus) return;
      // An update cannot dispatch; the place follows it.
      queueMicrotask(() => this.place());
    }
    place() {
      if (this.#destroyed) return;
      const { dom } = this.view;
      const parent =
        dom.closest<HTMLElement>("[popover]") ?? dom.ownerDocument.body;
      if (parent === this.#parent) return;
      this.#parent = parent;
      this.view.dispatch({
        effects: tooltipPlacement.reconfigure(tooltips({ parent })),
      });
    }
    destroy() {
      this.#destroyed = true;
    }
  },
  { provide: () => tooltipPlacement.of([]) },
);

export const codePane: Extension = [
  hostedEditor,
  EditorView.editorAttributes.of({ class: CODE_PANE_CLASS }),
];
