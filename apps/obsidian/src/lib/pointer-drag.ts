// The lifecycle of a drag that follows the pointer along x, as an edge that
// resizes a column or a pane does: the pointer capture, the cursor held over
// the whole page, the window listeners, Escape, one update a frame and the
// cleanup. What the drag sets stays with the caller.

export interface PointerDrag {
  /** The press that starts the drag. */
  press: Pick<PointerEvent, "pointerId" | "clientX">;
  /** The element pressed, which takes the pointer and the `is-active` class. */
  handle: HTMLElement;
  /** The body class that holds the drag's cursor over the whole page. */
  cursor: string;
  /**
   * Ends the drag when aborted, as the caller does when its view closes; the
   * drag aborts it itself when it ends.
   */
  controller: AbortController;
  /**
   * The pointer is `delta` pixels along x from the press, once it has left
   * the press's x; at most once a frame.
   */
  move: (delta: number) => void;
  /**
   * The pointer let go after it moved, `delta` pixels from the press as the
   * last move had it. {@link end} follows.
   */
  drop: (delta: number) => void;
  /**
   * The drag is over: after {@link drop}, or on Escape, a lost pointer, or
   * {@link controller} aborted.
   */
  end: () => void;
}

/**
 * Follow the pointer of `press` across the window until it lets go. A press
 * that does not move, as half of a double click, drops nothing.
 */
export function pointerDrag({
  press,
  handle,
  cursor,
  controller,
  move,
  drop,
  end,
}: PointerDrag): void {
  const { doc, win } = handle;
  const { signal } = controller;
  const { pointerId, clientX: origin } = press;
  let delta = 0;
  let moved = false;
  let frame = 0;
  // The window follows the pointer; capture keeps it past the window's edge.
  try {
    handle.setPointerCapture(pointerId);
  } catch {
    // A pointer the browser does not track, as a test sends, has no capture.
  }
  handle.classList.add("is-active");
  doc.body.classList.add(cursor);
  signal.addEventListener(
    "abort",
    () => {
      win.cancelAnimationFrame(frame);
      handle.classList.remove("is-active");
      doc.body.classList.remove(cursor);
      if (handle.hasPointerCapture?.(pointerId))
        handle.releasePointerCapture(pointerId);
      end();
    },
    { once: true },
  );
  const options = { capture: true, signal };
  const mine = (pointer: PointerEvent) => pointer.pointerId === pointerId;
  win.addEventListener(
    "pointermove",
    (event) => {
      if (!mine(event)) return;
      if (event.clientX !== origin) moved = true;
      if (!moved) return;
      delta = event.clientX - origin;
      if (frame) return;
      frame = win.requestAnimationFrame(() => {
        frame = 0;
        move(delta);
      });
    },
    options,
  );
  win.addEventListener(
    "pointerup",
    (event) => {
      if (!mine(event)) return;
      if (moved) {
        win.cancelAnimationFrame(frame);
        frame = 0;
        drop(delta);
      }
      controller.abort();
    },
    options,
  );
  win.addEventListener(
    "pointercancel",
    (event) => {
      if (mine(event)) controller.abort();
    },
    options,
  );
  win.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      controller.abort();
    },
    options,
  );
}
