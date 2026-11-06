// The Fields picker's surface in Obsidian: a `PinnedPopover` under the
// Fields view action, at the menu layer on the body, with the picker's keys on
// an Obsidian Scope while it stands (ADR 0044, "Menus and popovers are
// Obsidian's own primitives"). The shared picker draws the rows; this module
// shows and hides the surface, places it, dismisses it, and returns focus.
//
// @see apps/obsidian/docs/bases-toolbar-menu.md#keyboard-and-focus
import { Scope } from "obsidian";
import type { Modifier } from "obsidian";
import { useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, RefObject } from "react";

import { useUniqueId } from "@zotlit/ui";
import type {
  WorkbenchFieldsAction,
  WorkbenchFieldsPopoverProps,
  WorkbenchPickerMove,
} from "@zotlit/workbench/ui";

import { PinnedPopover } from "@/components/pinned-popover";
import type { PinnedPopoverHandle } from "@/components/pinned-popover";
import { useObsidianApp } from "@/lib/app-context";
import { registerKeymap } from "@/lib/disposables";
import { composing } from "@/lib/ime";

/**
 * The keys the picker moves its active row with, as every Obsidian list and
 * the Chooser do. The web Workbench binds the same moves, Ctrl+N and Ctrl+P
 * aside.
 */
const MOVES: readonly [Modifier[], string, WorkbenchPickerMove][] = [
  [[], "ArrowDown", "next"],
  [[], "ArrowUp", "previous"],
  [["Ctrl"], "n", "next"],
  [["Ctrl"], "p", "previous"],
  [[], "PageDown", "page-down"],
  [[], "PageUp", "page-up"],
  [[], "Home", "first"],
  [[], "End", "last"],
];

/** The Fields action of one leaf: the view action element, and the popover under it. */
export function fieldsActionHost(
  anchor: RefObject<HTMLElement | null>,
): WorkbenchFieldsAction {
  function FieldsPopover({
    open,
    onClose,
    keys,
    labelledBy,
    returnFocus,
    children,
  }: WorkbenchFieldsPopoverProps) {
    const app = useObsidianApp();
    const id = useUniqueId();
    const handle = useRef<PinnedPopoverHandle>(null);
    const latest = useRef({ keys, onClose, returnFocus });
    useLayoutEffect(() => {
      latest.current = { keys, onClose, returnFocus };
    });
    // Whether the popover stands. The contents mount once it does, so the
    // search field they focus is in the document.
    const [shown, setShown] = useState(false);

    // The popover goes when a wider view gives the Fields column room, or
    // the editor closes; it hides then with nothing left to tell. Focus it
    // held goes to the action, while the search field still holds it.
    const unmounted = useRef(false);
    useLayoutEffect(
      () => () => {
        unmounted.current = true;
        const doc = anchor.current?.doc;
        if (doc && handle.current?.contains(doc.activeElement!))
          anchor.current?.focus({ preventScroll: true });
      },
      [],
    );

    // The editor takes the focus an insertion asks for a render or two
    // after the insertion. A picker opened again before then keeps focus:
    // that focus is the insertion's, not the reader leaving the picker. The
    // first focus to land outside the popover and the action settles it.
    const insertionFocus = useRef(false);
    const kept = useRef<HTMLElement | null>(null);
    useLayoutEffect(() => {
      const doc = anchor.current?.doc;
      if (!doc) return;
      const settle = (event: Event) => {
        if (!insertionFocus.current) return;
        const target = event.target as Node | null;
        if (
          !target?.instanceOf(Node) ||
          handle.current?.contains(target) ||
          anchor.current?.contains(target)
        )
          return;
        insertionFocus.current = false;
        const back = kept.current;
        kept.current = null;
        back?.focus({ preventScroll: true });
      };
      doc.addEventListener("focusin", settle, true);
      return () => doc.removeEventListener("focusin", settle, true);
    }, []);

    const wasOpen = useRef(false);
    useLayoutEffect(() => {
      if (open) {
        wasOpen.current = true;
        handle.current?.show();
        return;
      }
      if (!wasOpen.current) return;
      wasOpen.current = false;
      const doc = anchor.current?.doc;
      const active = doc?.activeElement;
      if (!latest.current.returnFocus) {
        // An insertion gives the editor focus at the inserted text; the
        // popover lets go of focus rather than hand it to the action.
        if (active?.instanceOf(HTMLElement) && handle.current?.contains(active))
          active.blur();
        handle.current?.hide();
        insertionFocus.current = true;
        return;
      }
      // A press on the action closes the popover and leaves focus on
      // nothing; it goes to the action, as an Escape's does.
      const lost = !active || active === doc?.body;
      handle.current?.hide();
      if (lost) anchor.current?.focus({ preventScroll: true });
    }, [open]);

    // The action names the popover it controls while the popover stands.
    useLayoutEffect(() => {
      const action = anchor.current;
      if (!shown || !action) return;
      action.setAttribute("aria-controls", id);
      return () => {
        action.removeAttribute("aria-controls");
      };
    }, [shown, id]);

    // One Scope while the popover stands, over the popover's own: the keys it
    // registers stop here, and every other key reaches Obsidian's hotkeys.
    useLayoutEffect(() => {
      if (!shown) return;
      const scope = new Scope(app.scope);
      const stack = new DisposableStack();
      for (const [modifiers, key, step] of MOVES)
        stack.use(
          registerKeymap(scope, modifiers, key, (event) => {
            if (composing(event)) return;
            latest.current.keys.move(step);
            return false;
          }),
        );
      stack.use(
        registerKeymap(scope, [], "Enter", (event) => {
          if (composing(event)) return;
          latest.current.keys.choose();
          return false;
        }),
      );
      // The popover's own Scope answers Escape, but this one stands above
      // it and passes a key it leaves to the app scope, its parent, not to
      // the popover's: so it answers Escape too.
      stack.use(
        registerKeymap(scope, [], "Escape", (event) => {
          if (composing(event)) return;
          handle.current?.hide();
          return false;
        }),
      );
      app.keymap.pushScope(scope);
      stack.defer(() => app.keymap.popScope(scope));
      return () => stack.dispose();
    }, [app, shown]);

    // Focus that leaves the popover by keyboard, Shift+Tab onto the action
    // included, shuts it: its Scope would go on taking the arrows and Enter.
    const leave = (event: FocusEvent<HTMLDivElement>) => {
      const next = event.relatedTarget as Node | null;
      if (!next?.instanceOf(Node)) return;
      // A press on the action is its own toggle.
      const pressed =
        anchor.current?.contains(next) === true &&
        anchor.current.matches(":active");
      if (handle.current?.contains(next) || pressed) return;
      // The editor taking the focus an insertion asked for.
      if (insertionFocus.current) {
        kept.current = event.target;
        return;
      }
      handle.current?.hide();
    };

    return (
      <PinnedPopover
        anchor={anchor}
        handle={handle}
        id={id}
        role="dialog"
        aria-labelledby={labelledBy}
        onOpenChange={(next) => {
          if (unmounted.current) return;
          setShown(next);
          if (!next) latest.current.onClose();
        }}
        onBlur={leave}
        className="zt:flex zt:max-h-[min(--spacing(110),calc(100vh_-_--spacing(4)))] zt:w-[min(--spacing(100),calc(100vw_-_--spacing(4)))] zt:flex-col zt:rounded-(--menu-radius) zt:border-(length:--menu-border-width) zt:border-(--menu-border-color) zt:bg-(--menu-background) zt:text-foreground zt:shadow-(--menu-shadow) zt:[corner-shape:var(--menu-corner-shape)]"
      >
        {shown && children}
      </PinnedPopover>
    );
  }
  return {
    popover: FieldsPopover,
    focus: () => anchor.current?.focus({ preventScroll: true }),
  };
}
