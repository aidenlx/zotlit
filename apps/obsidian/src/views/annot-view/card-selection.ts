// The Card Selection's transitions: one view gesture or one reader push, over the order the list shows.

declare const CARD_PLACE: unique symbol;

/**
 * One place a card shows at in the list: its Indexed Key, or, under a group
 * heading, the group's key and its Indexed Key. A card with two tags shows
 * under two headings, so one Annotation can stand at two places. Make one
 * with {@link cardPlace}.
 */
export type CardPlace = string & { readonly [CARD_PLACE]: true };

/** The place of the card `key` under the group `groupKey`, or with no group. */
export function cardPlace(key: string, groupKey: string | null): CardPlace {
  return (groupKey === null ? key : `${groupKey}\n${key}`) as CardPlace;
}

/** The Indexed Key of the card at a place. */
export function placedKey(place: CardPlace): string {
  return place.slice(place.lastIndexOf("\n") + 1);
}

/**
 * The Annotation Cards one Annotation View holds selected, and the card a
 * range measures from. There is no primary card.
 *
 * @see apps/obsidian/docs/adr/0061-the-annotation-view-owns-its-card-selection.md
 */
export interface CardSelection {
  /** Indexed Keys of the Selected Cards. */
  readonly selected: readonly string[];
  /** The place a range gesture measures from; `null` while none is set. */
  readonly anchor: CardPlace | null;
  /**
   * The place the last gesture ended on: the moving end of a range, which a
   * move and an extend step from. `null` while none is set.
   */
  readonly focus: CardPlace | null;
}

export const NO_SELECTION: CardSelection = {
  selected: [],
  anchor: null,
  focus: null,
};

/**
 * The card a gesture names: its Indexed Key, and the place it was clicked
 * at. A card named by its key alone stands at the place the focus holds on
 * it, else at its first place.
 */
export interface NamedCard {
  key: string;
  place?: CardPlace;
}

/** One change to a Card Selection, from the view or from a reader. */
export type SelectionChange =
  /** A plain click on a card: that card alone. */
  | ({ kind: "click" } & NamedCard)
  /** Cmd/Ctrl-click: the card joins or leaves the selection. */
  | ({ kind: "toggle" } & NamedCard)
  /**
   * Shift-click: every card from the anchor to this one, in list order. The
   * anchor stays.
   */
  | ({ kind: "range" } & NamedCard)
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
 * @param visible the places the list shows, in list order.
 * @returns `current` itself where the change leaves it as it was, so a caller
 *   tells "changed" by identity.
 */
export function nextCardSelection(
  current: CardSelection,
  visible: readonly CardPlace[],
  change: SelectionChange,
): CardSelection {
  const next = transition(current, visible, change);
  return sameSelection(current, next) ? current : next;
}

/**
 * The place a move and an extend step from: the focus while the list shows
 * it, then the anchor, else the first place of a Selected Card. It is also the
 * list's one tab stop.
 *
 * @param visible the places the list shows, in list order.
 * @returns `null` while the selection holds no card the list shows.
 */
export function moveOrigin(
  current: CardSelection,
  visible: readonly CardPlace[],
): CardPlace | null {
  for (const place of [current.focus, current.anchor])
    if (place !== null && visible.includes(place)) return place;
  return (
    visible.find((place) => current.selected.includes(placedKey(place))) ?? null
  );
}

/**
 * The place a change names: the place it was clicked at, or for an Indexed
 * Key alone the place the focus holds on that card, else its first place.
 *
 * @returns `undefined` where the list does not show the card there.
 */
function placeOf(
  current: CardSelection,
  visible: readonly CardPlace[],
  { key, place }: NamedCard,
): CardPlace | undefined {
  if (place !== undefined) return visible.includes(place) ? place : undefined;
  if (
    current.focus !== null &&
    placedKey(current.focus) === key &&
    visible.includes(current.focus)
  )
    return current.focus;
  return visible.find((at) => placedKey(at) === key);
}

/** The cards at these places, each once, in list order. */
function cardsAt(places: readonly CardPlace[]): string[] {
  return [...new Set(places.map(placedKey))];
}

/**
 * The card a range measures from: the anchor while the list shows it, else
 * the {@link moveOrigin}. A range from a card a filter hid would reach cards
 * the user never marked out.
 */
function rangeOrigin(
  current: CardSelection,
  visible: readonly CardPlace[],
): CardPlace | null {
  return current.anchor !== null && visible.includes(current.anchor)
    ? current.anchor
    : moveOrigin(current, visible);
}

/** The cards from place `from` to place `to`, both included, in list order. */
function span(
  visible: readonly CardPlace[],
  from: CardPlace,
  to: CardPlace,
): string[] {
  const a = visible.indexOf(from);
  const b = visible.indexOf(to);
  return cardsAt(visible.slice(Math.min(a, b), Math.max(a, b) + 1));
}

/** The card at one place alone, the anchor and the focus on that place. */
function alone(place: CardPlace): CardSelection {
  return { selected: [placedKey(place)], anchor: place, focus: place };
}

/**
 * The place one step from the {@link moveOrigin} reaches, stopping at either
 * end; with no origin, ↓ takes the first place and ↑ the last.
 *
 * @returns `undefined` for an empty list.
 */
function stepFromOrigin(
  current: CardSelection,
  visible: readonly CardPlace[],
  step: 1 | -1,
): CardPlace | undefined {
  const from = moveOrigin(current, visible);
  if (from === null) return visible.at(step > 0 ? 0 : -1);
  const at = visible.indexOf(from) + step;
  return visible[Math.min(Math.max(at, 0), visible.length - 1)] ?? from;
}

function transition(
  current: CardSelection,
  visible: readonly CardPlace[],
  change: SelectionChange,
): CardSelection {
  switch (change.kind) {
    case "click": {
      const place = placeOf(current, visible, change);
      if (place === undefined) return current;
      return alone(place);
    }
    case "toggle": {
      const place = placeOf(current, visible, change);
      if (place === undefined) return current;
      const key = placedKey(place);
      const joins = !current.selected.includes(key);
      return {
        selected: cardsAt(visible).filter((card) =>
          card === key ? joins : current.selected.includes(card),
        ),
        anchor: place,
        focus: place,
      };
    }
    case "range": {
      const place = placeOf(current, visible, change);
      if (place === undefined) return current;
      const origin = rangeOrigin(current, visible);
      if (origin === null) return alone(place);
      return {
        selected: span(visible, origin, place),
        anchor: origin,
        focus: place,
      };
    }
    case "all":
      return { ...current, selected: cardsAt(visible) };
    case "clear":
      return NO_SELECTION;
    case "prune": {
      const shown = new Set(visible.map(placedKey));
      return {
        ...current,
        selected: current.selected.filter((key) => shown.has(key)),
      };
    }
    case "replace": {
      // In list order, so the anchor is the first place of the first pushed
      // card the list shows.
      const places = visible.filter((place) =>
        change.keys.includes(placedKey(place)),
      );
      const first = places[0] ?? null;
      return { selected: cardsAt(places), anchor: first, focus: first };
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
