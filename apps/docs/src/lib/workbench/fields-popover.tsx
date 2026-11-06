// The Fields picker's surface on the web: the Workbench's Base UI popover,
// anchored under the header's Fields action. The shared picker draws the
// rows; Base UI places the surface and dismisses it on Escape and a press
// outside; this module closes it when focus leaves it by keyboard, and
// returns focus to the action.
import { useId, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, RefObject } from "react";

import type {
  WorkbenchFieldsAction,
  WorkbenchFieldsPopoverProps,
  WorkbenchPickerMove,
} from "@zotlit/workbench/ui";

import { Popover, PopoverContent } from "@/components/ui/popover";

/**
 * The keys the picker moves its active row with: the moves the Obsidian
 * view binds, Ctrl+N and Ctrl+P aside.
 */
const MOVES: Partial<Record<string, WorkbenchPickerMove>> = {
  ArrowDown: "next",
  ArrowUp: "previous",
  PageDown: "page-down",
  PageUp: "page-up",
  Home: "first",
  End: "last",
};

/** The header's Fields action, and the popover the picker opens in under it. */
export function webFieldsAction(
  anchor: RefObject<HTMLElement | null>,
): WorkbenchFieldsAction {
  /** Whether `node` is the action under a press, which toggles the popover itself. */
  const pressed = (node: Node) =>
    anchor.current?.contains(node) === true &&
    anchor.current.matches(":active");
  function FieldsPopover({
    open,
    onClose,
    keys,
    labelledBy,
    returnFocus,
    children,
  }: WorkbenchFieldsPopoverProps) {
    const id = useId();
    /** Whether the popover holds focus, read as it closes. */
    const held = useRef(false);
    // The action names the popover it controls while the popover stands.
    useLayoutEffect(() => {
      const action = anchor.current;
      if (!open || !action) return;
      action.setAttribute("aria-controls", id);
      return () => {
        action.removeAttribute("aria-controls");
      };
    }, [open, id]);
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
          id={id}
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
            // Focus that leaves by keyboard, Tab or Shift+Tab onto the action
            // included, shuts the popover. A press on the action is its own
            // toggle.
            if (next instanceof Node && !pressed(next)) onClose();
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
