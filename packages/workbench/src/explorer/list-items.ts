// How a list's items read in a note: the one source for the list preview, the list shape and the list snippets.

/** True for an object literal or a null-prototype record, as opposed to a class instance such as a Temporal date. */
export function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * True for an item a template prints as itself: a primitive, a record with
 * its own `toString` (creators, tags, collections), or a class instance such
 * as a date. A plain record without one prints `[object Object]`.
 */
export function itemReadsAsText(item: unknown): boolean {
  if (item === null || item === undefined) return false;
  if (typeof item !== "object") return true;
  if (Array.isArray(item)) return false;
  return Object.hasOwn(item, "toString") || !isPlainObject(item);
}

/** True when every item reads as text, so the list joins into one meaningful line. An empty list counts, as its item shape is unknown. */
export function listReadsAsText(list: readonly unknown[]): boolean {
  return list.every(itemReadsAsText);
}

/** The plain records among a list's items. */
export function listRecords(list: readonly unknown[]): object[] {
  return list.filter(
    (item): item is object =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      isPlainObject(item),
  );
}

/** Every property the list's records have, in the display tree's order. */
export function listPropertyNames(list: readonly unknown[]): string[] {
  const names = new Set<string>();
  for (const record of listRecords(list))
    for (const name of Object.keys(record)) names.add(name);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * The property one line of a list shows for each item, in the preview and in
 * the loop snippet alike: `undefined` when the items read as text, so a line
 * shows the item itself. Else the first property, in the display tree's
 * order, that some item has a value for and that reads as text for every item
 * that has one; then the first that reads as text for some item; then the
 * first property the records have.
 */
export function listLineProperty(list: readonly unknown[]): string | undefined {
  if (listReadsAsText(list)) return undefined;
  const names = listPropertyNames(list);
  const records = listRecords(list);
  const values = (name: string) =>
    records
      .map((record) => ownValue(record, name))
      .filter((value) => value !== undefined && value !== null && value !== "");
  const text = (value: unknown) =>
    typeof value !== "function" && itemReadsAsText(value);
  return (
    names.find((name) => {
      const present = values(name);
      return present.length > 0 && present.every(text);
    }) ??
    names.find((name) => values(name).some(text)) ??
    names[0]
  );
}

/** A record's own value for `name`; an unread getter counts as no value, as the tree leaves it unread. */
function ownValue(record: object, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, name);
  return descriptor && !descriptor.get ? descriptor.value : undefined;
}
