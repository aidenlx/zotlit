// The render result shape and its identity stamp, shared by the renderer and
// the scheduler that decides which result is still current.

export interface RenderDiagnostic {
  readonly code:
    | "citation-style-error"
    | "contract-version-mismatch"
    | "invalid-profile"
    | "missing-dependency"
    | "property-error"
    | "render-error"
    | "render-timeout"
    | "unsupported-dependency";
  readonly message: string;
  readonly part?: "profile" | "properties" | "render";
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
  readonly creationBody: string | null;
  readonly managedRegion: string | null;
  readonly annotation: string | null;
  readonly diagnostics: readonly RenderDiagnostic[];
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
    creationBody: null,
    managedRegion: null,
    annotation: null,
    diagnostics: [diagnostic],
  };
}
