// The site's loop rule: at most one loop plays at a time — a lesson or landing
// recording, or the landing's table demo. A loop that starts takes the turn
// and rests the one that held it, except that a recording the reader paused
// keeps the turn from automatic starts while it stays in view.
// @see apps/docs/DESIGN.md → Motion (Loops)

let holder: symbol | null = null;
/** The holder is a recording the reader paused, which only a reader's play takes the turn from. */
let held = false;
const rests = new Map<symbol, () => void>();
// Loops rested or refused while still in view, which play again when the turn comes free.
const waiting = new Map<symbol, () => void>();

/** Starts the loop `me` on the reader's press: rests the loop that played before it. */
export function takeTurn(me: symbol, rest: () => void) {
  if (holder && holder !== me) rests.get(holder)?.();
  holder = me;
  held = false;
  rests.set(me, rest);
}

/**
 * Starts the loop `me` on its own, unless a recording the reader paused holds
 * the turn.
 * @returns false when the loop must stay at rest; it can `awaitTurn` instead.
 */
export function askTurn(me: symbol, rest: () => void) {
  if (held && holder !== me) return false;
  takeTurn(me, rest);
  return true;
}

/** The reader paused the loop `me`, which keeps the turn until it leaves view and calls `endTurn`. */
export function holdTurn(me: symbol) {
  if (holder !== me) return;
  held = true;
  rests.delete(me);
}

/** Ends the loop `me`'s turn, when it rests on its own or leaves view, and hands the turn to the first loop waiting for it. */
export function endTurn(me: symbol) {
  rests.delete(me);
  if (holder !== me) return;
  holder = null;
  held = false;
  const [next] = waiting.entries();
  if (next) {
    waiting.delete(next[0]);
    next[1]();
  }
}

/** Queues the loop `me`, rested or refused while in view, to `resume` when the turn comes free. */
export function awaitTurn(me: symbol, resume: () => void) {
  waiting.set(me, resume);
}

/** Takes the loop `me` out of the queue, once it leaves view or plays. */
export function stopWaiting(me: symbol) {
  waiting.delete(me);
}
