import { type FrontmatterField, type NoteTemplateContext } from "./types";

/**
 * Frontmatter keys owned by the system; user expressions cannot target them.
 * `zotero-key` / `citekey` are written from item data; `zt-attachments` scopes
 * attachments and is managed by the update flow.
 */
const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "zotero-key",
  "citekey",
  "zt-attachments",
]);

/**
 * Evaluate a single user frontmatter expression against the template data root.
 * The expression is user-authored JS (trusted, local config).
 *
 * @throws when the expression cannot be compiled or throws at runtime.
 */
export function evalFrontmatterField(
  expr: string,
  zt: NoteTemplateContext,
): unknown {
  // User frontmatter expressions are trusted local config; `new Function`
  // evaluates them against the `zt` data root by design.
  // oxlint-disable-next-line no-implied-eval
  const fn = new Function("zt", `return (${expr});`) as (
    zt: NoteTemplateContext,
  ) => unknown;
  return fn(zt);
}

export interface BuildFrontmatterOptions {
  fields: readonly FrontmatterField[];
  /**
   * Attachment keys to persist as `zt-attachments`; omit or pass empty to leave
   * the note unscoped ("all attachments").
   */
  attachmentScope?: readonly string[];
  onError?: (key: string, error: unknown) => void;
}

/**
 * Assemble the frontmatter record: system fields (`zotero-key`, `citekey`,
 * optional `zt-attachments`) plus the evaluated user fields. A failing user
 * expression is skipped (reported via `onError`) rather than aborting the rest.
 */
export function buildFrontmatter(
  zt: NoteTemplateContext,
  options: BuildFrontmatterOptions,
): Record<string, unknown> {
  const fm: Record<string, unknown> = { "zotero-key": zt.indexedKey };
  if (zt.citationKey) fm["citekey"] = zt.citationKey;
  if (options.attachmentScope && options.attachmentScope.length > 0) {
    fm["zt-attachments"] = [...options.attachmentScope];
  }

  for (const field of options.fields) {
    if (!field.key || RESERVED_KEYS.has(field.key)) continue;
    try {
      fm[field.key] = evalFrontmatterField(field.expr, zt);
    } catch (error) {
      options.onError?.(field.key, error);
    }
  }
  return fm;
}
