// Test records shaped like the template context's list items.

/** A record that reads as `text` through its own non-enumerable `toString`, as the template context's creators, tags and collections do. */
export function withText<T extends object>(record: T, text: string): T {
  Object.defineProperty(record, "toString", {
    value: () => text,
    enumerable: false,
  });
  return record;
}
