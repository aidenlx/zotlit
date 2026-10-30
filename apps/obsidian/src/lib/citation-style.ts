import * as m from "@/lib/i18n/generated/messages";
import type { InstalledCslStyle } from "@/services/pandoc/styles";

/** Null and the empty picker value select the renderer's built-in CSL style. */
export function citationStyleLabel(
  id: string | null = null,
  styles: readonly InstalledCslStyle[] = [],
): string {
  if (!id) return m.settings_citation_references_style_default();
  return styles.find((style) => style.id === id)?.title ?? id;
}

/** Dropdown sentinel for the embedded default style; a style ID is never empty. */
export const STYLE_DEFAULT = "";

/** One entry of the Citation and References Style picker. */
export interface ReferencesStyleOption {
  value: string;
  label: string;
  /** An entry the picker shows and refuses to take as a selection of its own. */
  disabled?: boolean;
}

/**
 * The picker entries: the embedded default first, then the installed styles.
 * A selection Zotero no longer has keeps an entry of its own, so it stays
 * selected and visible until the user picks another style.
 */
export function referencesStyleOptions(
  styles: readonly InstalledCslStyle[],
  selected: string,
): ReferencesStyleOption[] {
  const options: ReferencesStyleOption[] = [
    {
      value: STYLE_DEFAULT,
      label: citationStyleLabel(),
    },
    ...styles.map((style) => ({ value: style.id, label: style.title })),
  ];
  if (selected !== STYLE_DEFAULT && !styles.some((s) => s.id === selected)) {
    options.push({
      value: selected,
      label: m.settings_citation_references_style_missing({ id: selected }),
    });
  }
  return options;
}
