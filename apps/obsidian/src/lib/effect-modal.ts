// Where a modal, which stays a plain Obsidian class, meets Effect: the user's
// answer is an Effect, and an interrupt takes the modal away.
import { Effect } from "effect";

/** What `awaitModal` needs of a modal: a way to take it away. */
export interface ClosableModal {
  close(): void;
}

/**
 * The first `settle` wins: a modal that closes itself after a choice does not
 * replace the choice with its dismiss value.
 *
 * @param open Builds the modal, opens it, and returns it. It calls `settle`
 *   with the choice, and with the dismiss value from the modal's close
 *   callback.
 * @returns The user's answer. An interrupt closes the modal.
 */
export function awaitModal<A>(
  open: (settle: (answer: A) => void) => ClosableModal,
): Effect.Effect<A> {
  return Effect.callback<A>((resume) => {
    const modal = open((answer) => resume(Effect.succeed(answer)));
    return Effect.sync(() => modal.close());
  });
}

/**
 * Opens `modal` in `win`, the window of the view that asked for it.
 *
 * Obsidian opens a modal in `activeWindow`, which moves only when a window
 * takes focus. A pop-out the reader works in does not always take focus
 * first, so `win` becomes the active window here, as that focus would make it,
 * and the modals that follow from this one open there too.
 *
 * @see apps/obsidian/policies/popout-windows.md
 */
export function openModalIn(modal: { open(): void }, win: Window): void {
  activeWindow = win;
  activeDocument = win.document;
  modal.open();
}
