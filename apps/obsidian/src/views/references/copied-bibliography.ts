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
  /** For a destination that keeps inline formatting. */
  html: string;
  /** For a destination that takes text alone. */
  text: string;
}

/**
 * Serialize a completed bibliography for the clipboard.
 *
 * Entries keep the order and the Entry Markers the style gave them, one entry
 * per paragraph and no heading, so the destination supplies the heading its own
 * document needs. Both representations answer for the same bibliography, so a
 * destination that takes either one shows the same entries.
 *
 * @param entries the completed bibliography, in the style's own order.
 */
export function toCopiedBibliography(
  entries: readonly CopiedBibliographyEntry[],
): CopiedBibliography {
  return {
    html: entries.map(richEntry).join("\n"),
    text: entries.map(plainEntry).join("\n\n"),
  };
}

/**
 * The inline elements a CSL semantic reaches the entry as: emphasis, weight,
 * underline, superscript, subscript, a link, and the span that carries small
 * caps. Anything else hands its own content over and keeps the text.
 */
const PORTABLE_TAGS = new Set([
  "a",
  "b",
  "em",
  "i",
  "span",
  "strong",
  "sub",
  "sup",
  "u",
]);

/**
 * The declarations that carry a CSL semantic no element stands for — small caps
 * above all. They ride as inline style because the destination is another
 * application, which has no stylesheet of ours to read a class against.
 */
const PORTABLE_STYLE = [
  "font-variant",
  "font-style",
  "font-weight",
  "text-decoration",
];

/**
 * One paragraph, holding the Entry Marker and the entry as portable markup.
 *
 * The entry is rebuilt rather than cloned: each element is remade from the
 * allowed tags and the two attributes that survive — a link's target and the
 * inline styling above — so what reaches the clipboard carries markup the
 * destination can read and nothing else, whatever a style put in the entry.
 */
function richEntry({ marker, content }: CopiedBibliographyEntry): string {
  const paragraph = document.createElement("p");
  const label = marker === undefined ? "" : collapse(marker);
  if (label) paragraph.append(`${label} `);
  paragraph.append(portable(content));
  return paragraph.outerHTML;
}

function portable(source: Node): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const node of source.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      fragment.append(node.textContent ?? "");
      continue;
    }
    if (!(node instanceof Element)) continue;
    const tag = node.tagName.toLowerCase();
    if (!PORTABLE_TAGS.has(tag)) {
      fragment.append(portable(node));
      continue;
    }
    const element = document.createElement(tag);
    const href = node.getAttribute("href");
    if (tag === "a" && href) element.setAttribute("href", href);
    if (node instanceof HTMLElement) {
      for (const property of PORTABLE_STYLE) {
        const value = node.style.getPropertyValue(property);
        if (value) element.style.setProperty(property, value);
      }
    }
    element.append(portable(node));
    fragment.append(element);
  }
  return fragment;
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
