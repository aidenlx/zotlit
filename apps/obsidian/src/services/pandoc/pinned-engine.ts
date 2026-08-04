// The Pandoc engine download the release build pinned into this bundle.

/**
 * The engine download this build committed to, resolved and verified against
 * the official upstream release at build time.
 *
 * @see scripts/pandoc-engine.ts
 */
export interface PinnedPandocEngine {
  /** Upstream Pandoc release tag, e.g. `3.10`. */
  readonly version: string;
  /** Exact `jgm/pandoc` release asset carrying the WASM binary. */
  readonly url: string;
  /** Lowercase hex SHA-256 of the uncompressed `pandoc.wasm` inside that asset. */
  readonly sha256: string;
}

export const PINNED_PANDOC_ENGINE: PinnedPandocEngine = __PANDOC_ENGINE__;
