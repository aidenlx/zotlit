// The Citation Presentation one Markdown document renders under, read from its own note properties.

import type { MetadataCache, TFile } from "obsidian";

import { FIELD_CITATION_STYLE, FIELD_DOCUMENT_LANGUAGE } from "@/lib/constants";
import { isLanguageTag } from "@/lib/language-tag";
import { getLogger } from "@/lib/log";

import type { RenderPresentation } from "./render-cache";

const logger = getLogger(["pandoc", "document-presentation"]);

/**
 * The note property a document-scoped presentation failure stands on, which is
 * the one the reader repairs.
 */
export type UnusableProperty = "style" | "language";

/**
 * What one document renders its Citations and references under, or the property
 * that stops it from rendering at all.
 */
export type DocumentPresentation =
  | { kind: "read"; presentation: RenderPresentation }
  | { kind: "unusable"; property: UnusableProperty };

/**
 * The Citation Presentation one document declares.
 *
 * A document that carries neither property inherits the vault Citation and
 * References Style and the vault Citation Locale, which is what an omitted
 * member of the presentation asks for. A document that carries one speaks for
 * itself: the CSL ID travels to the resolver as written, and the Document
 * Language becomes the locale citeproc renders in, so a style Zotero cannot
 * supply fails the document rather than falling back to a vault selection.
 *
 * @param file the Markdown note the presentation answers for.
 */
export function documentPresentation(
  metadataCache: Pick<MetadataCache, "getFileCache">,
  file: TFile,
): DocumentPresentation {
  const frontmatter = metadataCache.getFileCache(file)?.frontmatter;
  const presentation: RenderPresentation = {};

  // Only an absent property leaves a vault selection in charge. A property the
  // author can see — emptied, blank, or holding anything but the value it takes
  // — names nothing to render with, and stops that document where it stands.
  const declaredStyle = frontmatter?.[FIELD_CITATION_STYLE] as unknown;
  if (declaredStyle !== undefined) {
    const styleId =
      typeof declaredStyle === "string" ? declaredStyle.trim() : "";
    if (!styleId) {
      logger.debug("The document citation style property is no style ID", {
        path: file.path,
        property: FIELD_CITATION_STYLE,
      });
      return { kind: "unusable", property: "style" };
    }
    presentation.styleId = styleId;
  }

  const declaredLanguage = frontmatter?.[FIELD_DOCUMENT_LANGUAGE] as unknown;
  if (declaredLanguage !== undefined) {
    const locale =
      typeof declaredLanguage === "string" ? declaredLanguage.trim() : "";
    if (!isLanguageTag(locale)) {
      logger.debug("The document language property is no language tag", {
        path: file.path,
        property: FIELD_DOCUMENT_LANGUAGE,
      });
      return { kind: "unusable", property: "language" };
    }
    presentation.locale = locale;
  }

  return { kind: "read", presentation };
}

/** Whether two documents — or one document across a change — render alike. */
export function samePresentation(
  left: DocumentPresentation,
  right: DocumentPresentation,
): boolean {
  if (left.kind === "unusable" || right.kind === "unusable") {
    return (
      left.kind === "unusable" &&
      right.kind === "unusable" &&
      left.property === right.property
    );
  }
  return (
    left.presentation.styleId === right.presentation.styleId &&
    left.presentation.locale === right.presentation.locale
  );
}
