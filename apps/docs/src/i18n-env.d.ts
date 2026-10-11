import type { TranslationManifest } from "./lib/translation-state";

declare global {
  /** Replaced by Vite with the current native locale-file scan. */
  const __DOCS_TRANSLATION_MANIFEST__: TranslationManifest;
}
