// The Fields popover in Obsidian: a `PinnedPopover` inset at the right edge of
// the Workbench view, as tall as the view less Obsidian's gap, which the
// Fields view action opens and closes (ADR 0044, "Menus and popovers are
// Obsidian's own primitives"). PinnedPopover owns Escape, the press outside
// and focus back to the action; the shared Fields Panel draws the contents.
import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type {
  WorkbenchFieldsAction,
  WorkbenchFieldsPopoverProps,
} from "@zotlit/workbench/ui";

import { PinnedPopover } from "@/components/pinned-popover";
import type { PinnedPopoverHandle } from "@/components/pinned-popover";

/** Each leaf's Fields popover gets an id of its own. */
let surfaces = 0;

/**
 * The Fields action of one leaf: the view action element, and the popover
 * inset in `view`, the box under the view's header.
 */
export function fieldsActionHost(
  anchor: RefObject<HTMLElement | null>,
  view: RefObject<HTMLElement | null>,
): WorkbenchFieldsAction {
  const popoverId = `zt-fields-popover-${++surfaces}`;
  function FieldsPopover({
    open,
    onClose,
    labelledBy,
    returnFocus,
    children,
  }: WorkbenchFieldsPopoverProps) {
    const handle = useRef<PinnedPopoverHandle>(null);
    const latest = useRef({ onClose, returnFocus, open });
    useLayoutEffect(() => {
      latest.current = { onClose, returnFocus, open };
    });
    // Whether the popover stands. The contents mount once it does, so the
    // search field they focus is in the document.
    const [shown, setShown] = useState(false);
    // The editor closed: the popover hides with nothing left to tell.
    const unmounted = useRef(false);
    useLayoutEffect(
      () => () => {
        unmounted.current = true;
      },
      [],
    );
    useLayoutEffect(() => {
      if (open) {
        handle.current?.show();
        return;
      }
      if (!latest.current.returnFocus) {
        // An insert gives the editor focus at the inserted text; the popover
        // lets go of focus rather than hand it to the action.
        const active = anchor.current?.doc.activeElement;
        if (active?.instanceOf(HTMLElement) && handle.current?.contains(active))
          active.blur();
      }
      handle.current?.hide();
    }, [open]);
    return (
      <PinnedPopover
        anchor={anchor}
        inset={view}
        handle={handle}
        id={popoverId}
        role="dialog"
        aria-labelledby={labelledBy}
        onOpenChange={(next) => {
          if (unmounted.current) return;
          setShown(next);
          // Escape or a press outside closed it; a close the model asked
          // for has nothing to tell.
          if (!next && latest.current.open) latest.current.onClose();
        }}
        className="zt:h-full"
      >
        {shown && children}
      </PinnedPopover>
    );
  }
  return { popover: FieldsPopover, popoverId };
}
