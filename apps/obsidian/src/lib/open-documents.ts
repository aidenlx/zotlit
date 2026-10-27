// The documents open in the workspace, for an owner that keeps per-document state only while one is.
export interface OpenDocuments {
  /** Vault paths shown in at least one Markdown leaf. */
  paths(): ReadonlySet<string>;
  /** Calls `changed` whenever {@link paths} may answer differently. */
  subscribe(changed: () => void): Disposable;
}
