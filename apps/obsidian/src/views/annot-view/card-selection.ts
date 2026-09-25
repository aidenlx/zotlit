// The Card Selection's transitions: one view gesture or one reader push, over the order the list shows.

/**
 * The Annotation Cards one Annotation View holds selected, and the card a
 * range measures from. There is no primary card.
 *
 * @see apps/obsidian/docs/adr/0061-the-annotation-view-owns-its-card-selection.md
 */
export interface CardSelection {
  /** Indexed Keys of the Selected Cards. */
  readonly selected: readonly string[];
  /** The card a range gesture measures from; `null` while none is set. */
  readonly anchor: string | null;
}

export const NO_SELECTION: CardSelection = { selected: [], anchor: null };

/** One change to a Card Selection, from the view or from a reader. */
export type SelectionChange =
  /** A plain click on a card: that card alone. */
  | { kind: "click"; key: string }
  /** Escape, or a click on the empty list. */
  | { kind: "clear" }
  /**
   * The visible list changed — a filter, a search, a deleted Annotation — and
   * the cards it no longer shows leave the selection. The anchor stays where
   * it was, as a position in the list rather than a selected card.
   */
  | { kind: "prune" }
  /** A reader reported its own selection, a clear included. */
  | { kind: "replace"; keys: readonly string[] }
  /**
   * ↑ (`-1`) or ↓ (`1`): one card, the next in list order from the
   * {@link moveOrigin}. It stops at either end of the list. With no origin,
   * ↓ takes the first card and ↑ the last.
   */
  | { kind: "move"; step: 1 | -1 };

/**
 * The Card Selection after one change. The selection only ever holds cards
 * the list shows, so a change never reaches a card the user cannot see.
 *
 * @param visible the Indexed Keys the list shows, in list order.
 * @returns `current` itself where the change leaves it as it was, so a caller
 *   tells "changed" by identity.
 */
export function nextCardSelection(
  current: CardSelection,
  visible: readonly string[],
  change: SelectionChange,
): CardSelection {
  const next = transition(current, visible, change);
  return sameSelection(current, next) ? current : next;
}

/**
 * The card a move steps from: the anchor while the list shows it, else the
 * first Selected Card. It is also the list's one tab stop.
 *
 * @param visible the Indexed Keys the list shows, in list order.
 * @returns `null` while the selection holds no card the list shows.
 */
export function moveOrigin(
  current: CardSelection,
  visible: readonly string[],
): string | null {
  if (current.anchor !== null && visible.includes(current.anchor))
    return current.anchor;
  return current.selected.find((key) => visible.includes(key)) ?? null;
}

function transition(
  current: CardSelection,
  visible: readonly string[],
  change: SelectionChange,
): CardSelection {
  switch (change.kind) {
    case "click":
      if (!visible.includes(change.key)) return current;
      return { selected: [change.key], anchor: change.key };
    case "clear":
      return NO_SELECTION;
    case "prune":
      return {
        selected: current.selected.filter((key) => visible.includes(key)),
        anchor: current.anchor,
      };
    case "replace": {
      // In list order, so the anchor is the first pushed card the list shows.
      const selected = visible.filter((key) => change.keys.includes(key));
      return { selected, anchor: selected[0] ?? null };
    }
    case "move": {
      const from = moveOrigin(current, visible);
      if (from === null) {
        const entry = visible.at(change.step > 0 ? 0 : -1);
        return entry === undefined
          ? current
          : { selected: [entry], anchor: entry };
      }
      const at = visible.indexOf(from) + change.step;
      const key =
        visible[Math.min(Math.max(at, 0), visible.length - 1)] ?? from;
      return { selected: [key], anchor: key };
    }
  }
}

function sameSelection(a: CardSelection, b: CardSelection): boolean {
  return a.anchor === b.anchor && sameKeys(a.selected, b.selected);
}

/** Whether two key lists hold the same keys in the same order. */
export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}
