// The Citation Presentation one Markdown document renders under, read from its own note properties and the vault selections.

import type { MetadataCache, TFile } from "obsidian";

import type { CslItemData } from "@zotlit/db";

import { FIELD_CITATION_STYLE, FIELD_DOCUMENT_LANGUAGE } from "@/lib/constants";
import { isLanguageTag } from "@/lib/language-tag";
import { getLogger } from "@/lib/log";
import type { ReferenceSource } from "@/services/citation-index/sources";
import type { Settings } from "@/services/settings/schema";

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

/**
 * A Citation Presentation with nothing left unsaid: the style and the Citation
 * Locale a render is actually formatted under.
 */
export interface EffectivePresentation {
  /** Installed CSL ID, or `null` for the engine's embedded default style. */
  styleId: string | null;
  /** `null` is Style default: the selected style's own locale stays in charge. */
  locale: string | null;
}

/** The Citation Presentation the vault settings select. */
export function vaultPresentation(
  settings: Readonly<Settings> | null | undefined,
): EffectivePresentation {
  return {
    styleId: settings?.["citation.references-style"] ?? null,
    // An empty Citation Locale asks for Style default, as an unset one does.
    locale: settings?.["citation.locale"] || null,
  };
}

/**
 * The Citation Presentation one document renders under, whole: what the
 * document declares, and the vault selection for each half it leaves unsaid.
 *
 * In-app rendering, the References Sidebar, the Citation Popover, and built-in
 * export all read this one precedence, so a document renders the same way
 * wherever it is shown.
 */
export function effectivePresentation(
  declared: RenderPresentation,
  vault: EffectivePresentation,
): EffectivePresentation {
  const { styleId, locale } = declared;
  return {
    styleId: styleId === undefined ? vault.styleId : styleId,
    locale: locale === undefined ? vault.locale : locale,
  };
}

/**
 * The works one document cites, in the order it cites them — the one ordered
 * citation set every Citation Presentation surface renders from, so a numbering
 * style counts the same works in the same order wherever they are shown.
 *
 * @param sources the cited Items by Indexed Key, in document order.
 */
export function citedItems(
  sources: ReadonlyMap<string, ReferenceSource>,
): CslItemData[] {
  return [...sources.values()].map((source) => source.csl);
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
