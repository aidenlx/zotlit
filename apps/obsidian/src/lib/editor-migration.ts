import type { EditorView } from "@codemirror/view";

/**
 * Obsidian's `onWindowMigrated` for a CodeMirror editor: calls `listener` with
 * the new window when the editor's element shows in another window than the
 * one it was last in. Returns the function that stops listening.
 *
 * Obsidian hears a move through a CSS animation that a class it adds to the
 * element starts. CodeMirror owns the `class` attribute of `view.dom` and
 * rewrites it on its next attribute update — the end of its constructor, a
 * focus change — which drops that class, so a listener on `view.dom` never
 * hears a move. The scroller's class is written once, when the view is made,
 * and the scroller shows exactly when the editor does.
 */
export function onEditorWindowMigrated(
  view: EditorView,
  listener: (win: Window) => void,
): () => void {
  return view.scrollDOM.onWindowMigrated(listener);
}
