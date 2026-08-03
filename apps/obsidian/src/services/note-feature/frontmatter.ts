import { type NoteTemplateContext } from "@zotlit/db";
import {
  evalFrontmatterFields,
  type CompiledFrontmatterField,
} from "@zotlit/templates/frontmatter";
import {
  type FrontmatterMergeConflictHandler,
  mergeFrontmatterFields,
} from "@zotlit/templates/frontmatter-merge";

import { FIELD_ZOTERO_KEY } from "@/lib/constants";

export interface ApplyManagedFrontmatterOptions {
  compiled: readonly CompiledFrontmatterField[];
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
}
