// The text an annotation search matches, as a ZotLit Query expression.

/**
 * A ZotLit Query expression for the visible text of `field`, an annotation's
 * `text` or `comment` as Zotero stores it: rich text whose reader keeps its
 * inline tags (`<i>`, `<b>`, `<sub>`, `<sup>`). The tags go and their content
 * stays, so `H<sub>2</sub>O` reads `H2O` and a tag name is no word of it.
 * Every surface that searches annotation text matches against this one form.
 *
 * @param field the field as the filter reads it: `text` on the annotations
 *   dataset, `value.text` inside an Item's `annotations.filter(...)`.
 */
export function visibleText(field: string): string {
  return `${field}.replace(/<[^>]*>/g, "")`;
}
