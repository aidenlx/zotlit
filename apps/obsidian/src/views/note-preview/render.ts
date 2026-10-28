// Read-only rendering of a draft Profile against the installed template pipeline.
import { Cause, DateTime, Effect, Exit } from "effect";
import { stringifyYaml } from "obsidian";
import type { App } from "obsidian";

import { DEFAULT_CITATION_VARIANT, withAnnotationCitation } from "@zotlit/db";
import type {
  AnnotationTemplateContext,
  CitationTemplateData,
  NoteTemplateContext,
} from "@zotlit/db";
import type { ContractRoot } from "@zotlit/db";
import { replaceSuffixMarkers, resolveNoteRelPath } from "@zotlit/templates";
import type { LiteratureNoteTemplateManifest } from "@zotlit/templates/facade";
import { parsePlainTemplateDocument } from "@zotlit/templates/facade";
import type { FrontmatterMergeConflictHandler } from "@zotlit/templates/frontmatter-merge";
import { restoreTemplateData } from "@zotlit/workbench/render";
import {
  citationExampleData,
  emptyRender,
  engineEvidence,
  failedRender,
  filenameErrorDiagnostic,
  propertyErrorDiagnostic,
  renderFailureDiagnostic,
  renderIdentity,
  retainOutputs,
  sampleItemCitation,
  SAMPLE_ANNOTATIONS,
} from "@zotlit/workbench/render";
import type {
  PartialContext,
  PartialPreviewSelection,
  RenderCallerSource,
  TemplateRenderResult,
  RenderRequest,
  RenderDiagnostic,
} from "@zotlit/workbench/render";

import { annotationCitation as renderAnnotationCitation } from "@/lib/annotation-render";
import { FIELD_DOCUMENT_LANGUAGE } from "@/lib/constants";
import { toInstant } from "@/lib/effect-clock";
import * as m from "@/lib/i18n/generated/messages";
import { isLanguageTag } from "@/lib/language-tag";
import { readLiveText } from "@/lib/live-text";
import { Vault } from "@/lib/obsidian-vault";
import { DEFAULT_PROFILE } from "@/lib/profile-stamp";
import type { ProfileId } from "@/lib/profile-stamp";
import type { ViewRegistryHandle, ViewServices } from "@/lib/view-atoms";
import {
  applyComposedFrontmatter,
  composeLiteratureNote,
  prepareLiteratureNote,
} from "@/services/note-feature";
import { NoteIndex } from "@/services/note-index/service";
import { BibliographyRender } from "@/services/pandoc/render-cache";
import { bindProfile } from "@/services/profile/bindings";
import { bindUnvalidatedDraftProfile } from "@/services/profile/service";
import { Profile } from "@/services/profile/service";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import {
  readTemplateData,
  readCitationData,
  withSettings,
} from "@/services/template-workbench/data";
import {
  syncTemplate,
  profileCall,
} from "@/services/template-workbench/sync-template";
import { plainTemplateError } from "@/services/template/errors";
import { Template } from "@/services/template/service";
import type { TemplateOperations } from "@/services/template/service";

import { previewBaseline } from "./baseline";
export { previewBaseline } from "./baseline";
import { nativePropertyRows } from "./check-profile";
import { renderDraftCitations } from "./citations";
import type { PreviewCitation } from "./citations";

export interface NativeRenderDeps {
  readonly app: App;
  readonly registry: ViewRegistryHandle;
}

interface RenderEnvironment {
  app: App;
  settings: Readonly<Settings>;
  templates: Pick<
    TemplateOperations,
    | "render"
    | "renderCitation"
    | "renderCitationSource"
    | "renderPartialSource"
    | "prepareLiteratureNoteTemplateSource"
    | "frontmatterFields"
    | "javascriptTemplatesEnabled"
  >;
  dataSettings?: Readonly<Settings>;
}

// Compiled documents and lazy data getters call synchronously on the command context.
const renderEnvironment = Effect.gen(function* () {
  const template = yield* Template;
  const run = Effect.runSyncWith(yield* Effect.context<never>());
  const read = <A, E>(effect: Effect.Effect<A, E>): A => {
    const exit = run(Effect.exit(effect));
    if (Exit.isFailure(exit))
      throw plainTemplateError(Cause.squash(exit.cause));
    return exit.value;
  };
  const templates: RenderEnvironment["templates"] = {
    ...(yield* syncTemplate),
    renderCitationSource: (source, data) =>
      read(template.renderCitationSource(source, data)),
    renderPartialSource: (source, data, options) =>
      read(template.renderPartialSource(source, data, options)),
    prepareLiteratureNoteTemplateSource: (source) =>
      read(template.prepareLiteratureNoteTemplateSource(source)),
    javascriptTemplatesEnabled: yield* template.javascriptTemplatesEnabled,
  };
  return { settings: yield* (yield* PluginSettings).current, templates };
});

const loadTemplateData = (
  deps: RenderEnvironment,
  key: string,
  root: ContractRoot,
) =>
  deps.dataSettings
    ? readTemplateData(key, root).pipe(withSettings(deps.dataSettings))
    : readTemplateData(key, root);

export interface NativeRenderResult extends TemplateRenderResult {
  readonly sourcePath: string;
  /** A retained Annotation can come from a different note path than the body. */
  readonly annotationSourcePath?: string;
  readonly citations: readonly PreviewCitation[];
  readonly annotationCitations: readonly PreviewCitation[];
}

/** Retain each preview's paths and citation spans with its rendered output. */
export function retainNativeOutputs(
  kept: NativeRenderResult,
  result: NativeRenderResult,
): NativeRenderResult {
  const retained = retainOutputs(kept, result);
  if (retained === result) return result;
  const note =
    result.creationBody === null && kept.creationBody !== null ? kept : result;
  const annotation =
    result.annotation === null && kept.annotation !== null ? kept : result;
  return {
    ...retained,
    sourcePath: note.sourcePath,
    citations: note.citations,
    annotationSourcePath:
      annotation.annotationSourcePath ?? annotation.sourcePath,
    annotationCitations: annotation.annotationCitations,
  };
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
const renderNativeTemplateEffect = Effect.fn("NotePreview.render")(function* (
  deps: NativeRenderDeps,
  request: RenderRequest,
) {
  const environment: RenderEnvironment = {
    app: deps.app,
    ...(yield* renderEnvironment),
  };
  if (request.partial)
    return yield* renderNativePartial(environment, request, request.partial);
  return yield* request.citation
    ? renderNativeCitation(environment, request)
    : renderNativeProfileEffect(environment, request);
});

/**
 * The native render and the registered-partial render over `deps`, as
 * Effects for a view's runner to fork: interrupting a fiber stops its render.
 */
export function makeNativeRenderer(deps: NativeRenderDeps) {
  return {
    render: (
      request: RenderRequest,
    ): Effect.Effect<NativeRenderResult, unknown, ViewServices> =>
      renderNativeTemplateEffect(deps, request),
    partial: (
      request: RenderRequest,
      partial: PartialPreviewSelection,
    ): Effect.Effect<string, unknown, ViewServices> =>
      Effect.gen(function* () {
        const environment: RenderEnvironment = {
          app: deps.app,
          ...(yield* renderEnvironment),
        };
        return yield* renderRegisteredPartialEffect(
          environment,
          request,
          partial,
        );
      }),
  };
}

/**
 * The text the draft Shared Partial produces for the caller the reader chose
 * to see it as called from: the note root of the selected Item, the Annotation
 * root of the selected annotation, or the selected Citation set. The data is
 * built under the chosen Profile's bindings, so folder, citation style, and the
 * import settings a partial reads are a real Profile's.
 */
const renderNativePartial = Effect.fn("NotePreview.renderNativePartial")(
  function* (
    deps: RenderEnvironment,
    request: RenderRequest,
    selection: PartialPreviewSelection,
  ): Effect.fn.Return<NativeRenderResult, unknown, ViewServices> {
    const identity = renderIdentity(request);
    return yield* Effect.gen(function* (): Effect.fn.Return<
      NativeRenderResult,
      unknown,
      ViewServices
    > {
      const data = yield* partialRootData(deps, request, selection);
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
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          const error = Cause.squash(cause);
          return nativeResult(
            failedRender(
              identity,
              renderFault(error, "render", callerSource(deps, request.source)),
            ),
          );
        }),
      ),
    );
  },
);

/**
 * The text the Shared Partial `selection` names produces for the caller it
 * names, rendered from the document the vault registered rather than from the
 * draft in the editor. This is what one Partial Placeholder's preview shows,
 * so the reader sees the partial their call actually renders.
 *
 * @throws whatever the render raises, a `MissingTemplateError` for a partial
 *   the vault holds no document for included.
 */
const renderRegisteredPartialEffect = Effect.fn(
  "NotePreview.renderRegisteredPartial",
)(function* (
  deps: RenderEnvironment,
  request: RenderRequest,
  selection: PartialPreviewSelection,
): Effect.fn.Return<string, unknown, ViewServices> {
  const data = yield* partialRootData(deps, request, selection);
  if (data.kind !== "data") throw new Error(data.message);
  return deps.templates.render(selection.name, data.data);
});

/**
 * The root data one Shared Partial preview reads, built under the bindings of
 * the Profile the call renders under, so folder, citation style, and the
 * import settings a partial reads are a real Profile's.
 */
const partialRootData = Effect.fn("NotePreview.partialRootData")(function* (
  deps: RenderEnvironment,
  request: RenderRequest,
  selection: PartialPreviewSelection,
): Effect.fn.Return<
  { kind: "data"; data: object } | { kind: "unavailable"; message: string },
  unknown,
  ViewServices
> {
  const settings = deps.settings;
  const chosen =
    selection.profile === null
      ? undefined
      : yield* profileCall(
          (yield* Profile).resolveProfile(selection.profile as ProfileId),
        );
  // A partial's own pane names the Profile the reader chose. A Partial
  // Placeholder inside a Profile document names none, and binds that
  // document's own draft instead — the box reads the data of the slice it
  // sits in, which is what the preview around it reads.
  const draft = chosen ? null : draftProfileManifest(deps, request.source);
  const profile =
    chosen ??
    (draft
      ? bindUnvalidatedDraftProfile(settings, draft)
      : bindProfile(settings, { selector: DEFAULT_PROFILE }));
  return yield* partialContextData(
    { ...deps, dataSettings: profile.settings },
    request,
    selection.context,
  );
});

/**
 * The manifest of `source` when it is a Profile document naming its own
 * Profile; null for every other Template Document, whose source names none.
 */
function draftProfileManifest(
  deps: RenderEnvironment,
  source: string,
): LiteratureNoteTemplateManifest | null {
  try {
    const { manifest } =
      deps.templates.prepareLiteratureNoteTemplateSource(source);
    return manifest.id ? manifest : null;
  } catch {
    return null;
  }
}

/**
 * The root data one Shared Partial reads under `context`: the Citation set the
 * preview holds, the Annotation root of the selected annotation, or the note
 * root of the selected Item. A Sample Item answers from its own snapshot; a
 * real one is loaded exactly as a Profile preview loads it.
 */
const partialContextData = Effect.fn("NotePreview.partialContextData")(
  function* (
    deps: RenderEnvironment,
    request: RenderRequest,
    context: PartialContext,
  ): Effect.fn.Return<
    { kind: "data"; data: object } | { kind: "unavailable"; message: string },
    unknown,
    ViewServices
  > {
    const sample = request.snapshot.provenance.kind === "sample";
    if (context === "citation") return yield* citationRootData(deps, request);
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
          ? yield* loadTemplateData(deps, key, "annotation")
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
    const note = yield* loadTemplateData(
      deps,
      request.snapshot.item.indexedKey,
      "note",
    );
    return note.kind === "data"
      ? { kind: "data", data: note.data }
      : { kind: "unavailable", message: m.workbench_example_missing_item() };
  },
);

/**
 * The in-text Citation the draft Citation Template produces for the selected
 * example set — or for the chosen Item's own one-item set — under the selected
 * Citation Variant. Nothing else of a note is rendered here: a Citation
 * Template answers one gesture with one line.
 */
const renderNativeCitation = Effect.fn("NotePreview.renderNativeCitation")(
  function* (
    deps: RenderEnvironment,
    request: RenderRequest,
  ): Effect.fn.Return<NativeRenderResult, unknown, ViewServices> {
    const identity = renderIdentity(request);
    return yield* Effect.gen(function* (): Effect.fn.Return<
      NativeRenderResult,
      unknown,
      ViewServices
    > {
      const data = yield* citationRootData(deps, request);
      if (data.kind !== "data") throw new Error(data.message);
      return {
        ...nativeResult(emptyRender(identity)),
        citation: deps.templates.renderCitationSource(
          request.source,
          data.data,
        ),
      };
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          const error = Cause.squash(cause);
          return nativeResult(
            failedRender(
              identity,
              renderFault(error, "render", callerSource(deps, request.source)),
            ),
          );
        }),
      ),
    );
  },
);

/**
 * The `citation` root this preview renders against: the selected example set
 * when the reader picked one, a Sample Item's own snapshot, and a real Item
 * read from the live database — which is the same read the Data Explorer's
 * citation root makes, so the two panes show one Item's one Citation.
 */
const citationRootData = Effect.fn("NotePreview.citationRootData")(function* (
  deps: RenderEnvironment,
  request: RenderRequest,
): Effect.fn.Return<
  | { kind: "data"; data: CitationTemplateData }
  | { kind: "unavailable"; message: string },
  unknown,
  ViewServices
> {
  const selection = request.citation;
  const variant = selection?.variant ?? DEFAULT_CITATION_VARIANT;
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
  const loaded = yield* readCitationData(
    { key: request.snapshot.item.indexedKey },
    variant,
  );
  return loaded.kind === "data"
    ? { kind: "data", data: loaded.data }
    : { kind: "unavailable", message: m.workbench_example_missing_item() };
});

const renderNativeProfileEffect = Effect.fn("NotePreview.renderNativeProfile")(
  function* (
    deps: RenderEnvironment,
    request: RenderRequest,
  ): Effect.fn.Return<NativeRenderResult, unknown, ViewServices> {
    const identity = renderIdentity(request);
    let sourcePath = "";
    // The note name is produced apart from everything else, so a mistake in the
    // Filename Template leaves the rest of this preview on screen and a mistake
    // anywhere else leaves the name this attempt produced.
    let noteName: string | null = null;
    let noteNameFailure: RenderDiagnostic | null = null;
    return yield* Effect.gen(function* (): Effect.fn.Return<
      NativeRenderResult,
      unknown,
      ViewServices
    > {
      const document = deps.templates.prepareLiteratureNoteTemplateSource(
        request.source,
      );
      const settings = deps.settings;
      const manifest = document.manifest;
      const profile = bindUnvalidatedDraftProfile(settings, manifest);
      const dataDeps = { ...deps, dataSettings: profile.settings };
      const indexedKey = request.snapshot.item.indexedKey;
      const sample = request.snapshot.provenance.kind === "sample";
      const loadRoot = (root: "note" | "filename") =>
        sample
          ? Effect.succeed({
              kind: "data" as const,
              data: restoreTemplateData(
                request.snapshot.roots[root],
                request.snapshot.descriptors[root],
              ),
            })
          : loadTemplateData(dataDeps, indexedKey, root);
      const [note, filename] = yield* Effect.all(
        [loadRoot("note"), loadRoot("filename")],
        { concurrency: "unbounded" },
      );
      if (note.kind !== "data" || filename.kind !== "data")
        throw new Error("The selected Zotero item is unavailable.");
      const context = note.data as NoteTemplateContext;
      const composeDeps = { template: deps.templates };
      const diagnostics: RenderDiagnostic[] = [];
      // A preview assumes a free filename; the vault resolves collisions on save.
      const filenameResult = yield* Effect.exit(
        Effect.sync(() =>
          replaceSuffixMarkers(
            document.renderFilename(filename.data),
            () => "",
          ),
        ),
      );
      if (Exit.isSuccess(filenameResult)) noteName = filenameResult.value;
      else {
        noteNameFailure = filenameErrorDiagnostic(
          Cause.squash(filenameResult.cause),
          callerSource(deps, request.source),
        );
        diagnostics.push(noteNameFailure);
      }
      const onConflict: FrontmatterMergeConflictHandler = (key, detail) =>
        diagnostics.push({
          code: "property-append-conflict",
          part: "properties",
          position: detail.position,
          params: { key },
        });
      // Update mode keeps the real note's own Properties, so it stops at the
      // preparation and the body; only create mode composes a Properties block.
      // The preview reads the plugin runtime's clock, as a write does.
      const now = toInstant(yield* DateTime.now);
      const composed =
        request.mode === "update"
          ? prepareLiteratureNote(composeDeps, { context, document, now })
          : composeLiteratureNote(composeDeps, {
              context,
              itemKey: indexedKey,
              profile,
              document,
              onConflict,
              now,
            });
      // A write refuses on a failing field; the preview keeps going and shows
      // the field with its position, reading the view the refusal carries.
      const { prepared } = composed;
      const properties: TemplateRenderResult["properties"][number][] = [];
      if (prepared.kind === "document")
        properties.push(...nativePropertyRows(prepared.fields));
      if (composed.outcome === "refused")
        for (const error of composed.evaluation.errors)
          // The same answer the web renderer reads, so a row underlines the text
          // that failed and reads the engine's own words in either host.
          diagnostics.push(
            propertyErrorDiagnostic(
              error,
              manifest.frontmatter?.[error.position - 1],
            ),
          );
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
        : ((yield* (yield* NoteIndex).getNotesByItemKey(indexedKey))[0] ??
          null);
      sourcePath = existing?.path ?? "";
      const file = sourcePath
        ? yield* (yield* Vault).getFileByPath(sourcePath)
        : null;
      const original =
        request.mode === "update" && file
          ? yield* Effect.promise((signal) => {
              void signal;
              return readLiveText(deps.app, file);
            })
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
      const selectedAnnotation = request.annotation;
      if (selectedAnnotation) {
        yield* Effect.gen(function* () {
          const key = selectedAnnotation.root.indexedKey;
          const live =
            typeof key === "string" &&
            !sample &&
            !SAMPLE_ANNOTATIONS.some(({ id }) => id === selectedAnnotation.id)
              ? yield* loadTemplateData(dataDeps, key, "annotation")
              : null;
          const restored = restoreTemplateData(
            selectedAnnotation.root,
            selectedAnnotation.descriptors,
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
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              const error = Cause.squash(cause);
              diagnostics.push(
                renderFault(
                  error,
                  "annotation",
                  callerSource(deps, request.source),
                ),
              );
            }),
          ),
        );
      }
      const annotationRanges: { from: number; to: number }[] = [];
      let cursor = 0;
      for (const root of context.annotations) {
        const rendered = yield* Effect.exit(
          Effect.sync(() => document.renderAnnotation(root)),
        );
        if (Exit.isFailure(rendered)) continue;
        const output = rendered.value;
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
            ? (yield* (yield* BibliographyRender).state).vaultPresentation
                .locale
            : locale,
        styleId: profile.bindings["citation.references-style"],
        wikilinks: settings["citation.wikilink-citations"],
      };
      const noteCitations =
        invalidLanguage || sample
          ? { citations: [], diagnostics: [] }
          : yield* renderDraftCitations({
              ...presentation,
              markdown: body,
            });
      const annotationCitations =
        invalidLanguage ||
        sample ||
        SAMPLE_ANNOTATIONS.some(({ id }) => id === request.annotation?.id)
          ? { citations: [], diagnostics: [] }
          : yield* renderDraftCitations({
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
        filename: noteName,
        notePath: resolveNoteRelPath(noteName),
        properties,
        fold: Object.entries(frontmatter).map(([key, value]) => ({
          key,
          value,
          missing: false,
          position:
            properties.find((entry) => entry.key === key)?.position ?? 0,
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
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          const error = Cause.squash(cause);
          const failure = failedRender(
            identity,
            renderFault(error, "render", callerSource(deps, request.source)),
          );
          return {
            ...failure,
            filename: noteName,
            notePath: resolveNoteRelPath(noteName),
            diagnostics: [
              ...(noteNameFailure ? [noteNameFailure] : []),
              ...failure.diagnostics,
            ],
            sourcePath,
            citations: [],
            annotationCitations: [],
          };
        }),
      ),
    );
  },
);

/**
 * The diagnostic one render failure reads as, attributed against the draft the
 * render read: what the engine reported, whose call reached it, and the one
 * call a reader repairs it at.
 * @see packages/workbench/src/render/attribution.ts renderFailureDiagnostic
 */
function renderFault(
  error: unknown,
  part: RenderDiagnostic["part"],
  caller: RenderCallerSource,
): RenderDiagnostic {
  // The engine's own account is taken here, where the error is still whole:
  // below this line the failure is a code and a message, and a reader who
  // copies the report would otherwise get neither the stack nor the excerpt.
  const evidence = engineEvidence(error);
  const diagnostic = renderFailureDiagnostic(error, caller);
  return {
    ...diagnostic,
    evidence,
    part: diagnostic.engine?.template === "annotation" ? "annotation" : part,
  };
}

/**
 * The draft one render read, in the form a repair location is an offset into.
 * The language decides the call form the scan reads; Liquid stands in for a
 * draft no parser could read, which is the language every default document is
 * written in.
 */
function callerSource(
  deps: RenderEnvironment,
  source: string,
): RenderCallerSource {
  try {
    const { manifest } =
      deps.templates.prepareLiteratureNoteTemplateSource(source);
    return {
      source,
      language: manifest.language ?? "liquid",
      profileId: manifest.id,
    };
  } catch {
    // Plain templates declare their language independently of a Profile.
  }
  try {
    return {
      source,
      language:
        parsePlainTemplateDocument(source).manifest.language ?? "liquid",
    };
  } catch {
    return { source, language: "liquid" };
  }
}
