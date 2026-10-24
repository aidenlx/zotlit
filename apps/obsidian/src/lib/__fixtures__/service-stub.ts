/**
 * A service implementation that holds only the members a test supplies. Reading
 * any other member throws with the service and member named, so a consumer
 * that starts reading a new member fails at that read, not as an `undefined`
 * deep inside an adapter. Symbol keys and `then` read as `undefined`: the stub
 * is never mistaken for a thenable or an iterable.
 */
export function stubService<S extends object>(
  name: string,
  members: Partial<S>,
): S {
  return new Proxy(members, {
    get(target, key, receiver) {
      if (typeof key === "symbol" || key === "then" || key in target)
        return Reflect.get(target, key, receiver);
      throw new Error(`${name} stub lacks "${key}"`);
    },
  }) as S;
}
