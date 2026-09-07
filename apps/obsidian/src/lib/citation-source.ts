// Citation source and key spans shared by the Obsidian presentation surfaces.

import type { PandocTextSpan } from "@zotlit/templates/pandoc-citation";

/** One citation key at its offset within a Citation's own source. */
export interface CitationKey extends PandocTextSpan {
  citekey: string;
}

/** One Citation as source text, with the keys it names located in it. */
export interface CitationSource {
  source: string;
  keys: CitationKey[];
}

/** One scanned Citation in a document, with document-relative source spans. */
export interface ScannedCitation extends PandocTextSpan {
  keys: CitationKey[];
}
