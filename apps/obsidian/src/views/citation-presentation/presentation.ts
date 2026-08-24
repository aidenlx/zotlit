// What one note's Citation Presentation properties hold, the choices the dialog
// offers over them, and the one property update a confirmed choice writes.

import type { CachedMetadata, FileManager, TFile } from "obsidian";

import { FIELD_CITATION_STYLE, FIELD_DOCUMENT_LANGUAGE } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import type { InstalledCslStyle } from "@/services/pandoc/styles";
import { referencesStyleOptions, STYLE_DEFAULT } from "@/setting-tab/citations";
import type { ReferencesStyleOption } from "@/setting-tab/citations";

/** Style-picker value of a note that names no style of its own. */
export const STYLE_INHERITED = "";

/** The Citation Presentation one note declares, as the dialog opens on it. */
export interface DeclaredPresentation {
  /** The CSL ID the note names, or `null` where it inherits the vault style. */
  styleId: string | null;
  /** The Document Language the note declares; empty where it declares none. */
  language: string;
}

/** What a confirmed dialog writes into the note's own properties. */
export interface CitationPresentationChoice {
  /** CSL ID the note renders under, or `null` to inherit the vault style. */
  styleId: string | null;
  /** Document Language the note declares, or `null` to remove the property. */
  language: string | null;
}

/**
 * A property holding anything but the value it takes stops the document
 * everywhere else, and this dialog is where that is repaired, so it opens on
 * the inherited value rather than refusing the note.
 */
export function declaredPresentation(
  cache: CachedMetadata | null,
): DeclaredPresentation {
  const frontmatter = cache?.frontmatter;
  const styleId = frontmatter?.[FIELD_CITATION_STYLE] as unknown;
  const language = frontmatter?.[FIELD_DOCUMENT_LANGUAGE] as unknown;
  return {
    styleId:
      typeof styleId === "string" && styleId.trim() ? styleId.trim() : null,
    language: typeof language === "string" ? language.trim() : "",
  };
}

/**
 * The style-picker entries: the vault style the note inherits first, then the
 * styles Zotero has installed. A style the note names and Zotero no longer has
 * keeps an entry of its own, so it stays selected and named as missing; the
 * picker shows that entry and refuses to take it, so every style this dialog
 * writes is one Zotero owns.
 */
export function stylePickerOptions(
  styles: readonly InstalledCslStyle[],
  {
    selected,
    vaultStyleId,
  }: { selected: string | null; vaultStyleId: string | null },
): ReferencesStyleOption[] {
  const options: ReferencesStyleOption[] = [
    {
      value: STYLE_INHERITED,
      label: m.citation_presentation_style_inherited({
        style: vaultStyleLabel(styles, vaultStyleId),
      }),
    },
    ...styles.map((style) => ({ value: style.id, label: style.title })),
  ];
  if (selected !== null && !styles.some((style) => style.id === selected)) {
    options.push({
      value: selected,
      label: m.settings_citation_references_style_missing({ id: selected }),
      disabled: true,
    });
  }
  return options;
}

/** The vault selection as the picker names it, so an inherited note shows it. */
function vaultStyleLabel(
  styles: readonly InstalledCslStyle[],
  vaultStyleId: string | null,
): string {
  const selected = vaultStyleId ?? STYLE_DEFAULT;
  return referencesStyleOptions(styles, selected).find(
    (option) => option.value === selected,
  )!.label;
}

/**
 * Both properties travel in one pass over the note's own properties, so the
 * style and the Document Language never reach the document apart and leave it
 * half-presented; an inherited style and a removed Document Language are the
 * absence of the property, which is what a vault selection answers for.
 */
export function applyCitationPresentation(
  fileManager: Pick<FileManager, "processFrontMatter">,
  file: TFile,
  { styleId, language }: CitationPresentationChoice,
): Promise<void> {
  return fileManager.processFrontMatter(file, (frontmatter) => {
    if (styleId === null) delete frontmatter[FIELD_CITATION_STYLE];
    else frontmatter[FIELD_CITATION_STYLE] = styleId;
    if (language === null) delete frontmatter[FIELD_DOCUMENT_LANGUAGE];
    else frontmatter[FIELD_DOCUMENT_LANGUAGE] = language;
  });
}
