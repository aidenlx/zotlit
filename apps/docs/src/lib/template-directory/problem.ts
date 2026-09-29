// The named diagnostics the Directory loader and verification report.

export type DirectoryProblemCode =
  // The entry format
  | "unexpected-file"
  | "missing-file"
  | "invalid-slug"
  | "invalid-metadata"
  | "invalid-artifact"
  | "reserved-partial-name"
  // Profile invariants
  | "profile-id"
  | "duplicate-profile-id"
  | "profile-binding"
  | "profile-match"
  | "profile-contract"
  | "profile-metadata"
  | "template-language"
  | "property-language"
  | "managed-block"
  // The one partial namespace
  | "unknown-partial"
  | "partial-not-packed"
  | "packed-partial-differs"
  | "packed-partial-uncalled"
  // Rendering
  | "render-diagnostic"
  | "property-output"
  | "property-expectation"
  | "unverified";

export interface DirectoryProblem {
  /** The entry's id, or the file's path for a file outside every entry. */
  readonly entry: string;
  readonly code: DirectoryProblemCode;
  /** What is wrong and how to repair it, for the maintainer who reads the test. */
  readonly message: string;
}
