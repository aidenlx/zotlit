// The rows of a long Items Layout, mounted only near the screen. A list of
// more than `VIRTUAL_MIN_ENTRIES` entries draws the entries in view and a few
// on each side, in normal flow, with a spacer for each run it leaves out: a
// table keeps its rows, and a list its markers. The browser then lays out and
// restyles a screenful of rows on a resize or a sidebar toggle, not the
// whole list.
//
// The list scrolls in the layout's own box, in a tab and in a note alike: a
// note caps the view's height (`note-host.css`). The box turns off the
// browser's scroll anchoring: the spacers and the rows they stand for
// differ by a pixel, and an anchor that follows that pixel moves the
// content under a scroll bar dragged by the pointer.
// The selected row, the first row and the row that holds the focus stay
// mounted wherever they are, so the host's keys and the Tab stop find them.
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Range, VirtualItem } from "@tanstack/react-virtual";
import { defaultRangeExtractor } from "@tanstack/react-virtual";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { observeResize } from "@/lib/observe-resize";

/** The fewest entries a list mounts only near the screen. */
const VIRTUAL_MIN_ENTRIES = 100;

/** The entries mounted past each end of the screen. */
const OVERSCAN = 8;

/** One mounted entry, with the room its left-out entries take before it. */
export interface MountedEntry {
  readonly index: number;
  /** The room of the left-out entries before this one, in pixels. */
  readonly before: number;
}

/** What a layout draws: the entries, and the spacers between them. */
export interface VirtualRows {
  readonly entries: readonly MountedEntry[];
  /** The room of the left-out entries after the last one drawn. */
  readonly after: number;
  /** The ref of each drawn entry; the entry carries `data-index`. */
  readonly measure: (el: Element | null) => void;
  /** The ref of the element whose top is the first entry's top. */
  readonly list: (el: HTMLElement | null) => void;
  /**
   * Scroll the entry at an index into view, as the virtualizer places it
   * once the entries around it are measured; `false` where the list mounts
   * every entry, and the entry's element scrolls itself.
   */
  readonly scrollTo: (index: number) => boolean;
  /**
   * Keep the entry under the focus mounted: the list's `onFocus`, which
   * hears the focus of any element inside it.
   */
  readonly onFocus: (event: { target: EventTarget }) => void;
}

/**
 * The entries to draw, in order, each with the room before it: `items` and
 * their places, as the virtualizer gives them, from `start` (the list's top)
 * to `end` (its bottom).
 */
export function flow(
  items: readonly { index: number; start: number; end: number }[],
  start: number,
  end: number,
): { entries: MountedEntry[]; after: number } {
  const entries: MountedEntry[] = [];
  let at = start;
  for (const item of items) {
    entries.push({ index: item.index, before: Math.max(0, item.start - at) });
    at = item.end;
  }
  return { entries, after: Math.max(0, end - at) };
}

/** The entries of `range`, with the `pinned` ones wherever they are. */
export function withPinned(range: Range, pinned: readonly number[]): number[] {
  const indexes = new Set(defaultRangeExtractor(range));
  for (const index of pinned)
    if (index >= 0 && index < range.count) indexes.add(index);
  return [...indexes].toSorted((a, b) => a - b);
}

/** The measured entries of a kind its height is learned from. */
const LEARN_SAMPLES = 5;

/**
 * The height of each kind that `measured` holds enough entries of: the
 * median of their heights.
 */
export function learn(
  measured: readonly { kind: string; size: number }[],
): Map<string, number> {
  const sizes = Map.groupBy(measured, ({ kind }) => kind);
  const heights = new Map<string, number>();
  for (const [kind, entries] of sizes) {
    if (entries.length < LEARN_SAMPLES) continue;
    const sorted = entries.map(({ size }) => size).toSorted((a, b) => a - b);
    heights.set(kind, sorted[Math.floor(sorted.length / 2)]!);
  }
  return heights;
}

/** The distance from the scroller's content top to the list's top. */
function marginOf(scroller: HTMLElement, list: HTMLElement): number {
  return Math.round(
    list.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop,
  );
}

/**
 * Mount the `count` entries of a layout near the screen only.
 * @param own The layout's own box, which scrolls the list.
 * @param estimate The height of the entry at an index before it is measured,
 *   until the list has measured entries of its kind.
 * @param kindOf The kind of the entry at an index, whose measured height an
 *   entry of that kind takes until it is measured itself; `null` for one of
 *   its own height, as an expanded row.
 * @param keyOf A key of the entry at an index that holds across runs.
 * @param pinned The entries that stay mounted wherever they are.
 * @param shape What the entries' heights follow beside their content, such
 *   as the layout's options: a change measures them again.
 * @param all Draw every entry, as for a print.
 */
export function useVirtualRows({
  count,
  own,
  estimate,
  kindOf,
  keyOf,
  pinned,
  shape = "",
  all,
}: {
  count: number;
  own: HTMLElement | null;
  estimate: (index: number) => number;
  kindOf: (index: number) => string | null;
  keyOf: (index: number) => string;
  pinned: readonly number[];
  shape?: string;
  all: boolean;
}): VirtualRows {
  const [list, setList] = useState<HTMLElement | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [margin, setMargin] = useState(0);
  /** The height of a Table's header, which stays over the rows. */
  const [sticky, setSticky] = useState(0);
  const [learned, setLearned] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  /** The measured heights of each kind not yet learned, by entry key. */
  const samples = useRef(new Map<string, Map<VirtualItem["key"], number>>());
  // Until its box mounts, the list draws the window's worth at its top.
  const enabled = !all && count > VIRTUAL_MIN_ENTRIES;
  const scroller = own;
  // A view moved into or out of a pop-out keeps its elements; the scroller
  // goes for one draw, so the virtualizer observes it from its new window.
  // The new window can draw a row at another height: the rows are measured
  // again.
  const [moved, setMoved] = useState(false);
  const [moves, setMoves] = useState(0);
  useLayoutEffect(
    () =>
      own?.onWindowMigrated(() => {
        setMoved(true);
        setMoves((count) => count + 1);
      }),
    [own],
  );
  useLayoutEffect(() => {
    if (moved) setMoved(false);
  }, [moved]);

  const focusedIndex = useMemo(() => {
    if (focused === null) return -1;
    for (let index = 0; index < count; index++)
      if (keyOf(index) === focused) return index;
    return -1;
  }, [focused, count, keyOf]);
  const kept = useMemo(
    () => (focusedIndex === -1 ? pinned : [...pinned, focusedIndex]),
    [pinned, focusedIndex],
  );
  const rangeExtractor = useCallback(
    (range: Range) => withPinned(range, kept),
    [kept],
  );

  const estimateSize = useCallback(
    (index: number) => {
      const kind = kindOf(index);
      return (kind === null ? undefined : learned.get(kind)) ?? estimate(index);
    },
    [kindOf, learned, estimate],
  );
  const virtualizer = useVirtualizer({
    count,
    enabled,
    getScrollElement: () => (moved ? null : scroller),
    estimateSize,
    // TanStack reads the estimates again only for a new key function: a new
    // one for each change of what the estimates read.
    getItemKey: useCallback(
      (index: number) => keyOf(index),
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- a new estimate needs a new key function
      [keyOf, estimateSize],
    ),
    overscan: OVERSCAN,
    rangeExtractor,
    scrollMargin: margin,
    scrollPaddingStart: sticky,
    // The scroller's size, from the window that shows it, as the view moves
    // into or out of a pop-out.
    observeElementRect: (instance, cb) => {
      const el = instance.scrollElement;
      if (!el) return;
      const read = () => cb({ width: el.clientWidth, height: el.clientHeight });
      read();
      const observing = observeResize(el, [el], read);
      return () => observing[Symbol.dispose]();
    },
    // A row's height to the fraction of a pixel: rounded, the error of the
    // rows above one adds up, and a row scrolled into view stops short.
    // A row with no box, as in a folded callout, keeps the height it had.
    measureElement: (el, entry, instance) => {
      const size =
        entry?.borderBoxSize[0]?.blockSize ?? el.getBoundingClientRect().height;
      if (size > 0) return size;
      const index = instance.indexFromElement(el);
      return (
        instance.itemSizeCache.get(instance.options.getItemKey(index)) ??
        instance.options.estimateSize(index)
      );
    },
    // The first draw, before the scroller is measured, fills a window.
    initialRect: { width: 0, height: (own?.win ?? activeWindow).innerHeight },
  });

  // The list moves in the scroller as the content above it changes, such as
  // a Table's header. Read its place as the list mounts, and again as the
  // scroller scrolls or changes size.
  useLayoutEffect(() => {
    if (!enabled || !scroller || !list) return;
    const read = () => {
      setMargin(marginOf(scroller, list));
      setSticky(list.closest("table")?.tHead?.offsetHeight ?? 0);
    };
    read();
    const observing = observeResize(scroller, [scroller], read);
    scroller.addEventListener("scroll", read, { passive: true });
    return () => {
      observing[Symbol.dispose]();
      scroller.removeEventListener("scroll", read);
    };
  }, [enabled, scroller, list]);

  // An entry takes the height its kind measures on screen until it is
  // measured itself: the list's height then holds as the rows come into
  // view, and a scroll bar dragged by the pointer stays under it. It gathers
  // the sizes the virtualizer measured since the last draw, so it runs after
  // each one, across scroll positions; a kind it learned drops out, so the
  // updates end.
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs after each draw on purpose
  useLayoutEffect(() => {
    if (!enabled) return;
    for (const { index, key } of virtualizer.getVirtualItems()) {
      const kind = kindOf(index);
      const size = virtualizer.itemSizeCache.get(key);
      if (kind === null || !size || learned.has(kind)) continue;
      const sizes =
        samples.current.get(kind) ?? new Map<VirtualItem["key"], number>();
      sizes.set(key, size);
      samples.current.set(kind, sizes);
    }
    const next = learn(
      [...samples.current].flatMap(([kind, sizes]) =>
        [...sizes.values()].map((size) => ({ kind, size })),
      ),
    );
    if (next.size === 0) return;
    for (const kind of next.keys()) samples.current.delete(kind);
    setLearned(new Map([...learned, ...next]));
  });

  // A change of what the heights follow, such as a List option or the
  // window, measures every entry again: the mounted ones now, the others as
  // they mount.
  const heightsFollow = `${moves}\n${shape}`;
  const measuredShape = useRef(heightsFollow);
  useLayoutEffect(() => {
    if (measuredShape.current === heightsFollow) return;
    measuredShape.current = heightsFollow;
    samples.current.clear();
    setLearned(new Map());
    virtualizer.measure();
    for (const el of virtualizer.elementsCache.values())
      virtualizer.measureElement(el);
  }, [heightsFollow, virtualizer]);

  const onFocus = useCallback(
    (event: { target: EventTarget }) => {
      const target = event.target as Node;
      const entry = target.instanceOf(Element)
        ? target.closest<HTMLElement>("[data-index]")
        : null;
      const index = entry ? Number(entry.dataset.index) : -1;
      setFocused(index >= 0 && index < count ? keyOf(index) : null);
    },
    [count, keyOf],
  );

  const scrollTo = useCallback(
    (index: number) => {
      if (!enabled) return false;
      virtualizer.scrollToIndex(index, { align: "auto" });
      return true;
    },
    [enabled, virtualizer],
  );

  if (!enabled) {
    const entries = Array.from({ length: count }, (_, index) => ({
      index,
      before: 0,
    }));
    return {
      entries,
      after: 0,
      measure: noMeasure,
      list: setList,
      scrollTo,
      onFocus,
    };
  }
  const { entries, after } = flow(
    virtualizer.getVirtualItems(),
    margin,
    margin + virtualizer.getTotalSize(),
  );
  return {
    entries,
    after,
    measure: virtualizer.measureElement,
    list: setList,
    scrollTo,
    onFocus,
  };
}

const noMeasure = () => {};
