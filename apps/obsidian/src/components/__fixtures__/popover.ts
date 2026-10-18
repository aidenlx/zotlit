// happy-dom has no popover API. A shimmed popup answers `showPopover` and
// `hidePopover` by sending the events the browser sends: `beforetoggle`, which
// mounts or unmounts a Chooser's session, then `toggle`, on which the Chooser
// moves focus into the popup it just showed. Tests drive a popup the same way
// the app does, focus included.
import { act } from "preact/test-utils";

type PopoverState = "open" | "closed";

export interface ShimmedPopover {
  /** Shows the popup as a press on its trigger does. */
  open: () => Promise<void>;
  /** Hides it as Escape or a press outside does. */
  close: () => Promise<void>;
}

export function shimPopover(popup: HTMLElement): ShimmedPopover {
  let state: PopoverState = "closed";
  const send = (newState: PopoverState) => {
    if (state === newState) return;
    state = newState;
    popup.dispatchEvent(Object.assign(new Event("beforetoggle"), { newState }));
    // The browser queues `toggle`, so it lands after the render that
    // `beforetoggle` started, with the popup's fields in place.
    queueMicrotask(() =>
      popup.dispatchEvent(Object.assign(new Event("toggle"), { newState })),
    );
  };
  Object.assign(popup, {
    showPopover: () => send("open"),
    hidePopover: () => send("closed"),
  });
  return {
    open: async () => {
      await act(() => send("open"));
      await act(() => Promise.resolve());
    },
    close: async () => {
      await act(() => send("closed"));
      await act(() => Promise.resolve());
    },
  };
}
