// Read-only rendering of a draft Profile against the installed template pipeline.
import { parseYaml, stringifyYaml, getFrontMatterInfo } from "obsidian";

import { withAnnotationCitation } from "@zotlit/db";
import type {
  AnnotationTemplateContext,
  CitationTemplateData,
  NoteTemplateContext,
} from "@zotlit/db";
import { replaceSuffixMarkers } from "@zotlit/templates";
import { MissingTemplateError } from "@zotlit/templates/facade";
import { FRONTMATTER_ABSENT } from "@zotlit/templates/frontmatter-merge";
import type { FrontmatterMergeConflictHandler } from "@zotlit/templates/frontmatter-merge";
import { replaceManagedRegion } from "@zotlit/templates/obsidian";
import { restoreTemplateData } from "@zotlit/workbench/render";
import {
  citationExampleData,
  emptyRender,
  failedRender,
  renderIdentity,
  sampleItemCitation,
  SAMPLE_ANNOTATIONS,
} from "@zotlit/workbench/render";
import type {
  PartialContext,
  PartialPreviewSelection,
  TemplateRenderResult,
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
import type { ProfileService } from "@/services/profile/service";
import {
  loadCitationData,
  loadTemplateData,
} from "@/services/template-workbench/data";
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
    | "renderCitation"
    | "renderCitationSource"
    | "renderPartialSource"
    | "prepareLiteratureNoteTemplateSource"
    | "frontmatterFields"
    | "javascriptTemplatesEnabled"
    | "on"
  >;
  /** Reads the Profile a Shared Partial preview renders its bindings under. */
  profile: Pick<ProfileService, "resolveProfile">;
}
export interface NativeRenderResult extends TemplateRenderResult {
  readonly sourcePath: string;
  readonly citations: readonly PreviewCitation[];
  readonly annotationCitations: readonly PreviewCitation[];
}

/** A result composed outside this renderer, in the shape the preview reads. */
export function nativeResult(result: TemplateRenderResult): NativeRenderResult {
  return { sourcePath: "", citations: [], annotationCitations: [], ...result };
}

/**
 * Render whichever Template Document the request names: a Shared Partial when
 * the request carries a partial selection, a Citation Template when it carries
 * a Citation selection, a Profile otherwise. One entry, so a preview that
 * follows the active editor across document kinds keeps the one render
 * function it was built with.
 */
export function renderNativeTemplate(
  deps: NativeRenderDeps,
  request: RenderRequest,
): Promise<NativeRenderResult> {
  if (request.partial)
    return renderNativePartial(deps, request, request.partial);
  return request.citation
    ? renderNativeCitation(deps, request)
    : renderNativeProfile(deps, request);
}

/**
 * The text the draft Shared Partial produces for the caller the reader chose
 * to see it as called from: the note root of the selected Item, the Annotation
 * root of the selected annotation, or the selected Citation set. The data is
 * built under the chosen Profile's bindings, so folder, citation style, and the
 * import settings a partial reads are a real Profile's.
 */
async function renderNativePartial(
  deps: NativeRenderDeps,
  request: RenderRequest,
  selection: PartialPreviewSelection,
): Promise<NativeRenderResult> {
  const identity = renderIdentity(request);
  try {
    const data = await partialRootData(deps, request, selection);
    if (data.kind !== "data") {
      return nativeResult(
        failedRender(identity, {
          code: "render-error",
          message: data.message,
          part: "render",
        }),
      );
    }
    return {
      ...nativeResult(emptyRender(identity)),
      partial: deps.templates.renderPartialSource(request.source, data.data, {
        name: selection.name,
      }),
    };
  } catch (error) {
    return nativeResult(failedRender(identity, renderFault(error, "render")));
  }
}

/**
 * The text the Shared Partial `selection` names produces for the caller it
 * names, rendered from the document the vault registered rather than from the
 * draft in the editor. This is what one Partial Placeholder's preview shows,
 * so the reader sees the partial their call actually renders.
 *
 * @throws whatever the render raises, a {@link MissingTemplateError} for a
 *   partial the vault holds no document for included.
 */
export async function renderRegisteredPartial(
  deps: NativeRenderDeps,
  request: RenderRequest,
  selection: PartialPreviewSelection,
): Promise<string> {
  const data = await partialRootData(deps, request, selection);
  if (data.kind !== "data") throw new Error(data.message);
  return deps.templates.render(selection.name, data.data);
}

/**
 * The root data one Shared Partial preview reads, built under the bindings of
 * the Profile the reader chose, so folder, citation style, and the import
 * settings a partial reads are a real Profile's.
 */
async function partialRootData(
  deps: NativeRenderDeps,
  request: RenderRequest,
  selection: PartialPreviewSelection,
): Promise<
  { kind: "data"; data: object } | { kind: "unavailable"; message: string }
> {
  await deps.templates.ready;
  const settings = await deps.settings.loaded;
  const profile =
    (selection.profile === null
      ? undefined
      : deps.profile.resolveProfile(selection.profile as ProfileId)) ??
    bindProfile(settings, { selector: DEFAULT_PROFILE });
  return partialContextData(
    { ...deps, settings: { loaded: Promise.resolve(profile.settings) } },
    request,
    selection.context,
  );
}

/**
 * The root data one Shared Partial reads under `context`: the Citation set the
 * preview holds, the Annotation root of the selected annotation, or the note
 * root of the selected Item. A Sample Item answers from its own snapshot; a
 * real one is loaded exactly as a Profile preview loads it.
 */
async function partialContextData(
  deps: NativeRenderDeps,
  request: RenderRequest,
  context: PartialContext,
): Promise<
  { kind: "data"; data: object } | { kind: "unavailable"; message: string }
> {
  const sample = request.snapshot.provenance.kind === "sample";
  if (context === "citation") return citationRootData(deps, request);
  if (context === "annotation") {
    const example = request.annotation;
    if (!example) {
      return {
        kind: "unavailable",
        message: m.workbench_preview_choose_annotation(),
      };
    }
    const key = example.root.indexedKey;
    const live =
      typeof key === "string" &&
      !sample &&
      !SAMPLE_ANNOTATIONS.some(({ id }) => id === example.id)
        ? await loadTemplateData(deps, key, "annotation")
        : null;
    if (live?.kind === "data") return { kind: "data", data: live.data };
    const restored = restoreTemplateData(
      example.root,
      example.descriptors,
    ) as unknown as AnnotationTemplateContext;
    return {
      kind: "data",
      data: withAnnotationCitation(restored, () =>
        renderAnnotationCitation(
          restored.parentItem,
          restored.pageLabel,
          deps.templates,
        ),
      ),
    };
  }
  if (sample) {
    return {
      kind: "data",
      data: restoreTemplateData(
        request.snapshot.roots.note,
        request.snapshot.descriptors.note,
      ),
    };
  }
  const note = await loadTemplateData(
    deps,
    request.snapshot.item.indexedKey,
    "note",
  );
  return note.kind === "data"
    ? { kind: "data", data: note.data }
    : { kind: "unavailable", message: m.workbench_example_missing_item() };
}

/**
 * The in-text Citation the draft Citation Template produces for the selected
 * example set — or for the chosen Item's own one-item set — under the selected
 * Citation Variant. Nothing else of a note is rendered here: a Citation
 * Template answers one gesture with one line.
 */
async function renderNativeCitation(
  deps: NativeRenderDeps,
  request: RenderRequest,
): Promise<NativeRenderResult> {
  const identity = renderIdentity(request);
  try {
    await deps.templates.ready;
    const data = await citationRootData(deps, request);
    if (data.kind !== "data") throw new Error(data.message);
    return {
      ...nativeResult(emptyRender(identity)),
      citation: deps.templates.renderCitationSource(request.source, data.data),
    };
  } catch (error) {
    return nativeResult(failedRender(identity, renderFault(error, "render")));
  }
}

/**
 * The `citation` root this preview renders against: the selected example set
 * when the reader picked one, a Sample Item's own snapshot, and a real Item
 * read from the live database — which is the same read the Data Explorer's
 * citation root makes, so the two panes show one Item's one Citation.
 */
async function citationRootData(
  deps: NativeRenderDeps,
  request: RenderRequest,
): Promise<
  | { kind: "data"; data: CitationTemplateData }
  | { kind: "unavailable"; message: string }
> {
  const selection = request.citation;
  const variant = selection?.variant ?? "main";
  if (selection?.example)
    return {
      kind: "data",
      data: citationExampleData(selection.example, variant),
    };
  if (request.snapshot.provenance.kind === "sample")
    return {
      kind: "data",
      data: sampleItemCitation(request.snapshot, variant),
    };
  const loaded = await loadCitationData(
    deps,
    { key: request.snapshot.item.indexedKey },
    variant,
  );
  return loaded.kind === "data"
    ? { kind: "data", data: loaded.data }
    : { kind: "unavailable", message: m.workbench_example_missing_item() };
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
    const properties: TemplateRenderResult["properties"][number][] = [];
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
        diagnostics.push(renderFault(error, "annotation"));
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
      citation: null,
      partial: null,
      annotationRanges,
      diagnostics,
    };
  } catch (error) {
    return {
      ...failedRender(identity, renderFault(error, "render")),
      sourcePath,
      citations: [],
      annotationCitations: [],
    };
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The diagnostic one render failure reads as. A call to a Shared Partial the
 * vault holds no document for is the engine's own missing-partial report,
 * which the Partial Placeholder, the Problems strip, and a refused Literature
 * Note all read by code; every other failure carries the engine's own words.
 * @see docs/adr/0050-citation-template-and-shared-partials-are-template-documents.md
 */
function renderFault(
  error: unknown,
  part: RenderDiagnostic["part"],
): RenderDiagnostic {
  return error instanceof MissingTemplateError
    ? { code: "missing-partial", params: { name: error.templateName }, part }
    : { code: "render-error", message: errorText(error), part };
}
