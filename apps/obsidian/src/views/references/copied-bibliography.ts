// Serialization of a Copied Bibliography: a complete bibliography rendering, written for a destination outside the vault.

import type { Inlines } from "@/services/pandoc/ast";
import {
  DISPLAY_CLASSES,
  flowWriter,
  inlineText,
  linkHref,
  QUOTE_MARKS,
  WRAPPER_TAGS,
} from "@/services/pandoc/inline-content";

/** One entry of a completed bibliography, as the engine formatted it. */
export interface CopiedBibliographyEntry {
  /** The style's Entry Marker, or `undefined` when the style renders none. */
  readonly marker: Inlines | undefined;
  /** The entry text as one inline flow. */
  readonly content: Inlines;
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
 * One paragraph, holding the Entry Marker and the entry as portable markup.
 *
 * The entry is written from the formatted flow the engine handed over, and the
 * destination reads no stylesheet of ours, so what crosses over is what stands
 * on its own: the elements pandoc's own HTML writer names, a link's target
 * under a followable scheme, and the declarations small caps rides under. A
 * style writes whatever it likes into an entry; nothing else of it crosses
 * over.
 */
function richEntry({ marker, content }: CopiedBibliographyEntry): string {
  const paragraph = document.createElement("p");
  const label = marker === undefined ? "" : collapse(inlineText(marker));
  if (label) paragraph.append(`${label} `);
  paragraph.append(portable(content));
  return paragraph.outerHTML;
}

/**
 * Write one formatted flow as the markup a destination outside the vault reads.
 *
 * The walk follows the one the surfaces render under: a constructor that stands
 * for an element becomes that element, and one that stands for a layout hands
 * its own content over, leaving a single space where a display span stood.
 */
function portable(nodes: Inlines): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const { separate, add, endPart } = flowWriter<Node>((node) => {
    fragment.append(node);
  });

  function wrap(tag: string, content: Inlines): HTMLElement {
    const element = document.createElement(tag);
    element.append(portable(content));
    return element;
  }

  function walk(inlines: Inlines): void {
    for (const inline of inlines) {
      switch (inline.t) {
        case "Str":
          add(inline.c);
          break;
        case "Space":
        case "SoftBreak":
          separate();
          break;
        case "Emph":
        case "Strong":
        case "Underline":
        case "Strikeout":
        case "Superscript":
        case "Subscript":
          add(wrap(WRAPPER_TAGS[inline.t], inline.c));
          break;
        case "SmallCaps": {
          // The one CSL semantic no element stands for. It rides as inline
          // style because the destination is another application, which has no
          // stylesheet of ours to read a class against.
          const element = wrap("span", inline.c);
          element.style.setProperty("font-variant", "small-caps");
          add(element);
          break;
        }
        case "Quoted": {
          const [open, close] = QUOTE_MARKS[inline.c[0].t];
          add(open);
          walk(inline.c[1]);
          add(close);
          break;
        }
        case "Code": {
          const [, source] = inline.c;
          add(source);
          break;
        }
        case "Math": {
          const [, source] = inline.c;
          add(source);
          break;
        }
        case "Cite": {
          const [, content] = inline.c;
          walk(content);
          break;
        }
        case "Image": {
          const [, alt] = inline.c;
          walk(alt);
          break;
        }
        case "Span": {
          const [[, classes], content] = inline.c;
          const display = classes.some((name) => DISPLAY_CLASSES.has(name));
          if (display) separate();
          walk(content);
          if (display) endPart();
          break;
        }
        case "Link": {
          const [, children, [url]] = inline.c;
          const href = linkHref(url);
          if (href === null) {
            walk(children);
            break;
          }
          const anchor = wrap("a", children);
          anchor.setAttribute("href", href);
          add(anchor);
          break;
        }
        case "LineBreak":
        case "Note":
        case "RawInline":
          // A line break is layout the paragraph has no room for, a note is a
          // document-scoped coordinate that travels with no document, and raw
          // markup belongs to a format the destination is not reading.
          break;
      }
    }
  }

  walk(nodes);
  return fragment;
}

function plainEntry({ marker, content }: CopiedBibliographyEntry): string {
  const body = collapse(inlineText(content));
  const label = marker === undefined ? "" : collapse(inlineText(marker));
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
