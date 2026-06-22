import { type NoteTemplateContext } from "@zotlit/db";
import {
  compileFrontmatterFields,
  evalFrontmatterFields,
  type CompiledFrontmatterField,
  type FrontmatterField,
} from "@zotlit/templates/frontmatter";
import {
  type FrontmatterMergeConflictHandler,
  mergeFrontmatterFields,
} from "@zotlit/templates/frontmatter-merge";

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

export interface ApplyManagedFrontmatterOptions {
  compiled: readonly CompiledFrontmatterField[];
  /**
   * Attachment keys to persist; omit or pass empty to leave
   * the note unscoped ("all attachments").
   */
  attachmentScope?: readonly string[];
  onError?: (key: string, error: unknown) => void;
  onConflict?: FrontmatterMergeConflictHandler;
}

export function applyManagedFrontmatter(
  fm: Record<string, unknown>,
  zt: NoteTemplateContext,
  options: ApplyManagedFrontmatterOptions,
): void {
  const evaluated = evalFrontmatterFields(
    options.compiled,
    zt,
    options.onError,
  );
  const userPatch = mergeFrontmatterFields(options.compiled, evaluated, {
    current: fm,
    onConflict: options.onConflict,
  });
  for (const [key, value] of Object.entries(userPatch)) fm[key] = value;

  fm[FIELD_ZOTERO_KEY] = zt.indexedKey;
  if (zt.citationKey) {
    fm[FIELD_CITEKEY] = zt.citationKey;
  } else {
    // In processFrontMatter, assigning `undefined` deletes the key while
    // `null` serializes as YAML null. Use delete for absent system fields so
    // create and refresh share the same explicit behavior.
    delete fm[FIELD_CITEKEY];
  }
  if (options.attachmentScope && options.attachmentScope.length > 0) {
    fm[FIELD_ATTACHMENTS] = [...options.attachmentScope];
  } else {
    delete fm[FIELD_ATTACHMENTS];
  }
}
