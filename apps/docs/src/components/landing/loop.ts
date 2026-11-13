// The landing's loop rule: at most one loop plays at a time — the table demo
// or one workflow recording. A loop that starts takes the turn and rests the
// one that held it.
// @see apps/docs/DESIGN.md → Motion (Loops)

let holder: symbol | null = null;
const rests = new Map<symbol, () => void>();
// Loops rested while still in view, which play again when the turn comes free.
const waiting = new Map<symbol, () => void>();

/** Starts the loop `me`: rests the loop that played before it. */
export function takeTurn(me: symbol, rest: () => void) {
  if (holder && holder !== me) rests.get(holder)?.();
  holder = me;
  rests.set(me, rest);
}

/** Ends the loop `me`'s turn, when it rests on its own, and hands the turn to the first loop waiting for it. */
export function endTurn(me: symbol) {
  rests.delete(me);
  if (holder !== me) return;
  holder = null;
  const [next] = waiting.entries();
  if (next) {
    waiting.delete(next[0]);
    next[1]();
  }
}

/** Queues the loop `me`, rested while in view, to `resume` when the turn comes free. */
export function awaitTurn(me: symbol, resume: () => void) {
  waiting.set(me, resume);
}

/** Takes the loop `me` out of the queue, once it leaves view or plays. */
export function stopWaiting(me: symbol) {
  waiting.delete(me);
}
