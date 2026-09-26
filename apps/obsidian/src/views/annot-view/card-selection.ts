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
  /**
   * The card the last gesture ended on: the moving end of a range, which a
   * move and an extend step from. `null` while none is set.
   */
  readonly focus: string | null;
}

export const NO_SELECTION: CardSelection = {
  selected: [],
  anchor: null,
  focus: null,
};

/** One change to a Card Selection, from the view or from a reader. */
export type SelectionChange =
  /** A plain click on a card: that card alone. */
  | { kind: "click"; key: string }
  /** Cmd/Ctrl-click: the card joins or leaves the selection. */
  | { kind: "toggle"; key: string }
  /**
   * Shift-click: every card from the anchor to this one, in list order. The
   * anchor stays.
   */
  | { kind: "range"; key: string }
  /** Cmd/Ctrl+A: every card the list shows. */
  | { kind: "all" }
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
  | { kind: "move"; step: 1 | -1 }
  /**
   * Shift+↑ (`-1`) or Shift+↓ (`1`): the range from the anchor to the next or
   * the previous card from the {@link moveOrigin}. With no origin it enters
   * the list as a move does.
   */
  | { kind: "extend"; step: 1 | -1 };

/** The click gestures on a card: plain, Cmd/Ctrl-click, and Shift-click. */
export type CardClick = Extract<
  SelectionChange["kind"],
  "click" | "toggle" | "range"
>;

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
 * The card a move and an extend step from: the focus while the list shows it,
 * then the anchor, else the first Selected Card. It is also the list's one tab
 * stop.
 *
 * @param visible the Indexed Keys the list shows, in list order.
 * @returns `null` while the selection holds no card the list shows.
 */
export function moveOrigin(
  current: CardSelection,
  visible: readonly string[],
): string | null {
  for (const key of [current.focus, current.anchor])
    if (key !== null && visible.includes(key)) return key;
  return current.selected.find((key) => visible.includes(key)) ?? null;
}

/**
 * The card a range measures from: the anchor while the list shows it, else
 * the {@link moveOrigin}. A range from a card a filter hid would reach cards
 * the user never marked out.
 */
function rangeOrigin(
  current: CardSelection,
  visible: readonly string[],
): string | null {
  return current.anchor !== null && visible.includes(current.anchor)
    ? current.anchor
    : moveOrigin(current, visible);
}

/** The cards from `from` to `to`, both included, in list order. */
function span(visible: readonly string[], from: string, to: string): string[] {
  const a = visible.indexOf(from);
  const b = visible.indexOf(to);
  return visible.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** One card alone, the anchor and the focus on it. */
function alone(key: string): CardSelection {
  return { selected: [key], anchor: key, focus: key };
}

/**
 * The card one step from the {@link moveOrigin} reaches, stopping at either
 * end; with no origin, ↓ takes the first card and ↑ the last.
 *
 * @returns `undefined` for an empty list.
 */
function stepFromOrigin(
  current: CardSelection,
  visible: readonly string[],
  step: 1 | -1,
): string | undefined {
  const from = moveOrigin(current, visible);
  if (from === null) return visible.at(step > 0 ? 0 : -1);
  const at = visible.indexOf(from) + step;
  return visible[Math.min(Math.max(at, 0), visible.length - 1)] ?? from;
}

function transition(
  current: CardSelection,
  visible: readonly string[],
  change: SelectionChange,
): CardSelection {
  switch (change.kind) {
    case "click":
      if (!visible.includes(change.key)) return current;
      return alone(change.key);
    case "toggle": {
      if (!visible.includes(change.key)) return current;
      const joins = !current.selected.includes(change.key);
      return {
        selected: visible.filter((key) =>
          key === change.key ? joins : current.selected.includes(key),
        ),
        anchor: change.key,
        focus: change.key,
      };
    }
    case "range": {
      if (!visible.includes(change.key)) return current;
      const origin = rangeOrigin(current, visible);
      if (origin === null) return alone(change.key);
      return {
        selected: span(visible, origin, change.key),
        anchor: origin,
        focus: change.key,
      };
    }
    case "all":
      return { ...current, selected: [...visible] };
    case "clear":
      return NO_SELECTION;
    case "prune":
      return {
        ...current,
        selected: current.selected.filter((key) => visible.includes(key)),
      };
    case "replace": {
      // In list order, so the anchor is the first pushed card the list shows.
      const selected = visible.filter((key) => change.keys.includes(key));
      const first = selected[0] ?? null;
      return { selected, anchor: first, focus: first };
    }
    case "move": {
      const key = stepFromOrigin(current, visible, change.step);
      return key === undefined ? current : alone(key);
    }
    case "extend": {
      const origin = rangeOrigin(current, visible);
      const key = stepFromOrigin(current, visible, change.step);
      if (key === undefined) return current;
      if (origin === null) return alone(key);
      return {
        selected: span(visible, origin, key),
        anchor: origin,
        focus: key,
      };
    }
  }
}

function sameSelection(a: CardSelection, b: CardSelection): boolean {
  return (
    a.anchor === b.anchor &&
    a.focus === b.focus &&
    sameKeys(a.selected, b.selected)
  );
}

/** Whether two key lists hold the same keys in the same order. */
export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}
