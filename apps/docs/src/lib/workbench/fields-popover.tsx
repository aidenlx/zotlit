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
import { m } from "@/paraglide/messages.js";

/** The gap between the popover and the panels' edges, in pixels. */
const GAP = 8;

/**
 * The page's notices stand this far from the window's end edge; the toast
 * viewport reads it, and a default of 1rem stands without it.
 */
const TOAST_END = "--toast-end";

/** The narrowest band, in pixels, a notice stands in beside the popover. */
const TOAST_MIN_WIDTH = 192;

/**
 * Keeps the page's notices beside the open popover, clear of its foot, while
 * the window leaves them room there; they stand over it otherwise.
 * @returns Lets the notices go back to their own place.
 */
function keepNoticesBeside(
  popup: HTMLElement,
  box: HTMLElement | null,
): () => void {
  const root = popup.ownerDocument.documentElement;
  const win = popup.ownerDocument.defaultView!;
  const place = () => {
    if (!box) return;
    // The popover stands at the box's end edge, less the gap.
    const left = box.getBoundingClientRect().right - GAP - popup.offsetWidth;
    if (left - 2 * GAP >= TOAST_MIN_WIDTH)
      root.style.setProperty(TOAST_END, `${win.innerWidth - left + GAP}px`);
    else root.style.removeProperty(TOAST_END);
  };
  place();
  const resize = new ResizeObserver(place);
  resize.observe(popup);
  if (box) resize.observe(box);
  return () => {
    resize.disconnect();
    root.style.removeProperty(TOAST_END);
  };
}

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
            // A press on the action is the action's own toggle: the press
            // itself, and the focus it moves there from the popover first.
            const to =
              reason === "focus-out" && event instanceof FocusEvent
                ? event.relatedTarget
                : reason === "outside-press"
                  ? event.target
                  : null;
            const onAction =
              to instanceof Node && anchor.current?.contains(to) === true;
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
            ref={(popup: HTMLDivElement | null) =>
              popup ? keepNoticesBeside(popup, box.current) : undefined
            }
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
  return {
    popover: FieldsPopover,
    popoverId,
    focus: () => anchor.current?.focus({ preventScroll: true }),
    details: FieldDetailsPopover,
    // Mod+Enter, as the reader's platform names the key.
    get insertShortcut() {
      return /Mac|iPhone|iPad/.test(navigator.userAgent)
        ? m.workbench_fields_insert_key_mac()
        : m.workbench_fields_insert_key();
    },
  };
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
        // The shared details draw the surface, and scroll themselves; the
        // popup only holds its place and lets their ring and shadow show.
        className="w-72 overflow-visible bg-transparent p-0 shadow-none ring-0"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
