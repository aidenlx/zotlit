// The Citation Presentation one Markdown document renders under, read from its note kind, Profile, and properties.

import type { MetadataCache, TFile } from "obsidian";

import type { CslItemData } from "@zotlit/db";

import {
  FIELD_CITATION_STYLE,
  FIELD_DOCUMENT_LANGUAGE,
  FIELD_LITERATURE_NOTE_PROFILE,
  FIELD_ZOTERO_NOTE_KEY,
} from "@/lib/constants";
import { isLanguageTag } from "@/lib/language-tag";
import { getLogger } from "@/lib/log";
import {
  parseProfileStamp,
  stampedSelector,
  unknownProfileDiagnostic,
} from "@/lib/profile-stamp";
import type {
  ProfileSelector,
  UnknownProfileDiagnostic,
} from "@/lib/profile-stamp";
import type { Citation } from "@/services/citation-index/query";
import type { Settings } from "@/services/settings/schema";
import { resolveLiteratureNoteProfileBindings } from "@/services/settings/service";

import type { RenderPresentation } from "./render-cache";

const logger = getLogger(["pandoc", "document-presentation"]);

/**
 * The note property a document-scoped presentation failure stands on, which is
 * the one the reader repairs.
 */
export type UnusableProperty = "style" | "language";

/** The note-local cause that stops one document's Citation Presentation. */
export interface ProfilePresentationFailure {
  kind: "unusable";
  property: "profile";
  diagnostic: UnknownProfileDiagnostic;
  target: string;
}

/** The Imported Note Profile that selected one document's CSL style. */
export interface ProfileStyleSource {
  profile: ProfileSelector;
  target: string;
}

/** A valid Profile whose selected CSL style Zotero cannot supply. */
export interface ProfileStylePresentationFailure extends ProfileStyleSource {
  kind: "unusable";
  property: "profile-style";
  styleId: string;
}

export type DocumentPresentationFailure =
  | { kind: "unusable"; property: UnusableProperty }
  | ProfilePresentationFailure
  | ProfileStylePresentationFailure;

/**
 * What one document renders its Citations and references under, or the property
 * that stops it from rendering at all.
 */
export type DocumentPresentation =
  | {
      kind: "read";
      presentation: RenderPresentation;
      profileStyle?: ProfileStyleSource;
    }
  | DocumentPresentationFailure;

/**
 * The Citation Presentation one document selects.
 *
 * An Imported Note selects its style through its effective Profile. Other
 * documents select an explicit style property or inherit the vault style. The
 * Document Language remains document-wide for every note kind.
 *
 * @param file the Markdown note the presentation answers for.
 * @param settings the Profiles available to Imported Notes.
 */
export function documentPresentation(
  metadataCache: Pick<MetadataCache, "getFileCache">,
  file: TFile,
  settings?: Readonly<Settings> | null,
): DocumentPresentation {
  const frontmatter = metadataCache.getFileCache(file)?.frontmatter;
  const presentation: RenderPresentation = {};
  let profileStyle: ProfileStyleSource | undefined;

  // For other documents, only an absent property leaves a vault selection in
  // charge. A visible property that names no style stops that document.
  const importedNote =
    settings && frontmatter?.[FIELD_ZOTERO_NOTE_KEY] !== undefined;
  const declaredStyle = frontmatter?.[FIELD_CITATION_STYLE] as unknown;
  if (importedNote) {
    const stamped = parseProfileStamp(
      frontmatter[FIELD_LITERATURE_NOTE_PROFILE],
    );
    const selector = stampedSelector(stamped);
    const bindings =
      selector === undefined
        ? undefined
        : resolveLiteratureNoteProfileBindings(settings, selector);
    if (!bindings) {
      logger.debug("The Imported Note Profile is unavailable", {
        path: file.path,
        stamp: stamped!.stamp,
      });
      return {
        kind: "unusable",
        property: "profile",
        diagnostic: unknownProfileDiagnostic(stamped!.stamp),
        target: file.path,
      };
    }
    presentation.styleId = bindings["citation.references-style"];
    // Resolved bindings mean `selector` was defined (its own undefined branch
    // above never resolves any).
    profileStyle = {
      profile: selector!,
      target: file.path,
    };
  } else if (declaredStyle !== undefined) {
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

  return {
    kind: "read",
    presentation,
    ...(profileStyle ? { profileStyle } : {}),
  };
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

export function vaultPresentation(
  settings: Readonly<Settings> | null | undefined,
): EffectivePresentation {
  return {
    styleId:
      settings?.["note.default-profile"].bindings[
        "citation.references-style"
      ] ?? null,
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

/** One cited work as a render reads it, whichever join the surface read it through. */
interface CitedWork {
  /** The work as the engine reads it; its `id` addresses the rendered entry. */
  readonly csl: CslItemData;
}

/**
 * What one document formats its Citations and its references from, whole: the
 * style and the Citation Locale it renders under, and the works it cites in the
 * order it cites them.
 */
export type DocumentCitationPresentation =
  | DocumentPresentationFailure
  | {
      kind: "read";
      /** The style and Citation Locale, with nothing left for a reader to fill in. */
      presentation: EffectivePresentation;
      /** The cited works, in the order the document cites them. */
      items: readonly CslItemData[];
    };

/**
 * The one value every Citation Presentation surface renders from: Document
 * Citation Text, the References Sidebar, and the Citation Popover each read the
 * same style, the same Citation Locale, and the same ordered citation set, so a
 * numbering style counts the same works in the same order wherever they are
 * shown and no surface composes that precedence for itself.
 *
 * A document whose own property names nothing renders nothing at all, so the
 * vault selections stay out of that answer.
 *
 * @param declared what the document itself says, as {@link documentPresentation} read it.
 * @param vault the selections each half the document leaves unsaid inherits.
 * @param cited the document's Citations in document order, and the cited works
 *   by Indexed Key; a Citation naming no readable work is cited by no render.
 */
export function documentCitationPresentation(
  declared: DocumentPresentation,
  vault: EffectivePresentation,
  cited: {
    citations: readonly Pick<Citation, "indexedKey">[];
    works: ReadonlyMap<string, CitedWork>;
  },
): DocumentCitationPresentation {
  if (declared.kind === "unusable") return declared;
  const items: CslItemData[] = [];
  for (const { indexedKey } of cited.citations) {
    const work = indexedKey === null ? undefined : cited.works.get(indexedKey);
    if (work) items.push(work.csl);
  }
  return {
    kind: "read",
    presentation: effectivePresentation(declared.presentation, vault),
    items,
  };
}

/** Two unusable presentations are alike only where the same repair is needed. */
export function samePresentation(
  left: DocumentPresentation,
  right: DocumentPresentation,
): boolean {
  if (left.kind === "unusable" || right.kind === "unusable") {
    if (
      left.kind !== "unusable" ||
      right.kind !== "unusable" ||
      left.property !== right.property
    ) {
      return false;
    }
    return left.property === "profile" && right.property === "profile"
      ? left.diagnostic.stamp === right.diagnostic.stamp &&
          left.target === right.target
      : true;
  }
  return (
    left.presentation.styleId === right.presentation.styleId &&
    left.presentation.locale === right.presentation.locale &&
    left.profileStyle?.profile === right.profileStyle?.profile &&
    left.profileStyle?.target === right.profileStyle?.target
  );
}
