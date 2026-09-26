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
import type { App, Modifier } from "obsidian";

import { inTextEntry } from "./capability-affordance";

/** Which way one keystroke steps through the Annotation History. */
export type HistoryVerb = "undo" | "redo";

/** One platform chord the Annotation History answers. */
interface HistoryChord {
  modifiers: readonly Modifier[];
  key: string;
  verb: HistoryVerb;
}

/**
 * macOS answers `Command`+`Z` and `Command`+`Shift`+`Z`; Windows and Linux
 * answer `Ctrl`+`Z`, `Ctrl`+`Shift`+`Z` and `Ctrl`+`Y`.
 *
 * The platform key is named outright rather than left to Obsidian's `Mod`, so
 * `Ctrl`+`Y` is bound off macOS alone and `Ctrl`+`Z` on macOS falls through to
 * whatever else holds it.
 */
const MAC_CHORDS: readonly HistoryChord[] = [
  { modifiers: ["Meta"], key: "Z", verb: "undo" },
  { modifiers: ["Meta", "Shift"], key: "Z", verb: "redo" },
];

const PC_CHORDS: readonly HistoryChord[] = [
  { modifiers: ["Ctrl"], key: "Z", verb: "undo" },
  { modifiers: ["Ctrl", "Shift"], key: "Z", verb: "redo" },
  { modifiers: ["Ctrl"], key: "Y", verb: "redo" },
];

const MODIFIERS = ["Ctrl", "Meta", "Alt", "Shift"] as const;

/** What one keystroke carries that the platform decision reads. */
export type HistoryKeystroke = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

const MODIFIER_HELD = {
  Ctrl: (event: HistoryKeystroke) => event.ctrlKey,
  Meta: (event: HistoryKeystroke) => event.metaKey,
  Alt: (event: HistoryKeystroke) => event.altKey,
  Shift: (event: HistoryKeystroke) => event.shiftKey,
} as const;

/** The chords the Annotation History answers on this platform. */
export function historyChords(isMacOS: boolean): readonly HistoryChord[] {
  return isMacOS ? MAC_CHORDS : PC_CHORDS;
}

/**
 * Which Annotation History verb a keystroke asks for on this platform, or
 * `null` where it asks for none and belongs to whatever else holds it. Every
 * modifier is compared, so an extra one — `Alt`+`Ctrl`+`Z` — is nobody's undo.
 */
export function historyVerbOf(
  event: HistoryKeystroke,
  isMacOS: boolean,
): HistoryVerb | null {
  const chord = historyChords(isMacOS).find(
    ({ modifiers, key }) =>
      key.toLowerCase() === event.key.toLowerCase() &&
      MODIFIERS.every(
        (name) => modifiers.includes(name) === MODIFIER_HELD[name](event),
      ),
  );
  return chord?.verb ?? null;
}

/** What the reader's keys run. */
export interface ReaderKeymapVerbs {
  /** One step back, which Escape takes. Returns whether it acted. */
  escape: () => boolean;
  /** One step back through the Annotation History. */
  undo: () => void;
  /** One step forward through it again. */
  redo: () => void;
  /**
   * Copy the text of the selected marks, for `Mod`+`C`. Returns whether it
   * acted; one that did not leaves the key to the platform's own copy.
   */
  copy: () => boolean;
}

/**
 * Puts the Reader Keymap in front of the view's own Scope.
 *
 * @param platform.isMacOS which chords the Annotation History answers, read
 *   from the host by the caller so this module reads none.
 * @returns the disposer that gives the view its own Scope back.
 */
export function mountReaderKeymap(
  view: { scope: Scope | null; app: App },
  verbs: ReaderKeymapVerbs,
  platform: { isMacOS: boolean },
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
  for (const { modifiers, key } of historyChords(platform.isMacOS)) {
    scope.register([...modifiers], key, (event) => {
      // The comment editor and a Text Draft keep these keys for their own
      // text undo, so a keystroke typed into one falls through untouched.
      if (inTextEntry(event.target)) return;
      const verb = historyVerbOf(event, platform.isMacOS);
      if (!verb) return;
      // A held key steps once: a repeat would walk the whole history.
      if (!event.repeat) verbs[verb]();
      return false;
    });
  }
  // The platform key, named outright as the history chords name it. A copy
  // that finds nothing to copy leaves the key to the platform's own copy.
  scope.register([platform.isMacOS ? "Meta" : "Ctrl"], "C", (event) => {
    if (inTextEntry(event.target)) return;
    if (verbs.copy()) return false;
  });
  view.scope = scope;
  return () => {
    if (view.scope === scope) view.scope = own;
  };
}
