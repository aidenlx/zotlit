// Browser-safe rendering of Workbench Item Snapshots. A connected render
// validates the selected citation style bundle here; CSL formatting stays in
// Obsidian because this preview produces the Profile's generated Markdown and
// has no bibliography or citation processor.

import { CONTRACT_VERSION } from "@zotlit/db";
import { TemplateFacade } from "@zotlit/templates/facade";
import type { ManagedFrontmatterEntry } from "@zotlit/templates/facade";
import { evalManagedFrontmatterEntries } from "@zotlit/templates/frontmatter";
import {
  FRONTMATTER_ABSENT,
  mergeManagedFrontmatterEntries,
} from "@zotlit/templates/frontmatter-merge";
import type { EvaluatedFrontmatterField } from "@zotlit/templates/frontmatter-merge";

import type { SelectedCitationStyleResponse } from "@/bridge/contracts";
import book from "@/samples/book.json" with { type: "json" };
import conferencePaper from "@/samples/conference-paper.json" with { type: "json" };
import journalArticle from "@/samples/journal-article.json" with { type: "json" };
import thesis from "@/samples/thesis.json" with { type: "json" };
import type { ItemSnapshot } from "@/snapshot/index";

import { restoreTemplateData } from "./restore-template-data";
import { failedRender, profileSourceRevision } from "./result";
import type {
  ProfileRenderResult,
  RenderDiagnostic,
  RenderedProperty,
} from "./result";
import type { RenderResources } from "./scheduler";

export { DEFAULT_PROFILE_SOURCE } from "./default-profile";
export { failedRender, profileSourceRevision } from "./result";
export type {
  ProfileRenderResult,
  RenderDiagnostic,
  RenderedProperty,
  RenderIdentity,
} from "./result";
export { createRenderScheduler } from "./scheduler";
export type {
  RenderRequest,
  RenderResources,
  RenderScheduler,
  RenderSchedulerOptions,
  RenderWorkerHandle,
} from "./scheduler";
export { restoreTemplateData } from "./restore-template-data";

export const SAMPLE_ITEMS = [
  journalArticle,
  conferencePaper,
  book,
  thesis,
] as unknown as readonly ItemSnapshot[];

export function renderProfile(
  source: string,
  snapshot: ItemSnapshot,
  resources?: RenderResources,
): ProfileRenderResult {
  const identity = {
    sourceRevision: profileSourceRevision(source),
    snapshotRevision: snapshot.revision,
  };
  if (snapshot.contractVersion !== CONTRACT_VERSION) {
    return failedRender(identity, {
      code: "contract-version-mismatch",
      message: `Item Snapshot contract ${snapshot.contractVersion} does not match ${CONTRACT_VERSION}.`,
    });
  }

  const facade = new TemplateFacade();
  let document;
  try {
    document = facade.parseLiteratureNoteTemplate(source);
  } catch (error) {
    return failedRender(identity, {
      code: "invalid-profile",
      message: errorMessage(error),
      part: "profile",
    });
  }
  const dependencyDiagnostics: RenderDiagnostic[] = (
    resources?.dependencies.diagnostics ?? []
  ).map((diagnostic) => ({ ...diagnostic, part: "profile" }));
  const resourceDiagnostics = [
    ...dependencyDiagnostics,
    ...citationStyleDiagnostics(resources?.citationStyle),
  ];

  try {
    for (const partial of resources?.dependencies.templates ?? []) {
      facade.define(partial.name, partial.source, partial.language);
    }
    for (const partial of document.manifest.partials ?? []) {
      facade.define(partial.name, partial.source, partial.language);
    }
    const note = restoreTemplateData(
      snapshot.roots.note,
      snapshot.descriptors.note,
    );
    const filenameData = restoreTemplateData(
      snapshot.roots.filename,
      snapshot.descriptors.filename,
    );
    const annotations = snapshot.roots.annotations.map((annotation, index) => {
      const descriptors = snapshot.descriptors.annotations[index];
      if (!descriptors) {
        throw new Error(`Annotation ${index} has no snapshot descriptors.`);
      }
      return restoreTemplateData(annotation, descriptors);
    });
    const frontmatter = evaluateFrontmatter(
      facade,
      document.manifest.frontmatter ?? [],
      note,
    );
    return {
      ...identity,
      filename: facade.renderLiteratureNoteTemplateFilename(
        document,
        filenameData,
      ),
      properties: frontmatter.properties,
      fold: frontmatter.fold,
      creationBody: facade.renderLiteratureNoteTemplateForCreate(
        document,
        note,
      ),
      managedRegion: facade.renderLiteratureNoteTemplateForUpdate(
        document,
        note,
      ),
      annotation:
        annotations.length > 0
          ? facade.renderLiteratureNoteTemplateAnnotation(
              document,
              annotations[0]!,
            )
          : null,
      diagnostics: [...resourceDiagnostics, ...frontmatter.diagnostics],
    };
  } catch (error) {
    const failure = failedRender(identity, {
      code: "render-error",
      message: errorMessage(error),
      part: "render",
    });
    return {
      ...failure,
      diagnostics: [...resourceDiagnostics, ...failure.diagnostics],
    };
  }
}

function citationStyleDiagnostics(
  style: SelectedCitationStyleResponse | undefined,
): RenderDiagnostic[] {
  if (style?.kind !== "failed") return [];
  let message: string;
  switch (style.reason) {
    case "style-missing":
      message = `Citation style '${style.styleId}' is not installed.`;
      break;
    case "parent-missing":
      message = `Citation style '${style.styleId}' requires missing parent '${style.parentId}'.`;
      break;
    case "unreadable":
      message = `Citation style '${style.styleId}' could not be read.`;
      break;
    case "invalid":
      message = `Citation style '${style.styleId}' is invalid.`;
      break;
  }
  return [{ code: "citation-style-error", message, part: "render" }];
}

/**
 * Evaluates every authored entry against one snapshot — each on its own, none
 * reading another's result — so a row shows what it produced by itself, then
 * folds every contribution in list order into the frontmatter the note gets.
 * Every diagnostic carries the 1-based position of the entry that raised it,
 * which is how a row claims its own.
 */
function evaluateFrontmatter(
  facade: TemplateFacade,
  authored: readonly ManagedFrontmatterEntry[],
  note: object,
): {
  properties: readonly RenderedProperty[];
  fold: readonly RenderedProperty[];
  diagnostics: readonly RenderDiagnostic[];
} {
  const { compiled } = facade.compileManagedFrontmatterEntries(authored, {
    javascript: false,
  });
  const { values, errors } = evalManagedFrontmatterEntries(
    compiled,
    note,
    Temporal.Now.instant(),
  );
  const properties = values.map(rendered);
  const conflicts: EntryDiagnostic[] = [];
  const patch = mergeManagedFrontmatterEntries(values, {
    // An append that meets a value it cannot extend leaves the fold without the
    // key it produced, so the entry that produced it says so. Every compiled
    // entry stamps its own position onto what it produced, so the conflict
    // names one.
    onConflict: (key, { position, recovery }) =>
      conflicts.push(
        propertyError(
          `${key}: this entry could not append to the value an earlier entry set.${recovery === undefined ? "" : ` ${recovery}`}`,
          position!,
        ),
      ),
  });
  const fold = Object.entries(patch).map(([key, value]) => ({
    key,
    ...(value === FRONTMATTER_ABSENT ? {} : { value }),
    missing: value === FRONTMATTER_ABSENT,
    // Every merged key came from one of these values, and the first entry to
    // produce one fixes where it sits in a created note. An entry whose
    // expression produced nothing contributed no such value.
    position: properties.find(
      (property) => property.key === key && !property.missing,
    )!.position,
  }));
  const diagnostics = [
    ...authored.flatMap((entry, index) =>
      "js" in entry
        ? [
            propertyError(
              `Managed Frontmatter ${label(entry, index + 1)} requires JavaScript.`,
              index + 1,
            ),
          ]
        : [],
    ),
    ...errors.map(({ key, position, error }) =>
      propertyError(`${key}: ${errorMessage(error)}`, position),
    ),
    ...conflicts,
  ].toSorted(byPosition);
  return { properties, fold, diagnostics };
}

/** A property diagnostic, which always names the entry that raised it. */
type EntryDiagnostic = RenderDiagnostic & { readonly position: number };

/** A problem one entry raised, under the position that carries it to its row. */
function propertyError(message: string, position: number): EntryDiagnostic {
  return { code: "property-error", message, part: "properties", position };
}

/** List order, so the diagnostic a host reads first belongs to the first row. */
function byPosition(a: EntryDiagnostic, b: EntryDiagnostic): number {
  return a.position - b.position;
}

function rendered({
  key,
  value,
  position,
}: EvaluatedFrontmatterField): RenderedProperty {
  const missing = value === undefined || value === FRONTMATTER_ABSENT;
  // Every compiled entry stamps its own position onto what it produced.
  return { key, ...(missing ? {} : { value }), missing, position: position! };
}

/**
 * The entry a property diagnostic is about. This package holds no Language Pack
 * facade — it renders inside a worker and inside Obsidian — so the wording it
 * hands a host stays English until a diagnostic carries a code the host maps.
 */
function label(entry: ManagedFrontmatterEntry, position: number): string {
  return entry.key === undefined ? `entry #${position}` : `'${entry.key}'`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
