// Drag to set the place of a row in a list, as the Sort and Group controls'
// lists do. A pointer drags the row by its handle; the keyboard moves it with
// Alt+ArrowUp and Alt+ArrowDown on the handle, as Bases does.
import { useState } from "react";
import type { DragEvent, HTMLAttributes, KeyboardEvent } from "react";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { cn } from "@/lib/utils";

/** The list with the entry at `from` moved to `to`. */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [entry] = next.splice(from, 1);
  if (entry === undefined) return next;
  next.splice(Math.max(0, Math.min(to, next.length)), 0, entry);
  return next;
}

const DRAG_TYPE = "application/x-zotlit-query-row";

/**
 * The props of one row of a list that can be reordered: the handle's and the
 * row's own. `onMove` gets the row's index and the index it moves to.
 */
export function useReorder(
  count: number,
  onMove: (from: number, to: number) => void,
) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  return (index: number) => ({
    row: {
      "data-drag-over": over === index && dragging !== index ? "" : undefined,
      className: cn(
        dragging === index && "zt:opacity-50",
        over === index &&
          dragging !== index &&
          "zt:outline-2 zt:outline-(--interactive-accent)",
      ),
      onDragOver: (event: DragEvent) => {
        if (dragging === null) return;
        event.preventDefault();
        setOver(index);
      },
      onDragLeave: () => setOver((at) => (at === index ? null : at)),
      onDrop: (event: DragEvent) => {
        event.preventDefault();
        if (dragging !== null && dragging !== index) onMove(dragging, index);
        setDragging(null);
        setOver(null);
      },
    } satisfies HTMLAttributes<HTMLElement> & Record<string, unknown>,
    handle: {
      draggable: true,
      role: "button" as const,
      tabIndex: 0,
      "aria-label": m.query_view_drag_to_reorder(),
      "data-reorder-handle": "",
      className:
        "clickable-icon zt:cursor-grab zt:text-(--text-faint) zt:shrink-0",
      onDragStart: (event: DragEvent) => {
        event.dataTransfer?.setData(DRAG_TYPE, String(index));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        setDragging(index);
      },
      onDragEnd: () => {
        setDragging(null);
        setOver(null);
      },
      onKeyDown: (event: KeyboardEvent) => {
        if (!event.altKey) return;
        const step =
          event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
        const to = index + step;
        if (step === 0 || to < 0 || to >= count) return;
        event.preventDefault();
        onMove(index, to);
      },
    },
  });
}

export function GripIcon() {
  return <Icon name="grip-vertical" size={14} />;
}
