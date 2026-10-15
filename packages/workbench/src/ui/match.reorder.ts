// Drag a condition or a group by its handle to another place in the tree, as
// the Bases filter menu does: before or after a row of any group, above a
// nested group by its header, or at the end of a group by its body. The
// keyboard moves one place with Alt+ArrowUp and Alt+ArrowDown on the handle,
// as the Query View's Sort and Group lists do.
import { useEffect, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";

import { moveAt, pathStartsWith, samePath } from "./match.draft";
import type { ConditionGroup, ConditionPath, LabelledRow } from "./match.draft";

const DRAG_TYPE = "application/x-zotlit-match-condition";

/**
 * Where a drop lands: before the condition at `before` in the group at
 * `group`, both as the tree stands while the dragged condition is still in it.
 */
interface DropTarget {
  group: ConditionPath;
  before: number;
}

/**
 * The index `moveAt` takes for a drop of the condition at `from` on `target`.
 *
 * @returns `null` where the drop changes nothing: the condition's own place.
 */
function moveIndex(from: ConditionPath, target: DropTarget): number | null {
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

const pathKey = (path: ConditionPath) => path.join(".");

/**
 * The drag state of one Match editor and the props that wire its parts:
 * `fieldset` commits a drop, `handle` starts one, `row` and `header` place it
 * beside a condition or above a group, `group` and `rows` place it at the end
 * of a group or keep the place across a gap.
 */
export function useMatchReorder<Row extends LabelledRow>({
  root,
  disabled,
  onChange,
}: {
  root: ConditionGroup<Row>;
  disabled: boolean;
  onChange: (root: ConditionGroup<Row>) => void;
}) {
  // The handlers read the drag from refs: a browser can send the next drag
  // event before the state of the last one has rendered.
  const [dragging, setDraggingState] = useState<ConditionPath | null>(null);
  const [over, setOverState] = useState<DropTarget | null>(null);
  const draggingRef = useRef<ConditionPath | null>(null);
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
  /** The tree with `from` dropped on `target`, saved when it changed. */
  function move(from: ConditionPath, target: DropTarget): boolean {
    const index = moveIndex(from, target);
    if (index === null) return false;
    const next = moveAt(root, from, { group: target.group, index });
    if (next === root) return false;
    onChange(next);
    return true;
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
    fieldset: {
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
    handle: (path: ConditionPath, count: number) => ({
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
          const row = event.currentTarget.parentElement;
          const rect = row?.getBoundingClientRect();
          if (row && rect)
            event.dataTransfer.setDragImage?.(
              row,
              event.clientX - rect.left,
              event.clientY - rect.top,
            );
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
        const list = event.currentTarget.closest("fieldset");
        if (move(path, { group, before: step > 0 ? at + 2 : at - 1 }) && list)
          focusNext.current = { list, path: pathKey([...group, at + step]) };
      },
    }),
    // One mark per place: before a row, or after the last row of a group.
    row: (path: ConditionPath, count: number) => {
      const group = path.slice(0, -1);
      const at = path.at(-1)!;
      return {
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
    header: (path: ConditionPath) => ({
      onDragOver: target(() =>
        path.length === 0
          ? { group: path, before: 0 }
          : { group: path.slice(0, -1), before: path.at(-1)! },
      ),
    }),
    group: (path: ConditionPath, count: number) => ({
      // An empty group has no row to mark, so the group takes the mark.
      "data-drop":
        shown && count === 0 && samePath(shown.group, path)
          ? "into"
          : undefined,
      onDragOver: target(() => ({ group: path, before: count })),
    }),
    // A gap between the rows of a group keeps the place its last row gave.
    rows: (path: ConditionPath) => ({
      onDragOver: target(() =>
        overRef.current && samePath(overRef.current.group, path)
          ? overRef.current
          : null,
      ),
    }),
  };
}

export type MatchReorder = ReturnType<typeof useMatchReorder>;
