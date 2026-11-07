// The two pure transitions every state of the tree is changed through.

/** Applies `changes`, or keeps `state` itself when every field already holds. */
export const patch =
  <S extends object>(changes: Partial<S>) =>
  (state: S): S =>
    (Object.keys(changes) as (keyof S)[]).every(
      (key) => state[key] === changes[key],
    )
      ? state
      : { ...state, ...changes };

/**
 * Applies `changes` to the object `state` holds at `key`, or keeps `state`
 * itself when every field already holds.
 */
export const patchAt =
  <S extends object, K extends keyof S>(
    key: K,
    changes: Partial<S[K] & object>,
  ) =>
  (state: S): S => {
    const current = state[key] as S[K] & object;
    const next = patch(changes)(current);
    return next === current ? state : { ...state, [key]: next };
  };
