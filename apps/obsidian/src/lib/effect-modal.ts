// Where a modal, which stays a plain Obsidian class, meets Effect: the user's
// answer is an Effect, and an interrupt takes the modal away.
import { Effect } from "@/lib/effect";

/** What `awaitModal` needs of a modal: a way to take it away. */
export interface ClosableModal {
  close(): void;
}

/**
 * The user's answer to a modal, as an Effect.
 *
 * `open` builds the modal, opens it, and returns it. It calls `settle` with
 * the choice, and with the dismiss value from the modal's close callback. The
 * first `settle` wins: a modal that closes itself after a choice does not
 * replace the choice with its dismiss value. An interrupt closes the modal.
 */
export function awaitModal<A>(
  open: (settle: (answer: A) => void) => ClosableModal,
): Effect.Effect<A> {
  return Effect.callback<A>((resume) => {
    const modal = open((answer) => resume(Effect.succeed(answer)));
    return Effect.sync(() => modal.close());
  });
}
