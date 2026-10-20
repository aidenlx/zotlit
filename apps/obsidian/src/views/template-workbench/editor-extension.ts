// The CodeMirror side of the Obsidian look: code panes carry a class the
// stylesheet keys monospace typography on, and expression editors draw their
// tooltips in the top-layer surface they sit in.
import { Compartment } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, tooltips } from "@codemirror/view";

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
 * The editor stands in the page only once it is made, so the place is chosen
 * a microtask later, and again when the view moves to another window, whose
 * body then holds the tooltips of an editor outside a popover.
 */
export const popoverTooltips: Extension = [
  tooltipPlacement.of([]),
  ViewPlugin.define((view) => {
    let live = true;
    const place = () => {
      if (!live) return;
      const parent =
        view.dom.closest<HTMLElement>("[popover]") ??
        view.dom.ownerDocument.body;
      view.dispatch({
        effects: tooltipPlacement.reconfigure(tooltips({ parent })),
      });
    };
    queueMicrotask(place);
    const stopMigration = view.dom.onWindowMigrated(place);
    return {
      destroy() {
        live = false;
        stopMigration();
      },
    };
  }),
];

export const codePane: Extension = [
  hostedEditor,
  EditorView.editorAttributes.of({ class: CODE_PANE_CLASS }),
];
