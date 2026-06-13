import type TurndownService from "turndown";

import { addObsidianRules, obsidianTurndownOptions } from "./obsidian-base";

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
 * - colored / highlighted spans — Zotero's text-color and highlight marks carry
 *   the color inline; preserve it as `<span style>` / `<mark style>`.
 * - `img[data-attachment-key]` — a Zotero embed with no `src`, both the plain
 *   attachment image and the image-excerpt annotation (`data-annotation` set).
 *   Keep the tag (and its key) so the shared Stage 9 import resolves it to a
 *   real embed.
 * - `span.citation[data-citation]` — Zotero's citation mark. Kept as raw HTML so
 *   a later resolution stage can read the URL-encoded payload.
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
        ? `<mark style="background-color: ${backgroundColor};">${content}</mark>`
        : `<span style="color: ${color};">${content}</span>`;
    },
  });

  td.addRule("embeddedImage", {
    filter: (node) =>
      node.nodeName === "IMG" && node.hasAttribute("data-attachment-key"),
    replacement: (_content, node) => {
      const el = node as Element;
      if (el.hasAttribute("data-annotation")) {
        // TBD Stage 9: image-excerpt annotation → real Obsidian embed
        return el.outerHTML;
      }
      // TBD Stage 9: plain attachment embed → real Obsidian embed
      return el.outerHTML;
    },
  });

  td.addRule("citation", {
    filter: (node) =>
      node.nodeName === "SPAN" &&
      node.classList.contains("citation") &&
      node.hasAttribute("data-citation"),
    // TBD: resolve to the user's citation syntax; pass the span through for now
    replacement: (_content, node) => (node as Element).outerHTML,
  });

  td.addRule("annotationExcerpt", {
    filter: (node) =>
      node.nodeName === "SPAN" && node.hasAttribute("data-annotation"),
    replacement:
      options.annotationExcerpt ??
      ((_content, node) => (node as Element).outerHTML),
  });
}

export interface NoteTurndownOptions {
  /**
   * Replacement for the highlight/underline excerpt span (`span[data-annotation]`).
   * Defaults to raw-HTML passthrough — the standalone converter keeps the payload
   * for a later stage. `parseNote` injects the resolver that renders linked marks.
   */
  annotationExcerpt?: TurndownService.ReplacementFunction;
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
  const td = new Turndown(obsidianTurndownOptions);
  addObsidianRules(td);
  addZoteroRules(td, options);
  return td;
}
