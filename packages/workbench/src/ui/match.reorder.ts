// Drag a condition or a group by its handle to another place in the tree, as
// the Bases filter menu does: before or after a row of any group, above a
// nested group by its header, or at the end of a group by its body. The
// keyboard moves one place with Alt+ArrowUp and Alt+ArrowDown on the handle,
// as the Query View's Sort and Group lists do.
import { useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";

import { moveAt } from "./match.draft";
import type {
  ConditionGroup,
  ConditionPath,
  ConditionPlace,
  LabelledRow,
} from "./match.draft";

const DRAG_TYPE = "application/x-zotlit-match-condition";

/** Where a drop lands: before the condition at `index` of the group, as it stands. */
type DropPlace = ConditionPlace;

const startsWith = (path: ConditionPath, prefix: ConditionPath) =>
  prefix.length <= path.length &&
  prefix.every((at, depth) => path[depth] === at);

const samePath = (a: ConditionPath, b: ConditionPath) =>
  a.length === b.length && startsWith(a, b);

/**
 * The index `moveAt` takes for `place`, or `null` where the drop changes
 * nothing: the dragged condition's own place, or a group into itself.
 */
function placeIndex(from: ConditionPath, place: DropPlace): number | null {
  if (startsWith(place.group, from)) return null;
  const at = from.at(-1)!;
  if (!samePath(from.slice(0, -1), place.group)) return place.index;
  if (place.index === at || place.index === at + 1) return null;
  return place.index > at ? place.index - 1 : place.index;
}

/** Whether the pointer is past the middle of the element it is over. */
function lowerHalf(event: DragEvent<HTMLElement>): boolean {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2;
}

/**
 * The drag state of one Match editor and the props that wire its parts:
 * `fieldset` commits a drop, `handle` starts one, `row` and `header` place it
 * beside a condition or above a group, `group` and `rows` place it at the end
 * of a group.
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
  const [over, setOverState] = useState<DropPlace | null>(null);
  const draggingRef = useRef<ConditionPath | null>(null);
  const overRef = useRef<DropPlace | null>(null);
  function setDragging(next: ConditionPath | null) {
    draggingRef.current = next;
    setDraggingState(next);
  }
  function setOver(next: DropPlace | null) {
    const current = overRef.current;
    if (
      current === next ||
      (current &&
        next &&
        current.index === next.index &&
        samePath(current.group, next.group))
    )
      return;
    overRef.current = next;
    setOverState(next);
  }
  const shown =
    dragging && over && placeIndex(dragging, over) !== null ? over : null;
  function end() {
    setDragging(null);
    setOver(null);
  }
  function move(from: ConditionPath, place: DropPlace) {
    const index = placeIndex(from, place);
    if (index === null) return;
    const next = moveAt(root, from, { group: place.group, index });
    if (next !== root) onChange(next);
  }
  /** A dragover handler that places the drop where `place` answers. */
  function target(place: (event: DragEvent<HTMLElement>) => DropPlace | null) {
    return (event: DragEvent<HTMLElement>) => {
      if (!draggingRef.current) return;
      event.stopPropagation();
      event.preventDefault();
      const next = place(event);
      if (next === null) return;
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
        const into = event.relatedTarget;
        if (!(into instanceof Node) || !event.currentTarget.contains(into))
          setOver(null);
      },
    },
    handle: (path: ConditionPath, count: number) => ({
      draggable: !disabled,
      role: "button" as const,
      tabIndex: disabled ? -1 : 0,
      "aria-disabled": disabled || undefined,
      "data-reorder-handle": "",
      onDragStart: (event: DragEvent<HTMLElement>) => {
        if (disabled) return;
        event.stopPropagation();
        event.dataTransfer?.setData(DRAG_TYPE, path.join("."));
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
        setDragging(path);
      },
      onDragEnd: end,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (disabled || !event.altKey) return;
        const step =
          event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
        const at = path.at(-1)!;
        if (step === 0 || at + step < 0 || at + step >= count) return;
        event.preventDefault();
        move(path, {
          group: path.slice(0, -1),
          index: step > 0 ? at + 2 : at - 1,
        });
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
            ? shown.index === at
              ? "before"
              : shown.index === count && at === count - 1
                ? "after"
                : undefined
            : undefined,
        onDragOver: target((event) => ({
          group,
          index: lowerHalf(event) ? at + 1 : at,
        })),
      };
    },
    header: (path: ConditionPath) => ({
      onDragOver: target(() =>
        path.length === 0
          ? { group: path, index: 0 }
          : { group: path.slice(0, -1), index: path.at(-1)! },
      ),
    }),
    group: (path: ConditionPath, count: number) => ({
      // An empty group has no row to mark, so the group takes the mark.
      "data-drop":
        shown && count === 0 && samePath(shown.group, path)
          ? "into"
          : undefined,
      onDragOver: target(() => ({ group: path, index: count })),
    }),
    // A gap between rows keeps the place the last row gave.
    rows: { onDragOver: target(() => overRef.current) },
  };
}

export type MatchReorder = ReturnType<typeof useMatchReorder>;
