// The Fields picker's surface on the web: the Workbench's Base UI popover,
// anchored under the header's Fields action. The shared picker draws the
// rows; Base UI places the surface and dismisses it on Escape and a press
// outside; this module closes it when focus leaves it by keyboard, and
// returns focus to the action.
import { useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, RefObject } from "react";

import { PICKER_MOVE_KEYS } from "@zotlit/workbench/ui";
import type {
  WorkbenchFieldsAction,
  WorkbenchFieldsPopoverProps,
} from "@zotlit/workbench/ui";

import { Popover, PopoverContent } from "@/components/ui/popover";

/** The header's Fields action, and the popover the picker opens in under it. */
export function webFieldsAction(
  anchor: RefObject<HTMLElement | null>,
  popoverId: string,
): WorkbenchFieldsAction {
  function FieldsPopover({
    open,
    onClose,
    keys,
    labelledBy,
    returnFocus,
    children,
  }: WorkbenchFieldsPopoverProps) {
    /** Whether the popover holds focus, read as it closes. */
    const held = useRef(false);
    const standing = useRef(open);
    useLayoutEffect(() => {
      standing.current = open;
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.nativeEvent.isComposing) return;
      const move = PICKER_MOVE_KEYS[event.key];
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
          id={popoverId}
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
            return returnFocus && held.current && lost ? anchor.current : false;
          }}
          onFocus={() => {
            held.current = true;
          }}
          onBlur={(event) => {
            const next = event.relatedTarget;
            if (event.currentTarget.contains(next)) return;
            held.current = false;
            // Focus that leaves the open popover for another element closes
            // it and goes to the action. Only the keyboard moves focus out
            // while it stands: a press on the action keeps focus in it, and
            // a press elsewhere closes it first.
            if (!standing.current || !(next instanceof Node)) return;
            onClose();
            // The focus that is leaving lands first; a move made inside its
            // blur would race it.
            queueMicrotask(() =>
              anchor.current?.focus({ preventScroll: true }),
            );
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
    popoverId,
    focus: () => anchor.current?.focus({ preventScroll: true }),
  };
}
