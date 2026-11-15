// The window of an Items Layout over its entries: the group headings and
// Item rows of the Papers, Table and List layouts, of which a long list
// mounts only those near the screen (`virtual-rows.ts`). A layout gives its
// entries and a function that draws one; the window draws the box the list
// scrolls in, the list, an element for each mounted entry and a spacer for
// each run it leaves out. It keeps the rows its host needs mounted (the
// selected row, the first row, the row under the focus), tells the host the
// order of the Item rows and how to scroll to one, and draws every entry for
// a print.
//
// @see apps/obsidian/docs/adr/0074-library-view-rows-act-as-quick-switcher-results.md
import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { HTMLAttributes, LiHTMLAttributes, ReactNode } from "react";

import { observeResize } from "@/lib/observe-resize";
import { cn } from "@/lib/utils";

import { ITEM_ROW_ATTRIBUTE, NO_ROWS } from "./item-rows";
import type { QueryView } from "./view";
import { useVirtualRows } from "./virtual-rows";
import type { VirtualRows } from "./virtual-rows";
import {
  ListSpacer,
  TABLE_GHOST,
  TableSpacer,
  placeholderRow,
} from "./virtual-spacers";

/** One entry of an Items Layout, in the order it shows. */
export interface WindowEntry {
  /** A key of the entry that holds across runs. */
  readonly key: string;
  /**
   * What the entry is, such as a heading or a row of one line: an entry
   * takes the height its kind measures until it is measured itself.
   */
  readonly kind: string;
  /** The Indexed Key of the Item an Item row shows; `null` for a heading. */
  readonly item: string | null;
  /**
   * The entry takes a height of its own, as a row expanded into its
   * Attachments: its kind learns no height from it.
   */
  readonly own?: boolean;
  /**
   * The entry's height before it is drawn, where the layout knows it, as
   * the List does from a row's text: the entry takes it in place of its
   * kind's, and its kind learns no height from it.
   */
  readonly height?: number;
}

/**
 * The height of an entry of each kind before the list has measured entries
 * of that kind: a `row`'s for a kind it does not name, and for the outlines
 * of the rows a spacer stands for.
 */
export type Estimates = Readonly<Record<string, number>> & {
  readonly row: number;
};

/** The attributes a layout gives an element the window draws. */
type Attributes<E extends HTMLAttributes<HTMLElement>> = E & {
  readonly [data: `data-${string}`]: string | undefined;
};

/** One entry as its layout draws it. */
export interface DrawnEntry {
  /** The attributes of the entry's element: a `li`, or a Table's `tbody`. */
  readonly props?: Attributes<LiHTMLAttributes<HTMLElement>>;
  readonly children: ReactNode;
}

/** A list whose entries are its `li` elements, as the Papers and List layouts draw. */
interface ListFlow {
  readonly kind: "list";
  readonly as: "ul" | "ol";
  /** The attributes of the list element. */
  readonly props?: Attributes<HTMLAttributes<HTMLElement>>;
  /** The outline of one row, which the box repeats under its entries. */
  readonly ghost: string;
}

/** A table with one `tbody` for each entry, as the Table layout draws. */
interface TableFlow {
  readonly kind: "table";
  /** The attributes of the table element. */
  readonly props?: Attributes<HTMLAttributes<HTMLElement>>;
  /** The rows of the table's header, which the window draws in its `thead`. */
  readonly head: ReactNode;
  /** The columns of properties, which a spacer draws an outline for. */
  readonly columns: number;
}

/** What the window draws through `useVirtualRows`. */
interface MountedRows extends VirtualRows {
  /** The ref of the layout's own box, which scrolls the list in a tab. */
  readonly box: (el: HTMLElement | null) => void;
}

/** The classes of every layout's box, which scrolls its list. */
const BOX = "zt:min-h-0 zt:flex-1 zt:overflow-auto zt:[overflow-anchor:none]";

/** The height of a long list, `--zt-virtual-size`, held whatever its rows draw. */
const HOLD = "zt:box-content zt:h-(--zt-virtual-size) zt:overflow-y-clip";

/**
 * A long list's box draws its rows' outlines as its background, inside its
 * padding, where the list draws its rows (`virtual-spacers.tsx`).
 */
const OUTLINES = "zt:bg-origin-content zt:bg-clip-content";

/**
 * An entry of a long list covers the outlines under it with the colour the
 * page shows there: a side dock's, or a callout's tint over the page, as a
 * Table's header does.
 */
const SURFACE =
  "zt:bg-background zt:in-[.mod-sidedock]:bg-(--background-secondary) zt:in-[.callout]:bg-[image:linear-gradient(color-mix(in_oklch,var(--callout-color)_10%,transparent),color-mix(in_oklch,var(--callout-color)_10%,transparent))]";

/**
 * The list of `view`'s Items Layout over `entries`, mounted near the screen
 * in a box of its own.
 * @param estimates The height of an entry of each kind before it is measured.
 * @param shape What the entries' heights follow beside their content, such
 *   as the layout's options: a change measures them again.
 * @param box The attributes of the box the list scrolls in.
 * @param boxRef The box, as the layout reads it back.
 * @param flow The list's elements: `li` entries in a list, or one `tbody`
 *   for each entry in a table.
 * @param draw Draws the entry at an index of `entries`.
 * @param drew Runs after each draw of the window, as a scroll or a resize
 *   draws it, with the drawn rows in place.
 */
export function ItemsWindow({
  view,
  entries,
  estimates,
  shape,
  box,
  boxRef,
  flow,
  draw,
  drew,
}: {
  view: QueryView;
  entries: readonly WindowEntry[];
  estimates: Estimates;
  shape?: string;
  box?: Attributes<HTMLAttributes<HTMLElement>>;
  boxRef?: (el: HTMLElement | null) => void;
  flow: ListFlow | TableFlow;
  draw: (index: number) => DrawnEntry;
  drew?: () => void;
}) {
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs after each draw on purpose
  useLayoutEffect(() => drew?.());
  // A table's header stays over its rows as they scroll: a row scrolled into
  // view lands under it, and the box's scroll bar starts under it, so a
  // press at the header's edge never lands on the bar (`table-header.css`).
  const [head, setHead] = useState<HTMLElement | null>(null);
  const [header, setHeader] = useState(0);
  useLayoutEffect(() => {
    if (!head) {
      setHeader(0);
      return;
    }
    const read = () => setHeader(head.offsetHeight);
    read();
    const observing = observeResize(head, [head], read);
    return () => observing[Symbol.dispose]();
  }, [head]);
  const {
    entries: mounted,
    after,
    measure,
    list: listRef,
    onFocus,
    learned,
    size,
    box: setBox,
  } = useItemsWindow(view, entries, { estimates, shape, sticky: header });
  const mountBox = useCallback(
    (el: HTMLDivElement | null) => {
      setBox(el);
      boxRef?.(el);
    },
    [setBox, boxRef],
  );
  const spacer = (height: number) =>
    flow.kind === "list" ? (
      <ListSpacer height={height} />
    ) : (
      <TableSpacer height={height} columns={flow.columns} />
    );
  const rows = mounted.map(({ index, before }) => {
    const { props, children } = draw(index);
    const element = {
      ...props,
      className: cn(props?.className, size !== null && SURFACE),
      ref: measure,
      "data-index": index,
    };
    return (
      <Fragment key={entries[index]!.key}>
        {before > 0 && spacer(before)}
        {flow.kind === "list" ? (
          <li {...element}>{children}</li>
        ) : (
          <tbody {...element}>{children}</tbody>
        )}
      </Fragment>
    );
  });
  const end = after > 0 && spacer(after);
  // A long list stands at the height its window lays out, its header's with
  // it: a row that draws at another height than it took then moves the rows
  // under it, not the list's length under a scroll bar drag.
  const hold = size !== null && HOLD;
  let list: ReactNode;
  if (flow.kind === "list") {
    const List = flow.as;
    list = (
      <List
        ref={listRef}
        {...flow.props}
        className={cn(flow.props?.className, hold)}
        onFocus={onFocus}
      >
        {rows}
        {end}
      </List>
    );
  } else
    list = (
      // A table stands at the height of its rows at least: it holds its
      // height in a block that clips it.
      <div className={cn(hold)}>
        <table {...flow.props} onFocus={onFocus}>
          {flow.head && <thead ref={setHead}>{flow.head}</thead>}
          {/* The rows start here, under the header. */}
          <tbody ref={listRef} />
          {rows}
          {end}
        </table>
      </div>
    );
  return (
    <div
      ref={mountBox}
      {...box}
      className={cn(
        BOX,
        box?.className,
        size !== null && [
          OUTLINES,
          flow.kind === "list" ? flow.ghost : TABLE_GHOST,
        ],
      )}
      style={{
        ...placeholderRow(learned.get("row") ?? estimates.row),
        ...(flow.kind === "table" && {
          "--zt-table-header-height": `${header}px`,
        }),
        ...(size !== null && {
          "--zt-virtual-size": `${flow.kind === "table" ? header + size : size}px`,
        }),
      }}
    >
      {list}
    </div>
  );
}

/** The window of `view`'s Items Layout over `entries`. */
function useItemsWindow(
  view: QueryView,
  entries: readonly WindowEntry[],
  {
    estimates,
    shape,
    sticky,
  }: { estimates: Estimates; shape: string | undefined; sticky: number },
): MountedRows {
  const gestures = view.rows;
  const [own, setOwn] = useState<HTMLElement | null>(null);

  /** The Item rows in order, and the place of each Item's first row. */
  const { keys, places } = useMemo(() => {
    const keys: string[] = [];
    const places = new Map<string, number>();
    entries.forEach(({ item }, index) => {
      if (item === null) return;
      keys.push(item);
      if (!places.has(item)) places.set(item, index);
    });
    return { keys, places };
  }, [entries]);

  // The host's keys find the selected row, and the Tab stop is the first
  // row while none is selected: both stay mounted wherever they are.
  const selected = useSyncExternalStore(
    (listener) => gestures?.selection.subscribe(listener) ?? (() => {}),
    () => gestures?.selection.getState().key ?? null,
  );
  const first = gestures?.first() ?? null;
  const pinned = useMemo(
    () =>
      [selected, first].flatMap((key) =>
        key === null ? [] : [places.get(key) ?? -1],
      ),
    [selected, first, places],
  );

  const rows = useVirtualRows({
    count: entries.length,
    own,
    estimate: useCallback(
      (index: number) => {
        const entry = entries[index]!;
        return entry.height ?? estimates[entry.kind] ?? estimates.row;
      },
      [entries, estimates],
    ),
    kindOf: useCallback(
      (index: number) => {
        const entry = entries[index]!;
        return entry.own || entry.height !== undefined ? null : entry.kind;
      },
      [entries],
    ),
    keyOf: useCallback((index: number) => entries[index]!.key, [entries]),
    pinned,
    ...(shape !== undefined && { shape }),
    sticky,
    all: view.printing,
  });

  const { scrollTo } = rows;
  useLayoutEffect(() => {
    gestures?.shown({
      keys,
      scrollTo: (key) => {
        const index = places.get(key);
        if (index === undefined || scrollTo(index)) return;
        // A list that mounts every row scrolls the row's own element.
        [...(own?.querySelectorAll(`[${ITEM_ROW_ATTRIBUTE}]`) ?? [])]
          .find((row) => row.getAttribute(ITEM_ROW_ATTRIBUTE) === key)
          ?.scrollIntoView({ block: "nearest" });
      },
    });
    // A layout that goes shows no rows.
    return () => gestures?.shown(NO_ROWS);
  }, [gestures, keys, places, scrollTo, own]);

  return { ...rows, box: setOwn };
}
