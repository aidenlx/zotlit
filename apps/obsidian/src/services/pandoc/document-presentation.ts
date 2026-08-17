// The Citation Presentation one Markdown document renders under, read from its own note properties.

import type { MetadataCache, TFile } from "obsidian";

import { FIELD_CITATION_STYLE } from "@/lib/constants";
import { getLogger } from "@/lib/log";

import type { RenderPresentation } from "./render-cache";

const logger = getLogger(["pandoc", "document-presentation"]);

/**
 * What one document renders its Citations and references with.
 *
 * A document that carries no {@link FIELD_CITATION_STYLE} property inherits the
 * vault Citation and References Style, which is what an omitted member of the
 * presentation asks for. A document that carries one speaks for itself: the CSL
 * ID travels to the resolver as written, so a style Zotero cannot supply fails
 * the document rather than falling back to the vault selection.
 *
 * @param file the Markdown note the presentation answers for.
 * @returns the presentation to render that document under, or `null` when the
 *   property is present and is no CSL ID at all — a document whose declared
 *   style cannot even be read is a note-scoped failure.
 */
export function documentPresentation(
  metadataCache: Pick<MetadataCache, "getFileCache">,
  file: TFile,
): RenderPresentation | null {
  const declared = metadataCache.getFileCache(file)?.frontmatter?.[
    FIELD_CITATION_STYLE
  ] as unknown;
  // Only the absent property leaves the vault selection in charge. A property
  // the author can see — emptied, blank, or holding anything but a style ID —
  // names no style to render with, and stops that document where it stands.
  if (declared === undefined) return {};
  const styleId = typeof declared === "string" ? declared.trim() : "";
  if (!styleId) {
    logger.debug("The document citation style property is no style ID", {
      path: file.path,
      property: FIELD_CITATION_STYLE,
    });
    return null;
  }
  return { styleId };
}

/** Whether two documents — or one document across a change — render alike. */
export function samePresentation(
  left: RenderPresentation | null,
  right: RenderPresentation | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.styleId === right.styleId && left.locale === right.locale;
}
