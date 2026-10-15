import { useState } from "react";

let sequence = 0;

/**
 * An id that no other element of the document holds, for `htmlFor`,
 * `aria-labelledby`, `aria-describedby`, `form` and popover references.
 * `useId` counts within one Preact root, and each view, modal and pane is a
 * root of its own, so two of them in one window would share its ids.
 */
export function useUniqueId(): string {
  const [id] = useState(() => `zt-${(sequence += 1)}`);
  return id;
}
