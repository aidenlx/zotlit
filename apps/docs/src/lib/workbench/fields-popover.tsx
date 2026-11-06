// The Fields picker's surface on the web: the Workbench's Base UI popover,
// anchored under the header's Fields action. The shared picker draws the
// rows; Base UI places the surface, dismisses it on Escape, a press outside
// or focus that leaves it, and returns focus to the action.
import { useRef } from "react";
import type { KeyboardEvent, RefObject } from "react";

import type {
  WorkbenchFieldsAction,
  WorkbenchFieldsPopoverProps,
  WorkbenchPickerMove,
} from "@zotlit/workbench/ui";

import { Popover, PopoverContent } from "@/components/ui/popover";

/** The keys the picker moves its active row with. */
const MOVES: Partial<Record<string, WorkbenchPickerMove>> = {
  ArrowDown: "next",
  ArrowUp: "previous",
  PageDown: "page-down",
  PageUp: "page-up",
};

/** The header's Fields action, and the popover the picker opens in under it. */
export function webFieldsAction(
  anchor: RefObject<HTMLElement | null>,
): WorkbenchFieldsAction {
  function FieldsPopover({
    open,
    onClose,
    keys,
    labelledBy,
    children,
  }: WorkbenchFieldsPopoverProps) {
    /** Whether the popover holds focus, read as it closes. */
    const held = useRef(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.nativeEvent.isComposing) return;
      const move = MOVES[event.key];
      if (move) keys.move(move);
      else if (event.key === "Enter") keys.choose();
      else return;
      event.preventDefault();
    };
    return (
      <Popover
        open={open}
        onOpenChange={(next, { reason, event }) => {
          // A press on the action is the action's own toggle.
          const onAction =
            reason === "outside-press" &&
            event.target instanceof Node &&
            anchor.current?.contains(event.target) === true;
          if (!next && !onAction) onClose();
        }}
      >
        <PopoverContent
          anchor={anchor}
          align="start"
          aria-labelledby={labelledBy}
          // The picker focuses its own search field as it mounts.
          initialFocus={false}
          // Focus the popover held at closing goes back to the action; focus
          // an insertion already gave the editor stays there.
          finalFocus={() => {
            const active = anchor.current?.ownerDocument.activeElement;
            const lost =
              !active ||
              active === active.ownerDocument.body ||
              active.closest("[data-slot=popover-content]") !== null;
            return held.current && lost ? anchor.current : false;
          }}
          onFocus={() => {
            held.current = true;
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              held.current = false;
          }}
          onKeyDown={onKeyDown}
          className="flex max-h-[min(28rem,var(--available-height))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden p-0"
        >
          {children}
        </PopoverContent>
      </Popover>
    );
  }
  return {
    popover: FieldsPopover,
    focus: () => anchor.current?.focus({ preventScroll: true }),
  };
}
