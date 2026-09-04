/** Apply the built-in JavaScript String conversion, including Symbol.toPrimitive. */
export function coerceToString(value: unknown): string {
  return Reflect.apply(String, undefined, [value]);
}
