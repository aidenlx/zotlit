// Liquid-in-Markdown editor language and the tag-range scanner that bounds suggestions.
import { liquid } from "@codemirror/lang-liquid";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { LanguageSupport } from "@codemirror/language";
import { Decoration, MatchDecorator, ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import { regex } from "arkregex";

import { MANAGED_BLOCK_TAG_NAMES } from "@zotlit/templates/constants";

/** Managed Block boundary tags; the Literature Note Template owns their meaning. */
export const STRUCTURAL_TAGS: readonly string[] = MANAGED_BLOCK_TAG_NAMES;
export const markdownSupport = markdown({
  base: markdownLanguage,
  completeHTMLTags: false,
});
const liquidSupport = liquid({ base: markdownSupport });
const delimiterMatcher = new MatchDecorator({
  regexp: /\{[{%]-?|-?[}%]}/g,
  decoration: Decoration.mark({ class: "zt-liquid-delimiter" }),
});
const delimiterHighlight = ViewPlugin.define(
  (view) => ({
    decorations: delimiterMatcher.createDeco(view),
    update(update: ViewUpdate) {
      this.decorations = delimiterMatcher.updateDeco(update, this.decorations);
    },
  }),
  { decorations: (plugin) => plugin.decorations },
);
export const liquidMarkdown = new LanguageSupport(liquidSupport.language, [
  liquidSupport.support,
  delimiterHighlight,
]);
export interface LiquidRange {
  from: number;
  to: number;
  kind: "output" | "tag" | "structural" | "comment";
  name: string;
  closed: boolean;
}

/**
 * Scans Liquid delimiters without parsing. Quotes hide delimiters inside them;
 * `raw` and `comment` bodies are skipped whole, so their delimiters never open
 * a range. An unterminated range runs to the end of the source with
 * `closed: false`.
 */
export function liquidRanges(source: string): LiquidRange[] {
  const result: LiquidRange[] = [];
  const start = /\{[{%]/g;
  while (true) {
    const match = start.exec(source);
    if (!match) break;
    const from = match.index;
    const output = match[0] === "{{";
    const close = output ? "}}" : "%}";
    const name = output
      ? ""
      : (regex("^\\{%-?\\s*(?<name>[\\w#]+)").exec(source.slice(from))?.groups
          .name ?? "");
    let quote = "";
    let to = from + 2;
    for (; to < source.length; to++) {
      const char = source[to];
      if (name === "#") {
        if (source.startsWith(close, to)) break;
      } else if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") quote = char;
      else if (source.startsWith(close, to)) break;
    }
    const closed = to < source.length;
    to = Math.min(to + 2, source.length);
    if (name === "raw" || name === "comment") {
      // Two literal patterns instead of interpolating `name` into a RegExp
      // (policies/regex.md); no captures are read, so a plain literal is
      // enough — arkregex's typed captures buy nothing here.
      const end =
        name === "raw"
          ? /\{%-?\s*endraw\s*-?%}/g
          : /\{%-?\s*endcomment\s*-?%}/g;
      end.lastIndex = to;
      const ending = end.exec(source);
      if (name === "comment") {
        result.push({
          from,
          to: ending ? ending.index + ending[0].length : source.length,
          kind: "comment",
          name,
          closed: !!ending,
        });
      } else {
        result.push({ from, to, kind: "tag", name, closed });
        if (ending)
          result.push({
            from: ending.index,
            to: ending.index + ending[0].length,
            kind: "tag",
            name: "endraw",
            closed: true,
          });
      }
      start.lastIndex = ending
        ? ending.index + ending[0].length
        : source.length;
      continue;
    }
    result.push({
      from,
      to,
      kind: output
        ? "output"
        : STRUCTURAL_TAGS.includes(name)
          ? "structural"
          : name === "#"
            ? "comment"
            : "tag",
      name,
      closed,
    });
    start.lastIndex = to;
  }
  return result;
}
