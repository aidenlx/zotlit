// The spacers that stand for the entries a long list leaves out: one row of
// a list, or one body of a table, as high as those entries.
//
// A spacer draws a faint outline of each row it stands for, in the shape of
// the layout's rows. A scroll bar dragged fast moves the list a few frames
// before the rows for the new place are drawn; the list then shows the shape
// of its rows, not an empty page. The outlines repeat at the height of one
// row, which the layout sets as `--zt-virtual-row` on its box.
import type { CSSProperties } from "react";

/** The height of the left-out entries, read back by a utility. */
const gap = (height: number) =>
  ({ "--zt-virtual-gap": `${height}px` }) as CSSProperties;

/** The style that sets the outlines' spacing on a layout's box. */
export const placeholderRow = (height: number) =>
  ({ "--zt-virtual-row": `${height}px` }) as CSSProperties;

/**
 * The outline of a List row: a bar half a line tall, across part of the
 * row, at its middle.
 */
export const LIST_GHOST =
  "zt:bg-[image:linear-gradient(to_bottom,transparent_calc(50%-0.3em),var(--background-modifier-hover)_0_calc(50%+0.3em),transparent_0)] zt:bg-size-[min(60%,24rem)_var(--zt-virtual-row,2.5em)] zt:bg-position-[var(--size-4-3)_0] zt:bg-repeat-y";

/** The outline of a Table row's line, under each row. */
const LINE_GHOST =
  "zt:bg-[image:linear-gradient(to_bottom,transparent_calc(100%-var(--border-width)),var(--table-border-color)_0)] zt:bg-size-[100%_var(--zt-virtual-row,2.5em)] zt:bg-repeat-y";

/**
 * The outline of a Table cell: a bar at the cell's padding, the row's line
 * under it, and the line between it and the column before, as a cell past
 * the first draws.
 */
const CELL_GHOST =
  "zt:bg-[image:linear-gradient(to_bottom,transparent_calc(50%-0.3em),var(--background-modifier-hover)_0_calc(50%+0.3em),transparent_0),linear-gradient(to_bottom,transparent_calc(100%-var(--border-width)),var(--table-border-color)_0)] zt:bg-size-[min(70%,12rem)_var(--zt-virtual-row,2.5em),100%_var(--zt-virtual-row,2.5em)] zt:bg-position-[var(--size-4-2)_0,0_0] zt:bg-repeat-y";
const LATER_CELL_GHOST = `${CELL_GHOST} zt:border-s-(length:--border-width) zt:border-(--table-border-color)`;

/**
 * The room of the entries a long list leaves out, with the outline `ghost`
 * of each of its rows.
 */
export function ListSpacer({
  height,
  ghost,
}: {
  height: number;
  ghost: string;
}) {
  return (
    <li
      aria-hidden="true"
      className={`zt:h-(--zt-virtual-gap) zt:list-none ${ghost}`}
      style={gap(height)}
      data-query-spacer=""
    />
  );
}

/**
 * The room of the rows a long table leaves out: a cell for the expand
 * buttons' column, one for each of the `columns`, and the filler.
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
          className={`zt:h-(--zt-virtual-gap) zt:p-0 ${LINE_GHOST}`}
          style={gap(height)}
        />
        {Array.from({ length: columns }, (_, column) => (
          <td
            key={column}
            className={`zt:p-0 ${column === 0 ? CELL_GHOST : LATER_CELL_GHOST}`}
          />
        ))}
        <td className={`zt:p-0 ${LINE_GHOST}`} />
      </tr>
    </tbody>
  );
}
