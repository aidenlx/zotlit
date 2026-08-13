// Serialization of a Copied Bibliography: a complete bibliography rendering, written for a destination outside the vault.

/** One entry of a completed bibliography, as the render cache formatted it. */
export interface CopiedBibliographyEntry {
  /** The style's Entry Marker, or `undefined` when the style renders none. */
  marker: string | undefined;
  /** The entry text as one inline flow. */
  content: DocumentFragment;
}

/** A Copied Bibliography in the representations the clipboard offers. */
export interface CopiedBibliography {
  text: string;
}

/**
 * Serialize a completed bibliography for the clipboard.
 *
 * Entries keep the order and the Entry Markers the style gave them, one entry
 * per paragraph and no heading, so the destination supplies the heading its own
 * document needs.
 *
 * @param entries the completed bibliography, in the style's own order.
 */
export function toCopiedBibliography(
  entries: readonly CopiedBibliographyEntry[],
): CopiedBibliography {
  return { text: entries.map(plainEntry).join("\n\n") };
}

function plainEntry({ marker, content }: CopiedBibliographyEntry): string {
  const body = collapse(content.textContent ?? "");
  const label = marker === undefined ? "" : collapse(marker);
  return [label, body].filter(Boolean).join(" ");
}

/**
 * An entry is formatted as markup, so its source line breaks and indentation
 * are layout rather than text. Only ASCII whitespace is collapsed: a style that
 * places a non-breaking or thin space between initials meant that space to
 * survive into the pasted result.
 */
function collapse(text: string): string {
  return text.replaceAll(/[\t\n\r ]+/g, " ").trim();
}
