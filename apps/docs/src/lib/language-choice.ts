// Whether to suggest the Chinese edition to the reader of an English page.
//
// English pages are prerendered, so their HTML cannot know the browser's
// language. A script in <head> decides before the first paint and marks
// <html> with one attribute; the suggestion strip is in the HTML of every
// English page with a Chinese edition and shows only under that attribute, so it never
// moves the page.

/** Storage key for the reader's own language choice: "en" stops the suggestion. */
export const LANGUAGE_CHOICE_KEY = "zotlit:language";

/** The <html> attribute for a reader whose browser puts Chinese first and who has not chosen English. */
export const CHINESE_READER_ATTR = "data-chinese-reader";

/**
 * Runs in <head> before the body paints. Any Chinese browser language counts
 * (`zh`, `zh-CN`, `zh-TW`, …): the site has one Chinese edition, Simplified,
 * which a Traditional Chinese reader reads more easily than English.
 */
export const chineseReaderScript = `try{var l=(navigator.languages&&navigator.languages[0])||navigator.language||"";if(localStorage.getItem(${JSON.stringify(LANGUAGE_CHOICE_KEY)})!=="en"&&/^zh(-|$)/i.test(l))document.documentElement.setAttribute(${JSON.stringify(CHINESE_READER_ATTR)},"")}catch(e){}`;

/** Record the language the reader chose, from the language menu or the strip's close button. */
export function rememberLanguageChoice(locale: string) {
  try {
    localStorage.setItem(LANGUAGE_CHOICE_KEY, locale);
  } catch {
    // Storage can be blocked (private mode, site data off); the suggestion then returns next visit.
  }
  if (locale === "en")
    document.documentElement.removeAttribute(CHINESE_READER_ATTR);
}
