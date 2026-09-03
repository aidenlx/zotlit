// Browser-safe rendering of Workbench Item Snapshots.

import { CONTRACT_VERSION } from "@zotlit/db";
import { TemplateFacade } from "@zotlit/templates/facade";
import { evalManagedFrontmatterEntries } from "@zotlit/templates/frontmatter";
import { FRONTMATTER_ABSENT } from "@zotlit/templates/frontmatter-merge";

import book from "@/samples/book.json" with { type: "json" };
import conferencePaper from "@/samples/conference-paper.json" with { type: "json" };
import journalArticle from "@/samples/journal-article.json" with { type: "json" };
import thesis from "@/samples/thesis.json" with { type: "json" };
import type { ItemSnapshot } from "@/snapshot/index";

import { restoreTemplateData } from "./restore-template-data";
import { failedRender, profileSourceRevision } from "./result";
import type { ProfileRenderResult, RenderDiagnostic } from "./result";

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

  try {
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
    const compiled = facade.compileManagedFrontmatterEntries(
      document.manifest.frontmatter ?? [],
      { javascript: false },
    );
    const evaluated = evalManagedFrontmatterEntries(
      compiled.compiled,
      note,
      Temporal.Now.instant(),
    );
    const diagnostics: RenderDiagnostic[] = [
      ...compiled.inertKeys.map((key) => ({
        code: "property-error" as const,
        message: `Managed Frontmatter '${key}' requires JavaScript.`,
        part: "properties" as const,
      })),
      ...evaluated.errors.map(({ key, error }) => ({
        code: "property-error" as const,
        message: `${key}: ${errorMessage(error)}`,
        part: "properties" as const,
      })),
    ];
    return {
      ...identity,
      filename: facade.renderLiteratureNoteTemplateFilename(
        document,
        filenameData,
      ),
      properties: evaluated.values.map(({ key, value }) => ({
        key,
        ...(value === undefined || value === FRONTMATTER_ABSENT
          ? {}
          : { value }),
        missing: value === undefined || value === FRONTMATTER_ABSENT,
      })),
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
      diagnostics,
    };
  } catch (error) {
    return failedRender(identity, {
      code: "render-error",
      message: errorMessage(error),
      part: "render",
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
