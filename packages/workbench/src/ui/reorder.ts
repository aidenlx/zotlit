// Drag a row by its handle to another place in a list or a tree of lists, as
// the Bases filter menu does: before or after a row of any group, above a
// nested group by its header, or at the end of a group by its body. The
// keyboard moves one place with Alt+ArrowUp and Alt+ArrowDown on the handle,
// as the Query View's Sort and Group lists do. A flat list is a tree of one
// group, whose rows sit at `[index]`.
import { useEffect, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";

import { pathStartsWith, samePath } from "./row-path";
import type { RowPath } from "./row-path";

const DRAG_TYPE = "application/x-zotlit-reorder";

/**
 * Where a drop lands: before the row at `before` in the group at `group`, both
 * as the tree stands while the dragged row is still in it.
 */
interface DropTarget {
  group: RowPath;
  before: number;
}

/**
 * The index the row at `from` takes in `target.group` once it is out of its
 * own place, for a drop on `target`.
 *
 * @returns `null` where the drop changes nothing: the row's own place.
 */
function moveIndex(from: RowPath, target: DropTarget): number | null {
  const at = from.at(-1)!;
  if (!samePath(from.slice(0, -1), target.group)) return target.before;
  if (target.before === at || target.before === at + 1) return null;
  return target.before > at ? target.before - 1 : target.before;
}

/** Whether the pointer is past the middle of the element it is over. */
function lowerHalf(event: DragEvent<HTMLElement>): boolean {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2;
}

const pathKey = (path: RowPath) => path.join(".");

/** Where a moved row goes: the index it takes in the group at `group`. */
export interface ReorderDestination {
  group: RowPath;
  index: number;
}

/**
 * The drag state of one reorderable list and the props that wire its parts:
 * `list` commits a drop, `handle` starts one, `row` and `header` place it
 * beside a row or above a group, `group` and `rows` place it at the end of a
 * group or keep the place across a gap.
 */
export function useReorder({
  disabled,
  onMove,
}: {
  disabled: boolean;
  /** Saves the move; answers whether anything changed. */
  onMove: (from: RowPath, to: ReorderDestination) => boolean;
}) {
  // The handlers read the drag from refs: a browser can send the next drag
  // event before the state of the last one has rendered.
  const [dragging, setDraggingState] = useState<RowPath | null>(null);
  const [over, setOverState] = useState<DropTarget | null>(null);
  const draggingRef = useRef<RowPath | null>(null);
  const overRef = useRef<DropTarget | null>(null);
  // Rows render by index, so a handle the keyboard moved hands its focus to
  // the handle that now holds the row.
  const focusNext = useRef<{ list: Element; path: string } | null>(null);
  useEffect(() => {
    const next = focusNext.current;
    if (!next) return;
    focusNext.current = null;
    next.list
      .querySelector<HTMLElement>(`[data-reorder-handle="${next.path}"]`)
      ?.focus();
  });
  function setOver(next: DropTarget | null) {
    const current = overRef.current;
    if (
      current === next ||
      (current &&
        next &&
        current.before === next.before &&
        samePath(current.group, next.group))
    )
      return;
    overRef.current = next;
    setOverState(next);
  }
  const shown =
    dragging && over && moveIndex(dragging, over) !== null ? over : null;
  function end() {
    draggingRef.current = null;
    setDraggingState(null);
    setOver(null);
  }
  /** Saves `from` dropped on `target`, and answers whether it moved. */
  function move(from: RowPath, target: DropTarget): boolean {
    const index = moveIndex(from, target);
    if (index === null) return false;
    return onMove(from, { group: target.group, index });
  }
  /**
   * A dragover handler that places the drop where `place` answers. Where it
   * answers none, or a group into itself, the element takes no drop.
   */
  function target(place: (event: DragEvent<HTMLElement>) => DropTarget | null) {
    return (event: DragEvent<HTMLElement>) => {
      const from = draggingRef.current;
      if (!from) return;
      event.stopPropagation();
      const next = place(event);
      if (next === null || pathStartsWith(next.group, from)) {
        setOver(null);
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      setOver(next);
    };
  }
  return {
    list: {
      "data-reorder-list": "",
      onDrop: (event: DragEvent<HTMLElement>) => {
        const from = draggingRef.current;
        if (!from) return;
        event.preventDefault();
        if (overRef.current) move(from, overRef.current);
        end();
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        // Chromium may leave `relatedTarget` empty on a drag event, so the
        // point the pointer went to answers where it is.
        const into =
          event.relatedTarget ??
          event.currentTarget.ownerDocument.elementFromPoint(
            event.clientX,
            event.clientY,
          );
        if (!(into instanceof Node) || !event.currentTarget.contains(into))
          setOver(null);
      },
    },
    handle: (path: RowPath, count: number) => ({
      draggable: !disabled,
      role: "button" as const,
      tabIndex: disabled ? -1 : 0,
      "aria-disabled": disabled || undefined,
      "data-reorder-handle": pathKey(path),
      onDragStart: (event: DragEvent<HTMLElement>) => {
        if (disabled) return;
        event.stopPropagation();
        event.dataTransfer?.setData(DRAG_TYPE, pathKey(path));
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          // The browser draws the whole row, as Bases draws the card, rather
          // than the handle alone.
          const row =
            event.currentTarget.closest<HTMLElement>("[data-reorder-row]");
          if (row) {
            const rect = row.getBoundingClientRect();
            // Chromium fills the corners outside a rounded row in the image
            // it takes; a row on its own compositing layer keeps them clear.
            // The layer stays only until the image is taken.
            const transform = row.style.transform;
            row.style.transform = "translateZ(0)";
            event.dataTransfer.setDragImage?.(
              row,
              event.clientX - rect.left,
              event.clientY - rect.top,
            );
            setTimeout(() => {
              row.style.transform = transform;
            });
          }
        }
        draggingRef.current = path;
        // The row fades once the browser has taken its drag image.
        setTimeout(() => {
          if (draggingRef.current === path) setDraggingState(path);
        });
      },
      onDragEnd: end,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (disabled || !event.altKey) return;
        const step =
          event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
        const at = path.at(-1)!;
        if (step === 0 || at + step < 0 || at + step >= count) return;
        event.preventDefault();
        const group = path.slice(0, -1);
        const list = event.currentTarget.closest("[data-reorder-list]");
        if (move(path, { group, before: step > 0 ? at + 2 : at - 1 }) && list)
          focusNext.current = { list, path: pathKey([...group, at + step]) };
      },
    }),
    // One mark per place: before a row, or after the last row of a group.
    row: (path: RowPath, count: number) => {
      const group = path.slice(0, -1);
      const at = path.at(-1)!;
      return {
        "data-reorder-row": "",
        "data-dragging": dragging && samePath(dragging, path) ? "" : undefined,
        "data-drop":
          shown && samePath(shown.group, group)
            ? shown.before === at
              ? "before"
              : shown.before === count && at === count - 1
                ? "after"
                : undefined
            : undefined,
        onDragOver: target((event) => ({
          group,
          before: lowerHalf(event) ? at + 1 : at,
        })),
      };
    },
    header: (path: RowPath) => ({
      onDragOver: target(() =>
        path.length === 0
          ? { group: path, before: 0 }
          : { group: path.slice(0, -1), before: path.at(-1)! },
      ),
    }),
    group: (path: RowPath, count: number) => ({
      // An empty group has no row to mark, so the group takes the mark.
      "data-drop":
        shown && count === 0 && samePath(shown.group, path)
          ? "into"
          : undefined,
      onDragOver: target(() => ({ group: path, before: count })),
    }),
    // A gap between the rows of a group keeps the place its last row gave.
    rows: (path: RowPath) => ({
      onDragOver: target(() =>
        overRef.current && samePath(overRef.current.group, path)
          ? overRef.current
          : null,
      ),
    }),
  };
}

export type Reorder = ReturnType<typeof useReorder>;

/**
 * Where a row of a flat list stands once another row has moved. The list may
 * count from 0 or from 1, so long as all three arguments count alike.
 *
 * @param at - the row's place before the move.
 * @param from - the moved row's place before the move.
 * @param to - the moved row's place after it.
 * @returns the row's place after the move.
 */
export function indexAfterMove(at: number, from: number, to: number): number {
  if (at === from) return to;
  if (from < at && at <= to) return at - 1;
  if (to <= at && at < from) return at + 1;
  return at;
}

/**
 * The drag state of one flat list, its rows addressed by index: `list` goes on
 * the element that holds the rows, `row` and `handle` on each row.
 */
export function useListReorder({
  disabled,
  onMove,
}: {
  disabled: boolean;
  /** Saves the row at `from` moved to `to`; answers whether anything changed. */
  onMove: (from: number, to: number) => boolean;
}) {
  const reorder = useReorder({
    disabled,
    onMove: (from, { index }) => onMove(from.at(-1)!, index),
  });
  return {
    list: { ...reorder.list, ...reorder.rows([]) },
    row: (index: number, count: number) => reorder.row([index], count),
    handle: (index: number, count: number) => reorder.handle([index], count),
  };
}
