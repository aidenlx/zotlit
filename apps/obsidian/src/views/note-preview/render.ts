// Read-only rendering of a draft Profile against the installed template pipeline.
import { parseYaml, stringifyYaml, getFrontMatterInfo } from "obsidian";

import { withAnnotationCitation } from "@zotlit/db";
import type { AnnotationTemplateContext } from "@zotlit/db";
import { replaceSuffixMarkers } from "@zotlit/templates";
import { evalManagedFrontmatterEntries } from "@zotlit/templates/frontmatter";
import { FRONTMATTER_ABSENT } from "@zotlit/templates/frontmatter-merge";
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
import {
  FIELD_CITATION_STYLE,
  FIELD_DOCUMENT_LANGUAGE,
  FIELD_LITERATURE_NOTE_PROFILE,
  FIELD_ZOTERO_KEY,
} from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import { isLanguageTag } from "@/lib/language-tag";
import { formatProfileStamp } from "@/lib/profile-stamp";
import type { DatabaseService } from "@/services/database/service";
import {
  applyDocumentManagedFrontmatter,
  applyManagedFrontmatter,
} from "@/services/note-feature/frontmatter";
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
    const defaults = settings["note.default-profile"].bindings;
    const manifestBindings = document.manifest;
    const bindings = {
      "note.literature-folder":
        manifestBindings.folder ?? defaults["note.literature-folder"],
      "citation.references-style":
        manifestBindings.citationStyle === undefined
          ? defaults["citation.references-style"]
          : manifestBindings.citationStyle,
      "note.import-folder":
        manifestBindings.importFolder ?? defaults["note.import-folder"],
      "note.import-colored-highlights":
        manifestBindings.importColoredHighlights ??
        defaults["note.import-colored-highlights"],
      "note.import-annotations-as-template":
        manifestBindings.importAnnotationsAsTemplate ??
        defaults["note.import-annotations-as-template"],
    };
    const dataDeps = {
      ...deps,
      settings: { loaded: Promise.resolve({ ...settings, ...bindings }) },
    };
    const indexedKey = request.snapshot.item.indexedKey;
    const [note, filename] = await Promise.all([
      loadTemplateData(dataDeps, indexedKey, "note"),
      loadTemplateData(dataDeps, indexedKey, "filename"),
    ]);
    if (note.kind !== "data" || filename.kind !== "data")
      throw new Error("The selected Zotero item is unavailable.");
    const context = note.data as Parameters<
      typeof applyDocumentManagedFrontmatter
    >[1];
    const diagnostics: RenderDiagnostic[] = [];
    const created = document.renderForCreate(context);
    const managed = document.renderForUpdate(context);
    const existing = findExistingLitNote(deps.noteIndex, { indexedKey });
    sourcePath = existing?.path ?? "";
    const file = sourcePath ? deps.app.vault.getFileByPath(sourcePath) : null;
    const original =
      request.mode === "update" && file
        ? await deps.app.vault.read(file)
        : null;
    const { body, frontmatter } = previewBaseline(
      original,
      created,
      request.mode === "update" ? managed : null,
    );
    const properties: ProfileRenderResult["properties"][number][] = [];
    if (document.frontmatter) {
      const evaluation = evalManagedFrontmatterEntries(
        document.frontmatter.compiled,
        context,
        Temporal.Now.instant(),
      );
      for (const field of evaluation.values) {
        const missing =
          field.value === undefined || field.value === FRONTMATTER_ABSENT;
        properties.push({
          key: field.key,
          position: field.position!,
          missing,
          ...(missing ? {} : { value: field.value }),
        });
      }
      for (const error of evaluation.errors)
        diagnostics.push({
          code: "property-error",
          part: "properties",
          position: error.position,
          params: { key: error.key },
          message: errorText(error.error),
        });
      document.manifest.frontmatter?.forEach((entry, index) => {
        if ("js" in entry && !deps.templates.javascriptTemplatesEnabled)
          diagnostics.push({
            code: "render-error",
            message: m.profile_preview_javascript_disabled(),
            part: "properties",
            position: index + 1,
          });
      });
      applyDocumentManagedFrontmatter(frontmatter, context, {
        prepared: {
          kind: "document",
          fields: evaluation.values,
          keys: evaluation.keys,
        },
        onConflict: (key, detail) =>
          diagnostics.push({
            code: "property-append-conflict",
            part: "properties",
            position: detail.position,
            params: { key },
          }),
      });
    } else
      applyManagedFrontmatter(frontmatter, context, {
        compiled: deps.templates.frontmatterFields,
      });
    frontmatter[FIELD_ZOTERO_KEY] = indexedKey;
    const manifest = document.manifest;
    if (manifest.id === "default")
      delete frontmatter[FIELD_LITERATURE_NOTE_PROFILE];
    else
      frontmatter[FIELD_LITERATURE_NOTE_PROFILE] = formatProfileStamp({
        id: manifest.id,
        label: manifest.name ?? "",
      });
    const style = manifest.citationStyle;
    if (style == null) delete frontmatter[FIELD_CITATION_STYLE];
    else frontmatter[FIELD_CITATION_STYLE] = style;
    let annotation: string | null = null;
    let annotationCitation: string | null = null;
    if (request.annotation) {
      try {
        const key = request.annotation.root.indexedKey;
        const live =
          typeof key === "string" &&
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
      styleId: bindings["citation.references-style"],
      wikilinks: settings["citation.wikilink-citations"],
    };
    const noteCitations = invalidLanguage
      ? { citations: [], diagnostics: [] }
      : await renderDraftCitations(deps, { ...presentation, markdown: body });
    const annotationCitations = invalidLanguage
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
      frontmatterBlock: stringifyYaml(frontmatter),
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
