// The Fields popover on the web: the Workbench's Base UI popover, inset at
// the right edge of the panels as tall as they are, with a small gap to their
// top, right and bottom edges. It stands in the panels' box, so it sits with
// the Workbench it serves. Base UI dismisses it on Escape and a press
// outside; the shared Fields Panel draws the contents and focuses its search
// field as it mounts. Focus it held at closing goes back to the Fields action.
// A field's details in a wide view are a Base UI popover inside this one,
// beside the panel and level with the field's row.
import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type {
  WorkbenchFieldDetailsProps,
  WorkbenchFieldsAction,
  WorkbenchFieldsPopoverProps,
} from "@zotlit/workbench/ui";

import { Popover, PopoverContent } from "@/components/ui/popover";

/** The gap between the popover and the panels' edges, in pixels. */
const GAP = 8;

/** The header's Fields action, and the Fields popover it opens. */
export function webFieldsAction(
  anchor: RefObject<HTMLElement | null>,
  popoverId: string,
): WorkbenchFieldsAction {
  function FieldsPopover({
    open,
    onClose,
    labelledBy,
    returnFocus,
    onEscape,
    children,
  }: WorkbenchFieldsPopoverProps) {
    // A mark where the panel stands in the tree: its parent is the panels'
    // box, which the popover stands inset in.
    const mark = useRef<HTMLSpanElement>(null);
    const box = useRef<HTMLElement | null>(null);
    useLayoutEffect(() => {
      box.current = mark.current!.parentElement;
    }, []);
    /** The box's right edge, less the gap: the popover stands to its left. */
    const [edge] = useState(() => ({
      getBoundingClientRect: () => {
        const rect = box.current!.getBoundingClientRect();
        return new DOMRect(
          rect.right - GAP,
          rect.top + GAP,
          0,
          Math.max(rect.height - 2 * GAP, 0),
        );
      },
    }));
    return (
      <>
        <span ref={mark} hidden />
        <Popover
          open={open}
          onOpenChange={(next, { reason, event }) => {
            // A press on the action is the action's own toggle.
            const onAction =
              reason === "outside-press" &&
              event.target instanceof Node &&
              anchor.current?.contains(event.target) === true;
            // The panel takes Escape first: the details, then the search.
            if (!next && reason === "escape-key" && onEscape()) return;
            if (!next && !onAction) onClose();
          }}
        >
          <PopoverContent
            id={popoverId}
            anchor={edge}
            container={box}
            side="left"
            align="start"
            sideOffset={0}
            aria-labelledby={labelledBy}
            // The panel focuses its own search field as it mounts.
            initialFocus={false}
            // Focus the popover held at closing goes back to the action;
            // focus an insert already gave the editor stays there.
            finalFocus={() => {
              const active = anchor.current?.ownerDocument.activeElement;
              const lost =
                !active ||
                active === active.ownerDocument.body ||
                active.closest("[data-slot=popover-content]") !== null;
              return returnFocus && lost ? anchor.current : false;
            }}
            // The panel draws the surface; the popup only holds its place.
            className="h-(--anchor-height) w-auto max-w-[calc(100vw-2rem)] overflow-visible bg-transparent p-0 shadow-none ring-0"
          >
            {children}
          </PopoverContent>
        </Popover>
      </>
    );
  }
  return { popover: FieldsPopover, popoverId, details: FieldDetailsPopover };
}

/**
 * A field's details beside the Fields Panel, level with its row, on the side
 * with room: Base UI flips it to the other side of the panel when the left
 * has none. It leaves focus in the panel's search as it opens; a press on
 * its row stays the row's, which toggles it.
 */
function FieldDetailsPopover({
  anchor,
  panel,
  onClose,
  labelledBy,
  children,
}: WorkbenchFieldDetailsProps) {
  /** The panel's height band at the row's top: the popover stands beside it. */
  const [edge] = useState(() => ({
    getBoundingClientRect: () => {
      const box = panel.getBoundingClientRect();
      const row = anchor.getBoundingClientRect();
      return new DOMRect(box.left, row.top, box.width, row.height);
    },
  }));
  return (
    <Popover
      open
      onOpenChange={(next, { reason, event }) => {
        const onRow =
          reason === "outside-press" &&
          event.target instanceof Node &&
          anchor.contains(event.target);
        if (!next && !onRow) onClose();
      }}
    >
      <PopoverContent
        anchor={edge}
        side="left"
        align="start"
        sideOffset={GAP}
        aria-labelledby={labelledBy}
        initialFocus={false}
        finalFocus={false}
        // The shared details draw the surface; the popup only holds its place.
        className="w-72 bg-transparent p-0 shadow-none ring-0"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
