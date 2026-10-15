// A Zotero page label is whatever the PDF's page labels say: "12", "xiv", or
// a name such as "Chapter 1" or "Sakima's Song". Only a page number reads
// right after "p." or "Page"; a named label stands on its own.

/** One page number: Arabic digits, or a well-formed Roman numeral. */
const NUMBER =
  "(?:\\d+|(?=[ivxlcdm])m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3}))";

/** A page number, or a range of two. */
const PAGE_NUMBER = new RegExp(`^${NUMBER}(?:\\s*[-–]\\s*${NUMBER})?$`, "i");

/** Whether `label` is a page number, so it takes a page prefix such as "p.". */
export function isPageNumber(label: string): boolean {
  return PAGE_NUMBER.test(label.trim());
}
