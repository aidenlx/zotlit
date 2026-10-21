// The text an annotation search matches, as a ZotLit Query expression.

import { COMMENT_TAG_SOURCE } from "@/views/annot-view/comment-format";

/**
 * A ZotLit Query expression for the visible text of `field`, an annotation's
 * `text` or `comment` as Zotero stores it: plain text that holds the reader's
 * inline tags (`<i>`, `<b>`, `<sub>`, `<sup>`). Those tags go and their
 * content stays, so `H<sub>2</sub>O` reads `H2O` and a tag name is no word of
 * it. Every other angle bracket stays, so `p < 0.05` reads as written. Every
 * surface that searches annotation text matches against this one form.
 *
 * A tag with no partner goes too, where the card shows it as text; such a
 * comment is rare, and the search then misses only the bare tag.
 *
 * @param field the field as the filter reads it: `text` on the annotations
 *   dataset, `value.text` inside an Item's `annotations.filter(...)`.
 */
export function visibleText(field: string): string {
  return `${field}.replace(/${COMMENT_TAG_SOURCE.replaceAll("/", "\\/")}/gi, "")`;
}
