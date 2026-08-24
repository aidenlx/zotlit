// Selector vocabulary shared by request.ts and guide.ts: the accepted `template`
// values, and the phrasing every vocabulary message and value list uses.

import { TEMPLATE_SLOT_ROOTS } from "@zotlit/db";
import type { TemplateSlot } from "@zotlit/db";
import type {
  FrontmatterLanguage,
  FrontmatterMergeStrategy,
} from "@zotlit/templates/constants";

/** The accepted `template` values, in the order selector messages list them. */
export const TEMPLATE_SLOT_NAMES = Object.keys(
  TEMPLATE_SLOT_ROOTS,
) as readonly TemplateSlot[];

/** Accepted `language` values, in the order selector messages list them. */
export const FRONTMATTER_LANGUAGE_NAMES = [
  "liquid",
  "javascript",
] as const satisfies readonly FrontmatterLanguage[];

/** Accepted `merge` values, in the order selector messages list them. */
export const FRONTMATTER_MERGE_NAMES = [
  "replace",
  "append",
  "keep",
] as const satisfies readonly FrontmatterMergeStrategy[];

/** `'a', 'b', or 'c'` — the phrasing every vocabulary message uses. */
export function quotedList(names: readonly string[]): string {
  const quoted = names.map((name) => `'${name}'`);
  const last = quoted.at(-1) ?? "";
  return quoted.length > 1
    ? `${quoted.slice(0, -1).join(", ")}, or ${last}`
    : last;
}

/** `<a|b|c>` — a flag's accepted values, read from the canonical registry so
 *  renaming a root or a slot cannot leave the help text stale. */
export function choices(names: readonly string[]): string {
  return `<${names.join("|")}>`;
}
