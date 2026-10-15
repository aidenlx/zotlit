// A Zotero page label is whatever the PDF's page labels say: "12", "xiv", or
// a name such as "Chapter 1" or "Sakima's Song". Only a page number reads
// right after "p." or "Page"; a named label stands on its own.
import { regex } from "arkregex";

/** One page number: Arabic digits, or a well-formed Roman numeral. */
const NUMBER =
  "(?:\\d+|(?=[ivxlcdm])m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3}))";

/**
 * A page number, or a range of two. The Roman numeral alternation is too deep
 * for arkregex to infer; nothing reads the match, so it declares no captures.
 */
const PAGE_NUMBER = regex.as<string, { captures: []; flags: "i" }>(
  `^${NUMBER}(?:\\s*[-–]\\s*${NUMBER})?$`,
  "i",
);

/** Whether `label` is a page number, so it takes a page prefix such as "p.". */
export function isPageNumber(label: string): boolean {
  return PAGE_NUMBER.test(label.trim());
}
