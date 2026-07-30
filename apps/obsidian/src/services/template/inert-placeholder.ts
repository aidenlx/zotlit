// Brands template helpers whose live implementation would cause a side effect.

const INERT_PLACEHOLDER = Symbol("zotlit-inert-placeholder");

/** Mark a helper as an inert substitute and retain the reason shown to callers. */
export function markInertPlaceholder<T extends (...args: never[]) => unknown>(
  fn: T,
  reason: string,
): T {
  Object.defineProperty(fn, INERT_PLACEHOLDER, {
    value: reason,
    enumerable: false,
  });
  return fn;
}

/** Return the inert reason carried by a marked helper, if present. */
export function inertPlaceholderReason(value: unknown): string | undefined {
  if (typeof value !== "function") return undefined;
  return (value as unknown as Record<symbol, unknown>)[INERT_PLACEHOLDER] as
    | string
    | undefined;
}
