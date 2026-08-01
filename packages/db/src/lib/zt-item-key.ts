import { regex } from "arkregex";

/**
 * Zotero's item-key charset: digits 2-9 plus uppercase A-Z excluding `O`,
 * avoiding visual ambiguity with `0`/`1`/`I`/`O`. Keys are always 8
 * characters; a value failing this can never be a genuine Zotero key.
 *
 * @see https://github.com/zotero/utilities/blob/86948f960557c18eb6489ebe228b820957d13cf0/utilities.js#L1729 `allowedKeyChars`
 * @see https://github.com/zotero/utilities/blob/86948f960557c18eb6489ebe228b820957d13cf0/utilities.js#L1741-L1746 `isValidObjectKey`
 */
const ITEM_KEY_RE = regex("^[23456789A-NP-Z]{8}$");

/** Whether `value` is a bare Zotero item key. */
export function isItemKey(value: string): boolean {
  return ITEM_KEY_RE.test(value);
}
