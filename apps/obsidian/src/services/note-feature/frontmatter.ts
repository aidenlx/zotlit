import { distinct } from "@std/collections";

import {
  FIELD_ATTACHMENTS,
  FIELD_CITEKEY,
  FIELD_ZOTERO_KEY,
} from "@/lib/constants";

import { type FrontmatterField, type NoteTemplateContext } from "./types";

/**
 * Frontmatter keys owned by the system; user expressions cannot target them.
 * Item identity fields are written from item data; attachment scope is managed
 * by the update flow.
 */
const RESERVED_KEYS: ReadonlySet<string> = new Set([
  FIELD_ZOTERO_KEY,
  FIELD_CITEKEY,
  FIELD_ATTACHMENTS,
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
   * Attachment keys to persist; omit or pass empty to leave
   * the note unscoped ("all attachments").
   */
  attachmentScope?: readonly string[];
  onError?: (key: string, error: unknown) => void;
}

/**
 * Assemble the frontmatter record: system fields plus evaluated user fields. A
 * failing user expression is skipped (reported via `onError`) rather than
 * aborting the rest.
 */
export function buildFrontmatter(
  zt: NoteTemplateContext,
  options: BuildFrontmatterOptions,
): Record<string, unknown> {
  const fm: Record<string, unknown> = {
    [FIELD_ZOTERO_KEY]: zt.indexedKey,
  };
  if (zt.citationKey) fm[FIELD_CITEKEY] = zt.citationKey;
  if (options.attachmentScope && options.attachmentScope.length > 0) {
    fm[FIELD_ATTACHMENTS] = [...options.attachmentScope];
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

export function mergeManagedFrontmatter(
  target: Record<string, unknown>,
  managed: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(managed)) {
    const existing = target[key];
    target[key] =
      Array.isArray(existing) && Array.isArray(value)
        ? distinct([...existing, ...value])
        : value;
  }
}
