import type TurndownService from "turndown";

import { highlightColorToName, textColorToName } from "@zotlit/db";

import { renderColorMark, renderHighlight } from "./color-mark";
import type { HighlightOptions } from "./color-mark";
import { createObsidianTurndown } from "./obsidian-base";

/**
 * Attribute on the prepass sentinel `<div>` that carries an annotation
 * paragraph's pre-rendered callout Markdown (URI-encoded). The note-import
 * prepass replaces a qualifying `<p>` with such a sentinel; the
 * `annotationCallout` rule emits the decoded attribute verbatim rather than the
 * node's `textContent`, which Turndown's whitespace collapsing would mangle.
 * URI-encoding keeps the payload a single whitespace- and quote-free token.
 */
export const ANNOTATION_CALLOUT_ATTR = "data-zt-callout";

/** Encode callout Markdown into the sentinel attribute value. */
export function encodeCalloutAttr(markdown: string): string {
  return encodeURIComponent(markdown);
}

/** Decode the sentinel attribute back to callout Markdown. */
function decodeCalloutAttr(encoded: string): string {
  return decodeURIComponent(encoded);
}

/**
 * Add the rules for Zotero note HTML quirks that Obsidian's base config does
 * not cover, would silently corrupt, or would drop:
 *
 * - `span.math` / `pre.math` — Zotero's math nodes. Emit the already-delimited
 *   `$…$` / `$$…$$` text verbatim (escaping is off, so it survives).
 * - bare `<pre>` — Zotero serializes code blocks as a `<pre>` with no `<code>`
 *   child, which the default fenced-code rule ignores. Fence it from
 *   `textContent` so inner inline HTML (e.g. `<em>`) stays literal.
 * - `text-decoration: line-through` spans — Zotero's strikethrough is a styled
 *   span, not `<s>`/`<del>`, so the base strikethrough rule never sees it.
 * - `<sub>` / `<sup>` / `<u>` — kept as HTML; Obsidian renders these inline and
 *   Markdown has no equivalent.
 * - colored / highlighted spans — Zotero's note-editor text-color and highlight
 *   marks carry the color inline. Text colors and highlight fallbacks become
 *   HTML color marks; supported highlights can use opt-in Colored Highlight
 *   Syntax.
 * - `img[data-attachment-key]` — a Zotero embed with no `src`, both the plain
 *   attachment image and the image-excerpt annotation (`data-annotation` set).
 *   Keep the tag (and its key) so the shared Stage 9 import resolves it to a
 *   real embed.
 * - `span.citation[data-citation]` — Zotero's citation mark. Passes through as
 *   raw HTML by default; `createNoteTurndown`'s `citation` option lets the
 *   orchestrator inject the in-rule resolver that renders the user's cite syntax.
 * - `span[data-annotation]` (highlight / underline excerpt) — passes through as
 *   raw HTML by default; `createNoteTurndown`'s `annotationExcerpt` option lets
 *   the orchestrator inject the resolved highlight/underline rendering.
 */
function addZoteroRules(
  td: TurndownService,
  options: NoteTurndownOptions,
): void {
  td.addRule("mathInline", {
    filter: (node) =>
      node.nodeName === "SPAN" && node.classList.contains("math"),
    replacement: (_content, node) => node.textContent ?? "",
  });

  td.addRule("mathBlock", {
    filter: (node) =>
      node.nodeName === "PRE" && node.classList.contains("math"),
    replacement: (_content, node) => `\n\n${node.textContent ?? ""}\n\n`,
  });

  td.addRule("codeBlock", {
    filter: (node) =>
      node.nodeName === "PRE" &&
      !node.classList.contains("math") &&
      node.firstChild?.nodeName !== "CODE",
    replacement: (_content, node, options) => {
      const fence = options.fence ?? "```";
      return `\n\n${fence}\n${node.textContent ?? ""}\n${fence}\n\n`;
    },
  });

  td.addRule("strikethroughSpan", {
    filter: (node) => {
      if (node.nodeName !== "SPAN") return false;
      const { textDecoration, textDecorationLine } = node.style;
      return (
        textDecoration.includes("line-through") ||
        textDecorationLine.includes("line-through")
      );
    },
    replacement: (content) => `~~${content}~~`,
  });

  td.addRule("subscript", {
    filter: "sub",
    replacement: (content) => `<sub>${content}</sub>`,
  });

  td.addRule("superscript", {
    filter: "sup",
    replacement: (content) => `<sup>${content}</sup>`,
  });

  td.addRule("underline", {
    filter: "u",
    replacement: (content) => `<u>${content}</u>`,
  });

  td.addRule("coloredSpan", {
    filter: (node) =>
      node.nodeName === "SPAN" &&
      !!(node.style.color || node.style.backgroundColor),
    replacement: (content, node) => {
      const { color, backgroundColor } = (node as HTMLElement).style;
      return backgroundColor
        ? renderHighlight(
            content,
            {
              raw: backgroundColor,
              name: highlightColorToName(backgroundColor),
            },
            options,
          )
        : renderColorMark("text", content, {
            raw: color,
            name: textColorToName(color),
          });
    },
  });

  td.addRule("embeddedImage", {
    filter: (node) =>
      node.nodeName === "IMG" && node.hasAttribute("data-attachment-key"),
    replacement:
      options.embeddedImage ??
      ((_content, node) => (node as Element).outerHTML),
  });

  td.addRule("citation", {
    filter: (node) =>
      node.nodeName === "SPAN" &&
      node.classList.contains("citation") &&
      node.hasAttribute("data-citation"),
    replacement:
      options.citation ?? ((_content, node) => (node as Element).outerHTML),
  });

  td.addRule("annotationExcerpt", {
    filter: (node) =>
      node.nodeName === "SPAN" && node.hasAttribute("data-annotation"),
    replacement:
      options.annotationExcerpt ??
      ((_content, node) => (node as Element).outerHTML),
  });

  // The note-import prepass replaces a qualifying annotation `<p>` with this
  // sentinel; emit its pre-rendered callout Markdown as a block, decoded from
  // the attribute (collapse-proof) rather than the node's text.
  td.addRule("annotationCallout", {
    filter: (node) =>
      node.nodeName === "DIV" && node.hasAttribute(ANNOTATION_CALLOUT_ATTR),
    replacement: (_content, node) =>
      `\n\n${decodeCalloutAttr(
        (node as Element).getAttribute(ANNOTATION_CALLOUT_ATTR) ?? "",
      )}\n\n`,
  });
}

interface NoteTurndownOptions extends Partial<HighlightOptions> {
  /**
   * Replacement for the highlight/underline excerpt span (`span[data-annotation]`).
   * Defaults to raw-HTML passthrough — the standalone converter keeps the payload
   * for a later stage. `parseNote` injects the resolver that renders linked marks.
   */
  annotationExcerpt?: TurndownService.ReplacementFunction;
  /**
   * Replacement for Zotero note embedded images (`img[data-attachment-key]`).
   * Defaults to raw-HTML passthrough so standalone conversion keeps the key.
   */
  embeddedImage?: TurndownService.ReplacementFunction;
  /**
   * Replacement for Zotero citation marks (`span.citation[data-citation]`).
   * Defaults to raw-HTML passthrough so standalone conversion keeps the payload.
   * `parseNote` injects the resolver that renders the user's cite syntax.
   */
  citation?: TurndownService.ReplacementFunction;
}

/**
 * Build a TurndownService that converts Zotero note HTML to Obsidian-flavored
 * Markdown. The base mirrors Obsidian's own `htmlToMarkdown`; the Zotero rules
 * layer on top. Built fresh per call (sub-millisecond), so `options` can inject
 * per-call rule replacements (e.g. annotation resolution) without shared state.
 *
 * `Turndown` is passed in rather than imported: at runtime Obsidian exposes
 * `TurndownService` as a global, and tests supply the npm package directly, so
 * the plugin bundle never pulls in turndown.
 */
export function createNoteTurndown(
  Turndown: typeof TurndownService,
  options: NoteTurndownOptions = {},
): TurndownService {
  const td = createObsidianTurndown(Turndown);
  addZoteroRules(td, options);
  return td;
}

export { createObsidianTurndown } from "./obsidian-base";
