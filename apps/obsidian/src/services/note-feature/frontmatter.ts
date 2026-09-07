import type { NoteTemplateContext } from "@zotlit/db";
import {
  evalFrontmatterFields,
  evalManagedFrontmatterEntries,
} from "@zotlit/templates/frontmatter";
import type {
  CompiledFrontmatterField,
  CompiledManagedFrontmatter,
} from "@zotlit/templates/frontmatter";
import {
  FRONTMATTER_ABSENT,
  mergeFrontmatterFields,
  mergeManagedFrontmatterEntries,
} from "@zotlit/templates/frontmatter-merge";
import type {
  EvaluatedFrontmatterField,
  FrontmatterMergeConflictHandler,
} from "@zotlit/templates/frontmatter-merge";

import { FIELD_ZOTERO_KEY } from "@/lib/constants";

export interface ApplyManagedFrontmatterOptions {
  compiled: readonly CompiledFrontmatterField[];
  onError?: (key: string, error: unknown) => void;
  onConflict?: FrontmatterMergeConflictHandler;
}

export type PreparedManagedFrontmatter =
  | { readonly kind: "legacy" }
  | {
      readonly kind: "document";
      readonly fields: readonly EvaluatedFrontmatterField[];
      readonly keys: readonly string[];
    };

export interface ApplyDocumentManagedFrontmatterOptions {
  prepared: Extract<PreparedManagedFrontmatter, { kind: "document" }>;
  onConflict?: FrontmatterMergeConflictHandler;
}

export interface ManagedFrontmatterPreparationFailure {
  readonly key: string;
  readonly reason: "inert" | "evaluation";
  readonly error?: unknown;
}

export type PrepareManagedFrontmatterResult =
  | { readonly prepared: PreparedManagedFrontmatter }
  | {
      readonly failures: [
        ManagedFrontmatterPreparationFailure,
        ...ManagedFrontmatterPreparationFailure[],
      ];
    };

export function prepareManagedFrontmatter(
  frontmatter: CompiledManagedFrontmatter | undefined,
  zt: NoteTemplateContext,
  operationTimestamp: Temporal.Instant,
): PrepareManagedFrontmatterResult {
  if (frontmatter === undefined) return { prepared: { kind: "legacy" } };
  const evaluation = evalManagedFrontmatterEntries(
    frontmatter.compiled,
    zt,
    operationTimestamp,
  );
  const failures: ManagedFrontmatterPreparationFailure[] = [
    ...evaluation.errors.map(({ key, error }) => ({
      key,
      reason: "evaluation" as const,
      error,
    })),
    ...frontmatter.inertKeys.map((key) => ({
      key,
      reason: "inert" as const,
    })),
  ];
  if (failures.length > 0) {
    return {
      failures: failures as [
        ManagedFrontmatterPreparationFailure,
        ...ManagedFrontmatterPreparationFailure[],
      ],
    };
  }

  return {
    prepared: {
      kind: "document",
      fields: evaluation.values,
      keys: evaluation.keys,
    },
  };
}

export function applyDocumentManagedFrontmatter(
  fm: Record<string, unknown>,
  zt: NoteTemplateContext,
  options: ApplyDocumentManagedFrontmatterOptions,
): void {
  const { prepared } = options;
  const patch = mergeManagedFrontmatterEntries(prepared.fields, {
    current: fm,
    onConflict: options.onConflict,
  });
  for (const { key } of prepared.fields) {
    if (!Object.hasOwn(patch, key)) continue;
    const value = patch[key];
    if (value === FRONTMATTER_ABSENT) delete fm[key];
    else defineFrontmatterValue(fm, key, value);
  }
  fm[FIELD_ZOTERO_KEY] = zt.indexedKey;
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
  for (const { key } of options.compiled) {
    if (Object.hasOwn(userPatch, key)) {
      defineFrontmatterValue(fm, key, userPatch[key]);
    }
  }

  fm[FIELD_ZOTERO_KEY] = zt.indexedKey;
}

function defineFrontmatterValue(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
