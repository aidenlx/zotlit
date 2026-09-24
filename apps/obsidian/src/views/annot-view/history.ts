// The Annotation History keys an Annotation Card answers, and the reading of
// "a card has focus" they answer to.
import type { Scope } from "obsidian";

import { registerKeymap } from "@/lib/disposables";
import type { HistoryDirection } from "@/services/annotation-repository/service";
import { inTextEntry } from "@/services/pdf-annotation-editor/capability-affordance";
import {
  historyChords,
  historyVerbOf,
} from "@/services/pdf-annotation-editor/reader-keymap";

/** The Annotation Card, as the card's own DOM names it. */
const CARD_SELECTOR = ".zt-annot-card";

/**
 * Whether a keystroke landed on an Annotation Card — the card itself, or one
 * of the controls it holds. A card takes focus when it is clicked, so this is
 * the reading of "a card has focus" that the Annotation History keys answer.
 *
 * `instanceOf` rather than `instanceof`: the view runs in pop-out windows,
 * where a global DOM constructor belongs to the wrong window.
 *
 * @see apps/obsidian/policies/popout-windows.md
 */
export function onAnnotationCard(target: EventTarget | null): boolean {
  const node = target as Node | null;
  if (!node?.instanceOf(HTMLElement)) return false;
  return node.closest(CARD_SELECTOR) !== null;
}

/**
 * Put the platform's undo and redo chords on the Annotation View's own Scope,
 * where they act on the Annotation History of the Attachment the view shows.
 *
 * A card's comment editor keeps these keys for its own text undo, and the rest
 * of the view — the header, the filter bar, the attachment picker — leaves
 * them to Obsidian, so only a keystroke on a card steps the history.
 *
 * @param platform.isMacOS which chords the Annotation History answers, read
 *   from the host by the caller so this module reads none.
 * @returns the disposer that takes the chords off the Scope again.
 */
export function mountCardHistoryKeys(
  scope: Scope,
  step: (direction: HistoryDirection) => void,
  platform: { isMacOS: boolean },
): Disposable {
  const keys = new DisposableStack();
  for (const { modifiers, key } of historyChords(platform.isMacOS)) {
    keys.use(
      registerKeymap(scope, [...modifiers], key, (event) => {
        if (inTextEntry(event.target)) return;
        if (!onAnnotationCard(event.target)) return;
        const verb = historyVerbOf(event, platform.isMacOS);
        if (!verb) return;
        // A held key steps once: a repeat would walk the whole history.
        if (!event.repeat) step(verb);
        return false;
      }),
    );
  }
  return keys;
}
