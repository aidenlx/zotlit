/**
 * The one string order of Item Query: sort, the ordered comparisons of a
 * Filter Expression, and the element order of `tags` and `collections`.
 *
 * The locale is `en`, whose collation is the untailored CLDR root order. The
 * tag `und` resolves to the default locale of the machine in V8, so it gives a
 * different order on a machine with another system language.
 */
const COLLATOR = new Intl.Collator("en", {
  usage: "sort",
  sensitivity: "variant",
  numeric: false,
  caseFirst: "false",
  ignorePunctuation: false,
});

/** Compare two strings in the Item Query string order. */
export function compareStrings(a: string, b: string): number {
  return COLLATOR.compare(a, b);
}

/** Scalar wire order: booleans, numbers, strings, then null. */
export function compareScalars(
  a: string | number | boolean | null,
  b: string | number | boolean | null,
): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a !== typeof b) return compareStrings(typeof a, typeof b);
  if (typeof a === "string") return compareStrings(a, b as string);
  return Number(a) - Number(b);
}
