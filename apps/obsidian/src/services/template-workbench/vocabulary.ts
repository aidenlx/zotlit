// Selector vocabulary shared by request.ts and guide.ts: the accepted `template`
// values, and the phrasing every vocabulary message and value list uses.

import { TEMPLATE_SLOT_ROOTS, type TemplateSlot } from "@zotlit/db";

/** The accepted `template` values, in the order selector messages list them. */
export const TEMPLATE_SLOT_NAMES = Object.keys(
  TEMPLATE_SLOT_ROOTS,
) as readonly TemplateSlot[];

/** `'a', 'b', or 'c'` — the phrasing every vocabulary message uses. */
export function quotedList(names: readonly string[]): string {
  const quoted = names.map((name) => `'${name}'`);
  const last = quoted.at(-1) ?? "";
  return quoted.length > 1
    ? `${quoted.slice(0, -1).join(", ")}, or ${last}`
    : last;
}
