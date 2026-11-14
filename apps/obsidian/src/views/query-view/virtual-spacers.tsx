// The spacers that stand for the entries a long list leaves out: one row of
// a list, or one body of a table, as high as those entries. A spacer takes
// its height and nothing else.
//
// The faint outline of each row is the background of the layout's box,
// which the entries cover. A scroll bar dragged fast moves the list further
// each frame than the page can paint, and the browser shows only what the
// box paints itself in time: its background stays in view as its content
// scrolls, so the box shows the shape of its rows, not an empty page. The
// outlines repeat at the height of one row, which the window sets as
// `--zt-virtual-row` on the box.
import type { CSSProperties } from "react";

/** The height of the left-out entries, read back by a utility. */
const gap = (height: number) =>
  ({ "--zt-virtual-gap": `${height}px` }) as CSSProperties;

/** The style that sets the outlines' spacing on a layout's box. */
export const placeholderRow = (height: number) =>
  ({ "--zt-virtual-row": `${height}px` }) as CSSProperties;

/**
 * The outline of a List row: a bar half a line tall, across part of the
 * row, at its middle, past the markers' indent.
 */
export const LIST_GHOST =
  "zt:bg-[image:linear-gradient(to_bottom,transparent_calc(50%-0.3em),var(--background-modifier-hover)_0_calc(50%+0.3em),transparent_0)] zt:bg-size-[min(60%,24rem)_var(--zt-virtual-row,2.5em)] zt:bg-position-[calc(var(--list-indent)+var(--size-4-3))_0] zt:bg-repeat-y";

/**
 * The outline of a Table row: the line under it, and a bar at the first
 * property cell's padding, past the expand buttons' column.
 */
export const TABLE_GHOST =
  "zt:bg-[image:linear-gradient(to_bottom,transparent_calc(50%-0.3em),var(--background-modifier-hover)_0_calc(50%+0.3em),transparent_0),linear-gradient(to_bottom,transparent_calc(100%-var(--border-width)),var(--table-border-color)_0)] zt:bg-size-[min(40%,12rem)_var(--zt-virtual-row,2.5em),100%_var(--zt-virtual-row,2.5em)] zt:bg-position-[calc(30px+var(--size-4-2))_var(--zt-table-header-height,0px),0_var(--zt-table-header-height,0px)] zt:bg-repeat-y";

/** The room of the entries a long list leaves out. */
export function ListSpacer({ height }: { height: number }) {
  return (
    <li
      aria-hidden="true"
      className="zt:h-(--zt-virtual-gap) zt:list-none"
      style={gap(height)}
      data-query-spacer=""
    />
  );
}

/**
 * The room of the rows a long table leaves out: one cell across the
 * expand buttons' column, the `columns` and the filler.
 */
export function TableSpacer({
  height,
  columns,
}: {
  height: number;
  columns: number;
}) {
  return (
    <tbody aria-hidden="true" data-query-spacer="">
      <tr>
        <td
          colSpan={columns + 2}
          className="zt:h-(--zt-virtual-gap) zt:p-0"
          style={gap(height)}
        />
      </tr>
    </tbody>
  );
}
