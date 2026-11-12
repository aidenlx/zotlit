// The landing's loop rule: at most one loop plays at a time — the table demo
// or one workflow recording. A loop that starts takes the turn and rests the
// one that held it.
// @see apps/docs/DESIGN.md → Motion (Loops)

let holder: symbol | null = null;
const rests = new Map<symbol, () => void>();

/** Starts the loop `me`: rests the loop that played before it. */
export function takeTurn(me: symbol, rest: () => void) {
  if (holder && holder !== me) rests.get(holder)?.();
  holder = me;
  rests.set(me, rest);
}

/** Ends the loop `me`'s turn, when it rests on its own. */
export function endTurn(me: symbol) {
  if (holder === me) holder = null;
  rests.delete(me);
}
