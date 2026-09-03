// The render result shape and its identity stamp, shared by the renderer and
// the scheduler that decides which result is still current.

export interface RenderDiagnostic {
  readonly code:
    | "contract-version-mismatch"
    | "invalid-profile"
    | "property-error"
    | "render-error"
    | "render-timeout";
  readonly message: string;
  readonly part?: "profile" | "properties" | "render";
}

export interface RenderedProperty {
  readonly key: string;
  readonly value?: unknown;
  readonly missing: boolean;
}

export interface RenderIdentity {
  readonly sourceRevision: string;
  readonly snapshotRevision: string;
}

export interface ProfileRenderResult extends RenderIdentity {
  readonly filename: string | null;
  readonly properties: readonly RenderedProperty[];
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
    creationBody: null,
    managedRegion: null,
    annotation: null,
    diagnostics: [diagnostic],
  };
}
