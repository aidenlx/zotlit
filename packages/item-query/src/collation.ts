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
