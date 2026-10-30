// What a build pins a Managed Binary to. The build scripts resolve it and the
// plugin verifies against it, so it imports nothing from either side.

/**
 * The download a build committed to, resolved and verified against the
 * official upstream release at build time.
 */
export interface BinaryPin {
  /** Upstream release version, e.g. `3.10`. */
  readonly version: string;
  /** Exact upstream asset that carries the binary. */
  readonly url: string;
  /** Lowercase hex SHA-256 of the binary itself, after it is extracted. */
  readonly sha256: string;
}
