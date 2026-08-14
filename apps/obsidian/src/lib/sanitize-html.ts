// React binding for Obsidian's sanitizeHTMLToDom.

import { sanitizeHTMLToDom } from "obsidian";
import { useCallback } from "react";

/**
 * Renders sanitized HTML into a DOM element React owns.
 *
 * Returns a ref callback that replaces the element's children with the
 * sanitized fragment. The callback identity changes only when `html` changes,
 * so re-renders with the same HTML skip the DOM write.
 *
 * @param html Untrusted HTML to sanitize via {@link sanitizeHTMLToDom}.
 * @returns A ref callback to attach to the host element.
 */
export function useSanitizedHtml<E extends HTMLElement>(html: string) {
  return useCallback(
    (el: E | null) => {
      if (el) el.replaceChildren(sanitizeHTMLToDom(html));
    },
    [html],
  );
}
