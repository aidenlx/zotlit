// The Reader Keymap: the keys the reader surfaces answer while the PDF view is
// the active leaf, wherever the focus sits inside it.
//
// Obsidian hears every keystroke on the window, before the page does, and hands
// it to the active view's `Scope`. The reader's Scope stands in front of the
// PDF view's own, so a key the reader answers is answered once, and a key it
// leaves falls through to Obsidian's: Escape still closes the find bar.
//
// A reader verb bound to one key, such as `Mod`+`Z` for undo, registers on this
// same Scope with that key. Obsidian consults it after the catch-all and ends
// its search there, so the verb stands in for the app's own hotkey while the
// PDF view is active.
import { Scope } from "obsidian";
import type { App } from "obsidian";

import { inTextEntry } from "./capability-affordance";

/** What the reader's keys run. Each returns whether it acted. */
export interface ReaderKeymapVerbs {
  /** One step back, which Escape takes. */
  escape: () => boolean;
}

/**
 * Puts the Reader Keymap in front of the view's own Scope.
 *
 * @returns the disposer that gives the view its own Scope back.
 */
export function mountReaderKeymap(
  view: { scope: Scope | null; app: App },
  verbs: ReaderKeymapVerbs,
): () => void {
  const own = view.scope;
  const scope = new Scope(own ?? view.app.scope);
  // A catch-all, because it is the one registration Obsidian's keymap goes on
  // past when it acts on nothing: a keyed one ends the search either way, and
  // would take Escape from the PDF view's own handler.
  scope.register(null, null, (event) => {
    // A keystroke inside a text field belongs to the field.
    if (inTextEntry(event.target)) return;
    const modified =
      event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
    if (event.key === "Escape" && !modified && verbs.escape()) return false;
  });
  view.scope = scope;
  return () => {
    if (view.scope === scope) view.scope = own;
  };
}
