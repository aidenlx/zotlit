// A dictionary keyed by names that come from the user's text, such as
// Formula names. It has no prototype, so a name such as `__proto__` or
// `constructor` is an own key like any other: an assignment to it sets the
// key, and a lookup of it finds no inherited member.
declare const prototypeFree: unique symbol;

/** A dictionary without a prototype; build one with {@link nameDictionary}. */
export type NameDictionary<V> = { readonly [name: string]: V } & {
  readonly [prototypeFree]: true;
};

/** The dictionary of `entries`; a later entry of the same name wins. */
export function nameDictionary<V>(
  entries: Iterable<readonly [string, V]> = [],
): NameDictionary<V> {
  const dictionary = Object.create(null) as Record<string, V>;
  for (const [name, value] of entries) dictionary[name] = value;
  return dictionary as NameDictionary<V>;
}
