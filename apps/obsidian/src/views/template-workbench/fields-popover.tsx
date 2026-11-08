// The Fields popover in Obsidian: a `PinnedPopover` inset at the right edge of
// the Workbench view, as tall as the view less Obsidian's gap, which the
// Fields view action opens and closes (ADR 0044, "Menus and popovers are
// Obsidian's own primitives"). PinnedPopover owns Escape, the press outside
// and focus back to the action; the shared Fields Panel draws the contents.
// A field's details in a wide view are a PinnedPopover inside this one,
// beside the panel and level with the field's row.
import { Platform } from "obsidian";
import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type {
  WorkbenchFieldDetailsProps,
  WorkbenchFieldsAction,
  WorkbenchFieldsPopoverProps,
} from "@zotlit/workbench/ui";

import { PinnedPopover } from "@/components/pinned-popover";
import type { PageKey, PinnedPopoverHandle } from "@/components/pinned-popover";
import * as m from "@/lib/i18n/generated/messages";

/**
 * Mod+Enter inserts the field selected in the panel's search, ahead of the
 * hotkey Obsidian binds to it.
 */
const PANEL_KEYS: readonly PageKey[] = [{ modifiers: ["Mod"], key: "Enter" }];

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
    onEscape,
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
        onEscape={onEscape}
        pageKeys={PANEL_KEYS}
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
  return {
    popover: FieldsPopover,
    popoverId,
    focus: () => anchor.current?.focus({ preventScroll: true }),
    details: FieldDetailsPopover,
    // Mod+Enter, as Obsidian names the key on this platform.
    get insertShortcut() {
      return Platform.isMacOS
        ? m.workbench_fields_insert_key_mac()
        : m.workbench_fields_insert_key();
    },
  };
}

/**
 * A field's details beside the Fields Panel. It opens as it mounts and leaves
 * focus in the panel's search; its Scope takes Escape before the Fields
 * popover's, and a press on its row stays the row's, which toggles it.
 */
function FieldDetailsPopover({
  anchor,
  panel,
  onClose,
  labelledBy,
  children,
}: WorkbenchFieldDetailsProps) {
  const handle = useRef<PinnedPopoverHandle>(null);
  const [row] = useState(() => ({ current: anchor }));
  const [beside] = useState(() => ({ current: panel }));
  const latest = useRef(onClose);
  useLayoutEffect(() => {
    latest.current = onClose;
  });
  // Unmounting hides it: the panel closed the details itself.
  const unmounted = useRef(false);
  useLayoutEffect(() => {
    handle.current?.show();
    return () => {
      unmounted.current = true;
    };
  }, []);
  return (
    <PinnedPopover
      anchor={row}
      beside={beside}
      handle={handle}
      initialFocus={false}
      // Its Scope stands over the Fields popover's: the panel's keys pass it.
      pageKeys={PANEL_KEYS}
      aria-labelledby={labelledBy}
      onOpenChange={(next) => {
        if (!next && !unmounted.current) latest.current();
      }}
    >
      {children}
    </PinnedPopover>
  );
}
