// The write-free create composition: the exact bytes a new Literature Note
// carries, composed from an already-built template context. `operations.ts`
// writes them; the Note Preview renders them, so what the preview shows is what
// Create writes. Nothing here touches the vault or queues an import.

import { stringifyYaml } from "obsidian";

import type { NoteTemplateContext } from "@zotlit/db";
import { stringifyFrontmatterInOrder } from "@zotlit/templates/frontmatter";
import type { ManagedFrontmatterEvaluation } from "@zotlit/templates/frontmatter";
import type { FrontmatterMergeConflictHandler } from "@zotlit/templates/frontmatter-merge";

import {
  FIELD_CITATION_STYLE,
  FIELD_LITERATURE_NOTE_PROFILE,
} from "@/lib/constants";
import { getLogger } from "@/lib/log";
import type { ResolvedProfile } from "@/services/profile/bindings";
import type {
  ResolvedLiteratureNoteTemplate,
  TemplateService,
} from "@/services/template/service";

import {
  applyDocumentManagedFrontmatter,
  applyManagedFrontmatter,
  prepareManagedFrontmatter,
} from "./frontmatter";
import type {
  ManagedFrontmatterPreparationFailure,
  PreparedManagedFrontmatter,
} from "./frontmatter";

const logger = getLogger("note-feature");

/** The template slice the composition renders through. */
export interface ComposeNoteDeps {
  template: Pick<TemplateService, "render" | "frontmatterFields">;
  events?: {
    emit: (
      event: "frontmatter-eval-failed",
      payload: { itemKey: string; fields: string[] },
    ) => void;
  };
}

/** The Profile facts a written note stamps. */
export type ComposeProfile = Pick<ResolvedProfile, "stamp" | "citationStyle">;

export interface ComposeFrontmatterInput {
  context: NoteTemplateContext;
  itemKey: string;
  profile: ComposeProfile;
  prepared: PreparedManagedFrontmatter;
  /** Runs beside the logged warning, for a caller that reports conflicts. */
  onConflict?: FrontmatterMergeConflictHandler;
}

export interface ComposeNoteInput extends Omit<
  ComposeFrontmatterInput,
  "prepared"
> {
  document: ResolvedLiteratureNoteTemplate | undefined;
}

export interface ComposedNote {
  readonly outcome: "composed";
  readonly prepared: PreparedManagedFrontmatter;
  readonly frontmatter: Record<string, unknown>;
  /** The Properties block alone, without its `---` fences. */
  readonly frontmatterBlock: string;
  readonly body: string;
  readonly content: string;
}

export interface ComposeRefusal {
  readonly outcome: "refused";
  readonly failures: [
    ManagedFrontmatterPreparationFailure,
    ...ManagedFrontmatterPreparationFailure[],
  ];
  /**
   * The evaluation the refusal already ran, so a lenient reader lists each
   * field and its position without evaluating the entries a second time.
   */
  readonly evaluation: ManagedFrontmatterEvaluation;
  /**
   * The lenient view of that evaluation, so a reader that keeps rendering
   * lists each field with its position without assembling the shape itself.
   */
  readonly prepared: PreparedManagedFrontmatter;
}

export interface PreparedComposition {
  readonly outcome: "prepared";
  readonly prepared: PreparedManagedFrontmatter;
  readonly body: string;
}

/**
 * Prepare one Literature Note's Managed Frontmatter and render its body. The
 * body renders after the preparation, as the write path has always ordered it:
 * a body render queues the attachment and child-note imports its caller
 * flushes after the write.
 *
 * @returns the preparation and the body, or the refusal a failing Managed
 *   Frontmatter field produces — for which Create writes nothing.
 */
export function prepareLiteratureNote(
  deps: ComposeNoteDeps,
  input: Pick<ComposeNoteInput, "context" | "document">,
): PreparedComposition | ComposeRefusal {
  const result = prepareManagedFrontmatter(
    input.document?.frontmatter,
    input.context,
    Temporal.Now.instant(),
  );
  if ("failures" in result)
    return {
      outcome: "refused",
      ...result,
      prepared: {
        kind: "document",
        fields: result.evaluation.values,
        keys: result.evaluation.keys,
      },
    };
  const body = input.document
    ? input.document.renderForCreate(input.context)
    : deps.template.render("note", input.context);
  return { outcome: "prepared", prepared: result.prepared, body };
}

/**
 * Compose one Literature Note for create: the preparation and body, then the
 * applied fields serialized into the Properties block the write carries.
 *
 * @returns the composed note, or the refusal a failing Managed Frontmatter
 *   field produces — for which Create writes nothing.
 */
export function composeLiteratureNote(
  deps: ComposeNoteDeps,
  input: ComposeNoteInput,
): ComposedNote | ComposeRefusal {
  const base = prepareLiteratureNote(deps, input);
  if (base.outcome === "refused") return base;
  const { prepared, body } = base;
  const frontmatter: Record<string, unknown> = {};
  applyComposedFrontmatter(deps, frontmatter, {
    context: input.context,
    itemKey: input.itemKey,
    profile: input.profile,
    prepared,
    onConflict: input.onConflict,
  });
  const frontmatterBlock =
    prepared.kind === "document"
      ? stringifyFrontmatterInOrder(frontmatter, prepared.keys)
      : stringifyYaml(frontmatter);
  return {
    outcome: "composed",
    prepared,
    frontmatter,
    frontmatterBlock,
    body,
    content: `---\n${frontmatterBlock}---\n${body}`,
  };
}

/**
 * Apply one prepared document patch or the legacy settings-held field set, then
 * the Profile and citation-style stamps.
 *
 * @see docs/adr/0030-profile-stamp-carries-a-label-hint-beside-the-id.md
 */
export function applyComposedFrontmatter(
  deps: ComposeNoteDeps,
  fm: Record<string, unknown>,
  input: ComposeFrontmatterInput,
): void {
  const { context, itemKey, profile, prepared } = input;
  const failed: string[] = [];
  const onConflict: FrontmatterMergeConflictHandler = (key, detail) => {
    logger.warn("Skipped frontmatter append", { key, itemKey, ...detail });
    input.onConflict?.(key, detail);
  };
  if (prepared.kind === "document") {
    applyDocumentManagedFrontmatter(fm, context, { prepared, onConflict });
  } else {
    applyManagedFrontmatter(fm, context, {
      compiled: deps.template.frontmatterFields,
      onError: (key, error) => {
        failed.push(key);
        logger.warn("Frontmatter expression failed", { key, itemKey, error });
      },
      onConflict,
    });
  }
  if (failed.length > 0) {
    deps.events?.emit("frontmatter-eval-failed", { itemKey, fields: failed });
  }
  if (profile.stamp === undefined) delete fm[FIELD_LITERATURE_NOTE_PROFILE];
  else fm[FIELD_LITERATURE_NOTE_PROFILE] = profile.stamp;
  if (profile.citationStyle == null) delete fm[FIELD_CITATION_STYLE];
  else fm[FIELD_CITATION_STYLE] = profile.citationStyle;
}
