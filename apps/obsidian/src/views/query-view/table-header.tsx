// The Table layout's header row, whose cells move and resize their columns as in a Bases table.

import { Menu } from "obsidian";
import { useEffect, useRef } from "react";
import type { CSSProperties, DragEvent, MouseEvent, RefObject } from "react";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { cn, tooltipAttrs } from "@/lib/utils";

import { propertyIcon } from "./property-icon";
import type { ColumnSizes, QueryFileDataset } from "./query-file";
import { moved } from "./reorder";
import {
  dropGap,
  gapMove,
  resizedWidth,
  withColumnWidth,
} from "./table-columns";
import "./table-header.css";
import type { QueryView } from "./view";
import { viewProperties } from "./view-properties";
import type { ViewProperties } from "./view-properties";

/** The cell classes the header shares with the rows under it. */
export interface HeaderClasses {
  /** The expand-button column. */
  readonly gutter: string;
  /** Every header cell. */
  readonly cell: string;
  /** The first column of properties. */
  readonly first: string;
  /** A column after the first. */
  readonly later: string;
}

/** A transparent image, so a drag shows the drop line and no picture of the header. */
const BLANK =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=";

/** Start a drag that moves nothing the browser knows: no picture, a grabbing cursor. */
function startDrag(event: DragEvent<HTMLElement>): void {
  const doc = event.currentTarget.doc;
  const transfer = event.dataTransfer;
  transfer.effectAllowed = "move";
  transfer.setData("text/plain", "");
  const image = doc.createElement("img");
  image.src = BLANK;
  doc.body.append(image);
  transfer.setDragImage(image, 0, 0);
  doc.win.setTimeout(() => image.remove(), 0);
  doc.body.classList.add("is-grabbing");
}

/** What one column drag does as it goes, and once it is over. */
interface DragHandlers {
  /**
   * Follow the pointer.
   * @returns Whether the place under the pointer takes the drop.
   */
  over: (event: globalThis.DragEvent) => boolean;
  /**
   * Take the drop, or leave it to the page.
   * @returns Whether the drag dropped.
   */
  drop: (event: globalThis.DragEvent) => boolean;
  /**
   * Clean up after the drag, whatever ended it: a drop, the end of the drag
   * without one (as Escape ends it), or the Table that closes mid-drag.
   */
  done: (dropped: boolean) => void;
}

/**
 * Follow a drag on the window of `source`, before any target does, as Bases
 * does: the pointer can leave the table. Aborting `controller` ends the
 * drag, and so does a drop or the end of the drag; an end on the window
 * covers a source the Table took off the page.
 */
function followDrag(
  source: HTMLElement,
  controller: AbortController,
  handlers: DragHandlers,
): void {
  const { doc, win } = source;
  const { signal } = controller;
  const options = { capture: true, signal };
  let dropped = false;
  signal.addEventListener(
    "abort",
    () => {
      doc.body.classList.remove("is-grabbing");
      handlers.done(dropped);
    },
    { once: true },
  );
  const over = (event: globalThis.DragEvent) => {
    if (!handlers.over(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  };
  win.addEventListener("dragover", over, options);
  win.addEventListener("dragenter", over, options);
  win.addEventListener(
    "drop",
    (event) => {
      dropped = handlers.drop(event);
      controller.abort();
    },
    options,
  );
  const end = () => controller.abort();
  source.addEventListener("dragend", end, { signal });
  win.addEventListener("dragend", end, options);
}

/** The narrowest a column can be, from the variable Bases reads. */
function minColumnWidth(el: HTMLElement): number {
  return Number.parseFloat(
    el.win
      .getComputedStyle(el)
      .getPropertyValue("--bases-table-column-min-width"),
  );
}

/** Whether `el` lays out right to left. */
const isRTL = (el: HTMLElement) =>
  el.win.getComputedStyle(el).direction === "rtl";

/**
 * A header cell with a set width holds its column at that width: the
 * `--zt-column-width` of a cell marked `data-sized`.
 */
const SIZED =
  "zt:data-sized:w-(--zt-column-width) zt:data-sized:min-w-(--zt-column-width) zt:data-sized:max-w-(--zt-column-width)";

const COLUMN_WIDTH = "--zt-column-width";

const widthStyle = (width: number) =>
  ({ [COLUMN_WIDTH]: `${width}px` }) as CSSProperties;

/** The body cells of the column of `th`: one in each Item row. */
function bodyCells(th: HTMLTableCellElement): HTMLElement[] {
  const rows = th
    .closest("table")
    ?.querySelectorAll<HTMLTableRowElement>(
      ':scope > tbody > tr[data-query-table-row="item"]',
    );
  return [...(rows ?? [])].flatMap((row) => row.cells[th.cellIndex] ?? []);
}

/**
 * Mark the column of `th` as set, or not, at once, ahead of the save that
 * renders the mark: a set column clips its body cells.
 */
function markSized(th: HTMLTableCellElement, sized: boolean): void {
  for (const cell of [th, ...bodyCells(th)])
    if (sized) cell.dataset.sized = "";
    else delete cell.dataset.sized;
}

/** The `data-sized` mark of the cells of the column of `path`. */
export const sizedMark = (
  sizes: ColumnSizes | undefined,
  path: string,
): "" | undefined => (sizes?.[path] === undefined ? undefined : "");

/** Show `width` on a header cell at once, ahead of the save that sets it. */
function showWidth(th: HTMLTableCellElement, width: number): void {
  markSized(th, true);
  th.style.setProperty(COLUMN_WIDTH, `${width}px`);
}

/**
 * A header label, which a set column clips: it takes no room of its own,
 * so the column can be narrower than the label.
 */
const LABEL =
  "zt:flex zt:items-center zt:gap-1 zt:group-data-sized/column:w-0 zt:group-data-sized/column:min-w-full";

/**
 * Obsidian's drop line between table columns, placed by `--zt-drop-*`;
 * `table-header.css` lifts it over the sticky header.
 */
const DROP_LINE =
  "table-drag-target mod-col zt-column-drop-line zt:start-(--zt-drop-x) zt:top-(--zt-drop-top) zt:h-(--zt-drop-height) zt:transition-all zt:duration-75 zt:ease-in";

/** The header row: one cell for each visible property, then the Literature note column. */
export function TableHeader({
  view,
  properties,
  dataset,
  scroller,
  classes,
  sizes,
}: {
  view: QueryView;
  properties: ViewProperties;
  dataset: QueryFileDataset;
  /** The box the table scrolls in, which holds the drop line. */
  scroller: RefObject<HTMLElement | null>;
  classes: HeaderClasses;
  /** The widths the researcher set, by property path. */
  sizes: ColumnSizes | undefined;
}) {
  const columns = properties.visible;
  const editable = view.canSave;
  /** The drag on now; the Table that closes ends it. */
  const drag = useRef<AbortController | null>(null);
  useEffect(() => () => drag.current?.abort(), []);
  /** A new drag, which ends the one before it. */
  const begin = (): AbortController => {
    drag.current?.abort();
    const controller = new AbortController();
    drag.current = controller;
    return controller;
  };

  /** The header cells of the property columns, in their order. */
  const headerCells = (row: Element) => [
    ...row.querySelectorAll<HTMLElement>(":scope > th[data-query-column]"),
  ];

  const moveColumn = (event: DragEvent<HTMLElement>, path: string) => {
    const th = event.currentTarget;
    const row = th.parentElement!;
    const box = scroller.current;
    const table = th.closest("table");
    if (!box || !table) return;
    const controller = begin();
    startDrag(event);
    const line = th.doc.createElement("div");
    line.className = DROP_LINE;
    /**
     * Where the pointer at `clientX` drops the column, read from the header
     * on screen: its columns, the place of the dragged one, and the gap.
     */
    const place = (clientX: number) => {
      const cells = headerCells(row);
      const from = cells.findIndex((cell) => cell.dataset.queryColumn === path);
      const first = cells[0];
      if (from < 0 || !first) return null;
      const rtl = isRTL(row);
      const start = first.getBoundingClientRect();
      const widths = cells.map((cell) => cell.getBoundingClientRect().width);
      const gap = dropGap(
        widths,
        from,
        rtl ? start.right - clientX : clientX - start.left,
      );
      const run = widths.slice(0, gap).reduce((sum, w) => sum + w, 0);
      return {
        paths: cells.map((cell) => cell.dataset.queryColumn!),
        from,
        gap,
        edge: rtl ? start.right - run : start.left + run,
        rtl,
      };
    };
    followDrag(th, controller, {
      over: (over) => {
        // Only the table takes the drop; elsewhere the line goes.
        const at = table.contains(over.targetNode) ? place(over.clientX) : null;
        if (!at) {
          line.remove();
          return false;
        }
        const frame = box.getBoundingClientRect();
        // The line's distance from the box's start edge, in its content.
        const x = at.rtl
          ? frame.right - box.clientLeft - at.edge - box.scrollLeft
          : at.edge - frame.left - box.clientLeft + box.scrollLeft;
        if (!line.isConnected) box.append(line);
        line.style.setProperty("--zt-drop-x", `${x}px`);
        line.style.setProperty("--zt-drop-top", `${box.scrollTop}px`);
        line.style.setProperty("--zt-drop-height", `${box.clientHeight}px`);
        return true;
      },
      drop: (drop) => {
        // A drop outside the table moves nothing.
        if (!table.contains(drop.targetNode)) return false;
        drop.preventDefault();
        const at = place(drop.clientX);
        // The order as the view holds it now, which a save can change while
        // the drag is on. Where the header on screen shows another order,
        // or no longer shows the column, the drop moves nothing.
        const { file, view: shown } = view.state.getState();
        if (!at || !shown) return true;
        const current = viewProperties(file, shown);
        const order = current.visible.map((entry) => entry.path);
        if (order.join("\0") !== at.paths.join("\0")) return true;
        const to = gapMove(at.from, at.gap);
        if (to !== null)
          view.document.editView({
            order: current.orderOf(moved(order, at.from, to)),
          });
        return true;
      },
      done: () => line.remove(),
    });
  };

  const resizeColumn = (event: DragEvent<HTMLElement>, path: string) => {
    // The header cell would take the drag as a move.
    event.stopPropagation();
    const handle = event.currentTarget;
    const th = handle.closest("th")!;
    const controller = begin();
    startDrag(event);
    const before = {
      sized: th.dataset.sized,
      width: th.style.getPropertyValue(COLUMN_WIDTH),
    };
    const start = th.getBoundingClientRect().width;
    const origin = event.clientX;
    const min = minColumnWidth(th);
    const direction = isRTL(th) ? "rtl" : "ltr";
    let width = Math.max(min, Math.round(start));
    let frame = 0;
    const { win } = th;
    handle.classList.add("is-active");
    followDrag(handle, controller, {
      over: (over) => {
        width = resizedWidth({
          start,
          delta: over.clientX - origin,
          direction,
          min,
        });
        if (frame) return true;
        frame = win.requestAnimationFrame(() => {
          frame = 0;
          showWidth(th, width);
        });
        return true;
      },
      drop: (drop) => {
        drop.preventDefault();
        win.cancelAnimationFrame(frame);
        showWidth(th, width);
        // The widths as the view holds them now, which a save can change
        // while the drag is on.
        const saved = view.state.getState().view?.columnSize;
        if (saved?.[path] !== width)
          view.document.editView({
            columnSize: withColumnWidth(saved, path, width),
          });
        return true;
      },
      // A drag that ends without a drop leaves the width as it was.
      done: (dropped) => {
        win.cancelAnimationFrame(frame);
        handle.classList.remove("is-active");
        if (dropped) return;
        if (before.sized === undefined) markSized(th, false);
        th.style.setProperty(COLUMN_WIDTH, before.width);
      },
    });
  };

  const resetColumn = (path: string) => {
    if (sizes?.[path] === undefined) return;
    view.document.editView({
      columnSize: withColumnWidth(sizes, path, null),
    });
  };

  /** A right click on a resized header offers to set its width back. */
  const columnMenu = (event: MouseEvent<HTMLElement>, path: string) => {
    if (sizes?.[path] === undefined) return;
    event.preventDefault();
    new Menu()
      .addItem((item) =>
        item
          .setTitle(m.query_view_table_reset_column_size())
          .setIcon("lucide-rotate-ccw")
          .onClick(() => resetColumn(path)),
      )
      .setParentElement(event.currentTarget)
      .showAtMouseEvent(event.nativeEvent);
  };

  const { gutter, cell, first, later } = classes;
  return (
    <thead>
      <tr className="zt:text-start">
        <th className={gutter} />
        {columns.map((property, at) => {
          const width = sizes?.[property.path];
          return (
            <th
              key={property.path}
              className={cn(
                "zt:group/column",
                cell,
                at === 0 ? first : later,
                SIZED,
              )}
              style={width === undefined ? undefined : widthStyle(width)}
              data-sized={sizedMark(sizes, property.path)}
              data-query-column={property.path}
              data-query-formula-issue={property.issue ?? undefined}
              draggable={editable || undefined}
              onDragStart={
                editable
                  ? (event) => moveColumn(event, property.path)
                  : undefined
              }
              onContextMenu={
                editable
                  ? (event) => columnMenu(event, property.path)
                  : undefined
              }
            >
              {property.issue === null ? (
                <span className={LABEL}>
                  <Icon
                    name={propertyIcon(dataset, property)}
                    size="var(--icon-xs)"
                    className="zt:flex zt:shrink-0"
                  />
                  <span className="zt:truncate">{property.label}</span>
                </span>
              ) : (
                <span
                  className={cn(LABEL, "zt:text-(--text-error)")}
                  {...tooltipAttrs(property.issue)}
                >
                  <Icon
                    name="alert-triangle"
                    size="var(--icon-xs)"
                    strokeWidth="var(--icon-xs-stroke-width)"
                    className="zt:shrink-0"
                  />
                  <span className="zt:truncate">{property.label}</span>
                </span>
              )}
              {editable && (
                <span
                  className={RESIZER}
                  draggable
                  data-query-column-resizer={property.path}
                  onDragStart={(event) => resizeColumn(event, property.path)}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    resetColumn(property.path);
                  }}
                />
              )}
            </th>
          );
        })}
        <th className={cn(cell, later)}>
          <span className="zt:flex zt:items-center zt:gap-1">
            <Icon
              name="file"
              size="var(--icon-xs)"
              className="zt:flex zt:shrink-0"
            />
            {m.query_view_table_literature_note()}
          </span>
        </th>
      </tr>
    </thead>
  );
}

/**
 * The edge of a header cell that sets the column's width: the handle of a
 * Bases table header, a thin strip over the column's end line that shows on
 * hover and holds the accent while it is dragged.
 */
const RESIZER =
  "zt:absolute zt:-end-px zt:inset-y-0 zt:z-(--layer-cover) zt:w-1.5 zt:cursor-col-resize zt:touch-none zt:hover:bg-(--divider-color-hover) zt:[&.is-active]:bg-(--color-accent)";
