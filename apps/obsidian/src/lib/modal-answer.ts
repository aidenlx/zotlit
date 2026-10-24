// A modal's answer as a Promise, for a caller outside Effect. It lives apart
// from `effect-modal`, so a legacy file that imports it stays a legacy file.
import { Effect } from "@/lib/effect";
import { awaitModal } from "@/lib/effect-modal";
import type { ClosableModal } from "@/lib/effect-modal";

/**
 * {@link awaitModal} as a Promise. The modal opens before this returns, and
 * the first answer wins.
 */
export function modalAnswer<A>(
  open: (settle: (answer: A) => void) => ClosableModal,
): Promise<A> {
  return Effect.runPromise(awaitModal(open));
}
