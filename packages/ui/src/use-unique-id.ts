import { useState } from "react";

let sequence = 0;

/**
 * An id that no other element of the document holds, for `htmlFor`,
 * `aria-labelledby`, `aria-describedby`, `form` and popover references.
 * `useId` counts within one Preact root, and each view, modal and pane is a
 * root of its own, so two of them in one window would share its ids.
 *
 * Client render only: the id comes from a module counter, so a server render
 * and the hydrating client count apart, and the hydrated attributes mismatch.
 * In a part that the docs site prerenders, keep the id out of the server
 * markup: Workbench containers name themselves through `useContainerName`.
 */
export function useUniqueId(): string {
  const [id] = useState(() => `zt-${(sequence += 1)}`);
  return id;
}
