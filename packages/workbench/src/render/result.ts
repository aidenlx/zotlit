// The render result shape and its identity stamp, shared by the renderer and
// the scheduler that decides which result is still current.

import type { RenderRequest } from "./scheduler";

/**
 * What went wrong, in the vocabulary a host writes its own wording against. One
 * code is one sentence, so a host reads `code` and its `params` rather than the
 * English this package would otherwise author.
 */
export type RenderDiagnosticCode =
  | "citation-style-error"
  | "contract-version-mismatch"
  | "invalid-profile"
  | "missing-dependency"
  | "property-append-conflict"
  | "property-error"
  | "property-javascript"
  | "render-error"
  | "render-timeout"
  | "unsupported-dependency";

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
}

export interface RenderedProperty {
  readonly key: string;
  readonly value?: unknown;
  readonly missing: boolean;
  /** 1-based position of the Managed Frontmatter entry that produced it. */
  readonly position: number;
}

export interface RenderIdentity {
  readonly sourceRevision: string;
  readonly snapshotRevision: string;
  readonly annotationId?: string;
  readonly annotationRevision?: string;
}

export function renderIdentity({
  source,
  snapshot,
  annotation,
}: RenderRequest): RenderIdentity {
  return {
    sourceRevision: profileSourceRevision(source),
    snapshotRevision: snapshot.revision,
    ...(annotation
      ? { annotationId: annotation.id, annotationRevision: annotation.revision }
      : {}),
  };
}

export interface ProfileRenderResult extends RenderIdentity {
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
export function profileSourceRevision(source: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function failedRender(
  identity: RenderIdentity,
  diagnostic: RenderDiagnostic,
): ProfileRenderResult {
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
    annotationRanges: [],
    diagnostics: [diagnostic],
  };
}
