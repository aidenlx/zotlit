// The render result shape and its identity stamp, shared by the renderer and
// the scheduler that decides which result is still current.

import type { CitationVariant } from "@zotlit/db";

import type {
  CitationExampleId,
  CitationPreviewSelection,
} from "./citation-examples";
import type {
  PartialContext,
  PartialPreviewSelection,
} from "./partial-preview";
import type { EngineEvidence, RenderReport } from "./report";
import type { AnnotationExample } from "./sample-annotations";

/**
 * What went wrong, in the vocabulary a host writes its own wording against. One
 * code is one sentence, so a host reads `code` and its `params` rather than the
 * English this package would otherwise author.
 */
export type RenderDiagnosticCode =
  | "citation-data-mismatch"
  | "citation-style-error"
  | "contract-version-mismatch"
  | "invalid-profile"
  | "missing-dependency"
  | "missing-partial"
  | "property-append-conflict"
  | "property-error"
  | "property-javascript"
  | "render-error"
  | "unsupported-dependency";

/**
 * Where the template engine itself said a failure happened. `template` is the
 * name the engine renders that source under, and a `line` counts lines of that
 * template's own source — never of whichever document the reader has open.
 */
export interface RenderEngineLocation {
  readonly template: string;
  /** 1-based, in the named template's own source. */
  readonly line?: number;
  /** 1-based, in that line. */
  readonly column?: number;
}

/** The Template Document whose own call reached the failing template. */
export interface RenderCaller {
  /** Its vault path, when the failure named one. */
  readonly document?: string;
  /** The name the engine renders it under, when the failure named one. */
  readonly template?: string;
}

export interface RenderDiagnostic {
  readonly code: RenderDiagnosticCode;
  /**
   * The wording this package did not author — the template engine's own failure
   * text, or the one a Local Bridge sent. Absent when `code` and `params` say
   * the whole thing.
   */
  readonly message?: string;
  /** The values a host's own message for `code` reads. */
  readonly params?: Readonly<Record<string, string | number>>;
  /** `annotation` names the Annotation Section alone as what failed. */
  readonly part?: "annotation" | "profile" | "properties" | "render";
  /**
   * 1-based position of the Managed Frontmatter entry that caused it, so the
   * responsible row can carry the diagnostic. Absent when nothing names one,
   * which is what sends the reader to Advanced instead.
   */
  readonly position?: number;
  /**
   * What the engine reported, kept apart from {@link RenderDiagnostic.callSite}
   * because the two are different places: a failure inside a called template is
   * reported there and repaired at the call.
   */
  readonly engine?: RenderEngineLocation;
  readonly caller?: RenderCaller;
  /**
   * The call in the source this render read that reached the failing template,
   * which is the one place the reader repairs it. Set only when that source
   * actually holds such a call; absent means the location is unknown, and a
   * host says so rather than sending the reader to a guessed line.
   */
  readonly callSite?: { readonly from: number; readonly to: number };
  /**
   * What the engine said before this diagnostic reduced it to `message`,
   * captured at the boundary that catches the error. Absent where the failure
   * was composed rather than thrown.
   */
  readonly evidence?: EngineEvidence;
  /**
   * The failed attempt this diagnostic came from, frozen when that attempt
   * landed. The Problems area inspects and copies it, so later edits,
   * selection changes, and other previews leave it as it was captured.
   */
  readonly report?: RenderReport;
}

export interface RenderedProperty {
  readonly key: string;
  readonly value?: unknown;
  readonly missing: boolean;
  /** 1-based position of the Managed Frontmatter entry that produced it. */
  readonly position: number;
}

export interface RenderIdentity {
  readonly previewMode?: "create" | "update";
  readonly sourceRevision: string;
  readonly snapshotRevision: string;
  readonly annotationId?: string;
  readonly annotationRevision?: string;
  /** The Citation Variant a Citation Template render produced its text under. */
  readonly citationVariant?: CitationVariant;
  /** The built-in example set it rendered; absent when the chosen Item supplied one. */
  readonly citationExample?: CitationExampleId;
  /** The caller a Shared Partial render read its root data as. */
  readonly partialContext?: PartialContext;
  /** The Profile that render's bindings came from; absent for the default one. */
  readonly partialProfile?: string;
}

/**
 * The stamp one render is known by. Takes a request, and equally the
 * selections a scheduler composes a result of its own from — a failure the
 * host reports carries the same dimensions, so it is matched the same way.
 */
export function renderIdentity({
  source,
  snapshot,
  annotation,
  citation,
  partial,
  mode,
}: {
  readonly source: string;
  /** `null` where no paper is loaded, which leaves the revision unnamed. */
  readonly snapshot: { readonly revision: string } | null;
  readonly mode?: "create" | "update";
  readonly annotation?: AnnotationExample | null;
  readonly citation?: CitationPreviewSelection | null;
  readonly partial?: PartialPreviewSelection | null;
}): RenderIdentity {
  return {
    ...(mode ? { previewMode: mode } : {}),
    sourceRevision: templateSourceRevision(source),
    snapshotRevision: snapshot?.revision ?? "",
    ...(annotation
      ? { annotationId: annotation.id, annotationRevision: annotation.revision }
      : {}),
    ...(citation
      ? {
          citationVariant: citation.variant,
          ...(citation.example ? { citationExample: citation.example } : {}),
        }
      : {}),
    ...(partial
      ? {
          partialContext: partial.context,
          ...(partial.profile ? { partialProfile: partial.profile } : {}),
        }
      : {}),
  };
}

export interface TemplateRenderResult extends RenderIdentity {
  readonly filename: string | null;
  /** What each entry produced on its own, in list order. */
  readonly properties: readonly RenderedProperty[];
  /**
   * The final ordered fold — the frontmatter the note gets once every entry has
   * merged. Each row carries the position that fixed its place in the note.
   */
  readonly fold: readonly RenderedProperty[];
  /**
   * The fold as the YAML block the created note carries, so a reader can check
   * the generated text rather than the values behind it. Null when the render
   * produced no frontmatter at all.
   */
  readonly frontmatterBlock: string | null;
  readonly creationBody: string | null;
  readonly managedRegion: string | null;
  readonly annotation: string | null;
  /** The selected example's computed citation, for matching field and completion values. */
  readonly annotationCitation: string | null;
  /** The Citation Template's own output for the selected set; null for a Profile. */
  readonly citation: string | null;
  /** The Shared Partial's own output under the chosen context; null otherwise. */
  readonly partial: string | null;
  /**
   * Where each highlight the format rendered landed in `creationBody`, in
   * reading order, so a host can point at the many outputs of the one format.
   */
  readonly annotationRanges: readonly RenderedRange[];
  readonly diagnostics: readonly RenderDiagnostic[];
}

/** A span of rendered Markdown, as offsets into the body it belongs to. */
export interface RenderedRange {
  readonly from: number;
  readonly to: number;
}

/** FNV-1a over the source, so a result can name the revision it rendered. */
export function templateSourceRevision(source: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * A result that produced nothing, which every partial result fills in from: a
 * render that failed outright, and one whose document produces a single part.
 */
export function emptyRender(identity: RenderIdentity): TemplateRenderResult {
  return {
    ...identity,
    filename: null,
    properties: [],
    fold: [],
    frontmatterBlock: null,
    creationBody: null,
    managedRegion: null,
    annotation: null,
    annotationCitation: null,
    citation: null,
    partial: null,
    annotationRanges: [],
    diagnostics: [],
  };
}

export function failedRender(
  identity: RenderIdentity,
  diagnostic: RenderDiagnostic,
): TemplateRenderResult {
  return { ...emptyRender(identity), diagnostics: [diagnostic] };
}

/**
 * Whether an attempt produced nothing at all. A template that renders empty
 * text still produced it, so a valid empty result stays apart from a failure,
 * and only a failure sends a reader to the last preview that worked.
 */
export function renderFailed(result: TemplateRenderResult): boolean {
  return (
    result.diagnostics.length > 0 &&
    result.filename === null &&
    result.creationBody === null &&
    result.managedRegion === null &&
    result.annotation === null &&
    result.citation === null &&
    result.partial === null
  );
}
