// The CodeMirror side of the Obsidian look: code panes carry a class the
// stylesheet keys monospace typography on, and expression editors draw their
// tooltips in the top-layer surface they sit in.
import { Compartment } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, tooltips } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";

import { onEditorWindowMigrated } from "@/lib/editor-migration";

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
  ViewPlugin.define(
    (view) => {
      const dispose = onEditorWindowMigrated(view, (win) =>
        follow(view, win.document),
      );
      return { destroy: dispose };
    },
    {
      // Obsidian tells of a move once the element shows, so an editor that
      // moved inside a closed popover hears nothing; it takes the window it
      // stands in when it takes focus, before CodeMirror reads its focus and
      // caret there.
      eventHandlers: {
        focus(_event, view) {
          follow(view, view.dom.ownerDocument);
        },
      },
    },
  ),
];

/** Moves the editor's root and styles to `doc` when it is a new document. */
function follow(view: EditorView, doc: Document) {
  if (view.root === doc) return;
  view.setRoot(doc);
  view.requestMeasure();
}

const tooltipPlacement = new Compartment();

/**
 * Draws an expression editor's tooltips in the popover it sits in, such as
 * the Filter popover or the chooser page of a Formula, and in the page's body
 * outside one. A popover is in the top layer, so a tooltip in the body would
 * draw under it, and a click on that tooltip would light-dismiss the popover.
 * The popover's root does not clip — its contents scroll in an inner box — so
 * a tooltip drawn there reaches past the popover's edge.
 *
 * The place is chosen once the editor stands in the page, which it does not
 * while its plugins are made, and again when the view moves to a popout
 * window, whose body then holds the tooltips of an editor outside a popover.
 * Both come before the user types, and neither waits for focus: a dispatch
 * as the editor takes focus drops CodeMirror's notice of the focus when the
 * caret a click puts down comes first, and ends the moment in which
 * CodeMirror puts back the caret that a Tab focus moves to the start.
 */
export const popoverTooltips: Extension = ViewPlugin.fromClass(
  class {
    #parent: HTMLElement | null = null;
    #destroyed = false;
    readonly #released: () => void;
    constructor(readonly view: EditorView) {
      // A plugin cannot dispatch while the view makes it or updates.
      queueMicrotask(() => this.place());
      this.#released = onEditorWindowMigrated(view, () =>
        queueMicrotask(() => this.place()),
      );
    }
    update(update: ViewUpdate) {
      // An editor that was not in the page yet is placed once it is, and one
      // that moved unheard, inside a closed popover, once it updates there.
      const { dom } = update.view;
      if (dom.isConnected && this.#parent?.ownerDocument !== dom.ownerDocument)
        queueMicrotask(() => this.place());
    }
    place() {
      const { dom } = this.view;
      if (this.#destroyed || !dom.isConnected) return;
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
      this.#released();
    }
  },
  { provide: () => tooltipPlacement.of([]) },
);

export const codePane: Extension = [
  hostedEditor,
  EditorView.editorAttributes.of({ class: CODE_PANE_CLASS }),
];
