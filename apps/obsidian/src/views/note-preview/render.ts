// Read-only rendering of a draft Profile against the installed template pipeline.
import { parseYaml, stringifyYaml, getFrontMatterInfo } from "obsidian";

import { withAnnotationCitation } from "@zotlit/db";
import type {
  AnnotationTemplateContext,
  NoteTemplateContext,
} from "@zotlit/db";
import { replaceSuffixMarkers } from "@zotlit/templates";
import { FRONTMATTER_ABSENT } from "@zotlit/templates/frontmatter-merge";
import type { FrontmatterMergeConflictHandler } from "@zotlit/templates/frontmatter-merge";
import { replaceManagedRegion } from "@zotlit/templates/obsidian";
import { restoreTemplateData } from "@zotlit/workbench/render";
import {
  failedRender,
  renderIdentity,
  SAMPLE_ANNOTATIONS,
} from "@zotlit/workbench/render";
import type {
  ProfileRenderResult,
  RenderRequest,
  RenderDiagnostic,
} from "@zotlit/workbench/render";

import { annotationCitation as renderAnnotationCitation } from "@/lib/annotation-render";
import { FIELD_DOCUMENT_LANGUAGE } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import { isLanguageTag } from "@/lib/language-tag";
import { DEFAULT_PROFILE } from "@/lib/profile-stamp";
import type { ProfileId } from "@/lib/profile-stamp";
import type { DatabaseService } from "@/services/database/service";
import {
  applyComposedFrontmatter,
  composeLiteratureNote,
  prepareLiteratureNote,
} from "@/services/note-feature";
import { bindProfile } from "@/services/profile/bindings";
import { seedProfileEntry } from "@/services/profile/service";
import { loadTemplateData } from "@/services/template-workbench/data";
import type { TemplateDataDeps } from "@/services/template-workbench/data";
import { findExistingLitNote } from "@/services/template/inert-resolver-host";
import type { TemplateService } from "@/services/template/service";

import { renderDraftCitations } from "./citations";
import type { NativeCitationDeps, PreviewCitation } from "./citations";

export interface NativeRenderDeps extends TemplateDataDeps, NativeCitationDeps {
  db: Pick<DatabaseService, "acquireRead" | "on">;
  templates: Pick<
    TemplateService,
    | "ready"
    | "render"
    | "prepareLiteratureNoteTemplateSource"
    | "frontmatterFields"
    | "javascriptTemplatesEnabled"
    | "on"
  >;
}
export interface NativeRenderResult extends ProfileRenderResult {
  readonly sourcePath: string;
  readonly citations: readonly PreviewCitation[];
  readonly annotationCitations: readonly PreviewCitation[];
}

/** A result composed outside this renderer, in the shape the preview reads. */
export function nativeResult(result: ProfileRenderResult): NativeRenderResult {
  return { sourcePath: "", citations: [], annotationCitations: [], ...result };
}

/** Keep the real note's outside body and unrelated Properties, entirely in memory. */
export function previewBaseline(
  source: string | null,
  created: string,
  managed: string | null,
) {
  const info = source === null ? null : getFrontMatterInfo(source);
  const current: unknown = info?.exists ? parseYaml(info.frontmatter) : {};
  const frontmatter: Record<string, unknown> =
    current !== null && typeof current === "object" && !Array.isArray(current)
      ? { ...current }
      : {};
  const body = source === null ? created : source.slice(info!.contentStart);
  return {
    frontmatter,
    body:
      managed === null
        ? body
        : replaceManagedRegion(body, () => managed).content,
  };
}

export async function renderNativeProfile(
  deps: NativeRenderDeps,
  request: RenderRequest,
): Promise<NativeRenderResult> {
  const identity = renderIdentity(request);
  let sourcePath = "";
  try {
    await deps.templates.ready;
    const document = deps.templates.prepareLiteratureNoteTemplateSource(
      request.source,
    );
    const settings = await deps.settings.loaded;
    const manifest = document.manifest;
    // The draft resolves exactly as the registry resolves a saved Profile:
    // one entry seeded from the manifest, bound by the shared resolver. The
    // preview reads neither the entry's match nor its document reference, so
    // the draft supplies no Library scope and no path.
    const profile =
      manifest.id === DEFAULT_PROFILE
        ? bindProfile(settings, { selector: DEFAULT_PROFILE })
        : bindProfile(settings, {
            selector: manifest.id as ProfileId,
            entry: seedProfileEntry(manifest, {
              document: "",
              path: "",
              libraries: [],
            }),
          });
    const dataDeps = {
      ...deps,
      settings: { loaded: Promise.resolve(profile.settings) },
    };
    const indexedKey = request.snapshot.item.indexedKey;
    const sample = request.snapshot.provenance.kind === "sample";
    const loadRoot = (root: "note" | "filename") =>
      sample
        ? Promise.resolve({
            kind: "data" as const,
            data: restoreTemplateData(
              request.snapshot.roots[root],
              request.snapshot.descriptors[root],
            ),
          })
        : loadTemplateData(dataDeps, indexedKey, root);
    const [note, filename] = await Promise.all([
      loadRoot("note"),
      loadRoot("filename"),
    ]);
    if (note.kind !== "data" || filename.kind !== "data")
      throw new Error("The selected Zotero item is unavailable.");
    const context = note.data as NoteTemplateContext;
    const composeDeps = { template: deps.templates };
    const diagnostics: RenderDiagnostic[] = [];
    const onConflict: FrontmatterMergeConflictHandler = (key, detail) =>
      diagnostics.push({
        code: "property-append-conflict",
        part: "properties",
        position: detail.position,
        params: { key },
      });
    // Update mode keeps the real note's own Properties, so it stops at the
    // preparation and the body; only create mode composes a Properties block.
    const composed =
      request.mode === "update"
        ? prepareLiteratureNote(composeDeps, { context, document })
        : composeLiteratureNote(composeDeps, {
            context,
            itemKey: indexedKey,
            profile,
            document,
            onConflict,
          });
    // A write refuses on a failing field; the preview keeps going and shows
    // the field with its position, reading the view the refusal carries.
    const { prepared } = composed;
    const properties: ProfileRenderResult["properties"][number][] = [];
    if (prepared.kind === "document")
      for (const field of prepared.fields) {
        const missing =
          field.value === undefined || field.value === FRONTMATTER_ABSENT;
        properties.push({
          key: field.key,
          position: field.position!,
          missing,
          ...(missing ? {} : { value: field.value }),
        });
      }
    if (composed.outcome === "refused")
      for (const error of composed.evaluation.errors)
        diagnostics.push({
          code: "property-error",
          part: "properties",
          position: error.position,
          params: { key: error.key },
          message: errorText(error.error),
        });
    manifest.frontmatter?.forEach((entry, index) => {
      if ("js" in entry && !deps.templates.javascriptTemplatesEnabled)
        diagnostics.push({
          code: "render-error",
          message: m.profile_preview_javascript_disabled(),
          part: "properties",
          position: index + 1,
        });
    });
    // Both the composition and the preparation carry the body they rendered,
    // so only a refusal — which rendered none — renders one here.
    const created =
      composed.outcome === "refused"
        ? document.renderForCreate(context)
        : composed.body;
    const managed = document.renderForUpdate(context);
    const existing = sample
      ? null
      : findExistingLitNote(deps.noteIndex, { indexedKey });
    sourcePath = existing?.path ?? "";
    const file = sourcePath ? deps.app.vault.getFileByPath(sourcePath) : null;
    const original =
      request.mode === "update" && file
        ? await deps.app.vault.read(file)
        : null;
    let frontmatter: Record<string, unknown>;
    let body: string;
    let frontmatterBlock: string;
    if (composed.outcome === "composed") {
      ({ frontmatter, body, frontmatterBlock } = composed);
    } else {
      // Update refreshes the real note's own Properties through the stamping
      // step and refills its Managed Region, entirely in memory.
      ({ frontmatter, body } = previewBaseline(
        original,
        created,
        request.mode === "update" ? managed : null,
      ));
      applyComposedFrontmatter(composeDeps, frontmatter, {
        context,
        itemKey: indexedKey,
        profile,
        prepared,
        onConflict,
      });
      frontmatterBlock = stringifyYaml(frontmatter);
    }
    let annotation: string | null = null;
    let annotationCitation: string | null = null;
    if (request.annotation) {
      try {
        const key = request.annotation.root.indexedKey;
        const live =
          typeof key === "string" &&
          !sample &&
          !SAMPLE_ANNOTATIONS.some(({ id }) => id === request.annotation!.id)
            ? await loadTemplateData(dataDeps, key, "annotation")
            : null;
        const restored = restoreTemplateData(
          request.annotation.root,
          request.annotation.descriptors,
        ) as unknown as AnnotationTemplateContext;
        const root =
          live?.kind === "data"
            ? live.data
            : withAnnotationCitation(restored, () =>
                renderAnnotationCitation(
                  restored.parentItem,
                  restored.pageLabel,
                  deps.templates,
                ),
              );
        annotation = document.renderAnnotation(root);
        annotationCitation =
          "citation" in root && typeof root.citation === "string"
            ? root.citation
            : null;
      } catch (error) {
        diagnostics.push({
          code: "render-error",
          part: "annotation",
          message: errorText(error),
        });
      }
    }
    const annotationRanges: { from: number; to: number }[] = [];
    let cursor = 0;
    for (const root of context.annotations) {
      let output: string;
      try {
        output = document.renderAnnotation(root);
      } catch {
        continue;
      }
      if (!output) continue;
      const from = body.indexOf(output, cursor);
      if (from >= 0) {
        cursor = from + output.length;
        annotationRanges.push({ from, to: cursor });
      }
    }
    const declaredLanguage = frontmatter[FIELD_DOCUMENT_LANGUAGE];
    const locale =
      typeof declaredLanguage === "string" ? declaredLanguage.trim() : "";
    const invalidLanguage =
      declaredLanguage !== undefined && !isLanguageTag(locale);
    if (invalidLanguage)
      diagnostics.push({
        code: "citation-style-error",
        part: "render",
        message: m.references_document_language_failed_title(),
      });
    const presentation = {
      sourcePath,
      locale:
        declaredLanguage === undefined
          ? deps.bibliographyRender.vaultPresentation.locale
          : locale,
      styleId: profile.bindings["citation.references-style"],
      wikilinks: settings["citation.wikilink-citations"],
    };
    const noteCitations =
      invalidLanguage || sample
        ? { citations: [], diagnostics: [] }
        : await renderDraftCitations(deps, { ...presentation, markdown: body });
    const annotationCitations =
      invalidLanguage ||
      sample ||
      SAMPLE_ANNOTATIONS.some(({ id }) => id === request.annotation?.id)
        ? { citations: [], diagnostics: [] }
        : await renderDraftCitations(deps, {
            ...presentation,
            markdown: annotation ?? "",
          });
    diagnostics.push(
      ...noteCitations.diagnostics,
      ...annotationCitations.diagnostics,
    );
    return {
      ...identity,
      sourcePath,
      citations: noteCitations.citations,
      annotationCitations: annotationCitations.citations,
      filename: replaceSuffixMarkers(
        document.renderFilename(filename.data),
        () => "",
      ),
      properties,
      fold: Object.entries(frontmatter).map(([key, value]) => ({
        key,
        value,
        missing: false,
        position: properties.find((entry) => entry.key === key)?.position ?? 0,
      })),
      frontmatterBlock,
      creationBody: body,
      managedRegion: managed,
      annotation,
      annotationCitation,
      annotationRanges,
      diagnostics,
    };
  } catch (error) {
    return {
      ...failedRender(identity, {
        code: "render-error",
        message: errorText(error),
        part: "render",
      }),
      sourcePath,
      citations: [],
      annotationCitations: [],
    };
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
