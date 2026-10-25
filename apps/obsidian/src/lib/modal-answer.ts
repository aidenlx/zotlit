// A modal's answer as a Promise, for a caller outside Effect. It lives apart
// from `effect-modal`, so a legacy file that imports it stays a legacy file.
import type { ClosableModal } from "@/lib/effect-modal";

/**
 * The Promise twin of `awaitModal`. It runs no Effect, so it needs no runtime.
 *
 * @param open As for `awaitModal`.
 * @returns The first answer. The modal opens before this returns, and a throw
 *   from `open` rejects.
 */
export function modalAnswer<A>(
  open: (settle: (answer: A) => void) => ClosableModal,
): Promise<A> {
  return new Promise<A>((resolve) => {
    open(resolve);
  });
}
