// The Fields picker's surface in Obsidian: a `PinnedPopover` under the
// Fields view action, at the menu layer on the body, with the picker's keys on
// an Obsidian Scope while it stands (ADR 0044, "Menus and popovers are
// Obsidian's own primitives"). The shared picker draws the rows; this module
// shows and hides the surface, places it, dismisses it, and returns focus.
//
// @see apps/obsidian/docs/bases-toolbar-menu.md#keyboard-and-focus
import { Scope } from "obsidian";
import type { Modifier } from "obsidian";
import { useLayoutEffect, useRef } from "react";
import type { FocusEvent, RefObject } from "react";

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

/** The keys the picker moves its active row with, as every Obsidian list does. */
const MOVES: readonly [Modifier[], string, WorkbenchPickerMove][] = [
  [[], "ArrowDown", "next"],
  [[], "ArrowUp", "previous"],
  [["Ctrl"], "n", "next"],
  [["Ctrl"], "p", "previous"],
  [[], "PageDown", "page-down"],
  [[], "PageUp", "page-up"],
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
    children,
  }: WorkbenchFieldsPopoverProps) {
    const app = useObsidianApp();
    const handle = useRef<PinnedPopoverHandle>(null);
    const latest = useRef({ keys, onClose });
    useLayoutEffect(() => {
      latest.current = { keys, onClose };
    });

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

    // The contents mount before the popover shows, except at the first
    // opening, where they mount after it: the search field takes focus from
    // the shell here, or as it mounts.
    const surface = useRef<HTMLDivElement>(null);
    const shown = useRef(false);
    useLayoutEffect(() => {
      if (!open) {
        if (!shown.current) return;
        shown.current = false;
        // A press on the action closes the popover and leaves focus on
        // nothing; it goes to the action, as an Escape's does.
        const doc = anchor.current?.doc;
        const lost = !doc?.activeElement || doc.activeElement === doc.body;
        handle.current?.hide();
        if (lost) anchor.current?.focus({ preventScroll: true });
        return;
      }
      shown.current = true;
      handle.current?.show();
      surface.current?.querySelector("input")?.focus({ preventScroll: true });
    }, [open]);

    // One Scope while the popover stands, over the popover's own: the keys it
    // registers stop here, and every other key reaches Obsidian's hotkeys.
    useLayoutEffect(() => {
      if (!open) return;
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
    }, [app, open]);

    // Focus that leaves the popover by keyboard, Shift+Tab onto the action
    // included, shuts it: its Scope would go on taking the arrows and Enter.
    const leave = (event: FocusEvent<HTMLDivElement>) => {
      const next = event.relatedTarget as Node | null;
      // A press on the action is its own toggle.
      if (
        next &&
        !handle.current?.contains(next) &&
        !anchor.current?.contains(next)
      )
        handle.current?.hide();
    };

    return (
      <PinnedPopover
        ref={surface}
        anchor={anchor}
        handle={handle}
        role="dialog"
        aria-labelledby={labelledBy}
        onOpenChange={(next) => {
          if (!next && !unmounted.current) latest.current.onClose();
        }}
        onBlur={leave}
        className="zt:flex zt:[max-height:min(--spacing(110),calc(100vh_-_--spacing(4)))] zt:w-[min(--spacing(100),calc(100vw_-_--spacing(4)))] zt:flex-col zt:rounded-(--menu-radius) zt:border-(length:--menu-border-width) zt:border-(--menu-border-color) zt:bg-(--menu-background) zt:text-foreground zt:shadow-(--menu-shadow) zt:[corner-shape:var(--menu-corner-shape)]"
      >
        {open && children}
      </PinnedPopover>
    );
  }
  return {
    popover: FieldsPopover,
    focus: () => anchor.current?.focus({ preventScroll: true }),
  };
}
