import { distinct } from "@std/collections";

import { type NoteTemplateContext } from "@zotlit/db";
import {
  compileFrontmatterFields,
  evalFrontmatterFields,
  type CompiledFrontmatterField,
  type FrontmatterField,
} from "@zotlit/templates/frontmatter";

import {
  FIELD_ATTACHMENTS,
  FIELD_CITEKEY,
  FIELD_ZOTERO_KEY,
  RESERVED_KEYS,
} from "@/lib/constants";

/**
 * Compile the user fields once for repeated note builds, dropping reserved keys
 * the system owns so user and system keys stay disjoint.
 */
export function compileFrontmatter(
  fields: readonly FrontmatterField[],
): CompiledFrontmatterField[] {
  return compileFrontmatterFields(
    fields.filter((field) => !RESERVED_KEYS.has(field.key)),
  );
}

export interface BuildFrontmatterOptions {
  compiled: readonly CompiledFrontmatterField[];
  /**
   * Attachment keys to persist; omit or pass empty to leave
   * the note unscoped ("all attachments").
   */
  attachmentScope?: readonly string[];
  onError?: (key: string, error: unknown) => void;
}

/**
 * Assemble the frontmatter record: system fields plus evaluated user fields. A
 * failing user expression is skipped (reported via `onError`).
 */
export function buildFrontmatter(
  zt: NoteTemplateContext,
  options: BuildFrontmatterOptions,
): Record<string, unknown> {
  const fm = evalFrontmatterFields(options.compiled, zt, options.onError);

  fm[FIELD_ZOTERO_KEY] = zt.indexedKey;
  if (zt.citationKey) fm[FIELD_CITEKEY] = zt.citationKey;
  if (options.attachmentScope && options.attachmentScope.length > 0) {
    fm[FIELD_ATTACHMENTS] = [...options.attachmentScope];
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
