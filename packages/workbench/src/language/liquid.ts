// Liquid editor language and the tag-range scanner that bounds suggestions.
import { liquidTagLanguage } from "@codemirror/lang-liquid";
import { LanguageSupport, syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import { Decoration, ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import type { Tree } from "@lezer/common";
import { parseMixed } from "@lezer/common";
import { regex } from "arkregex";

import { templateToken } from "./highlight";
import { liquidRanges } from "./liquid-ranges";
import { markdownParser } from "./markdown";
export { liquidRanges, STRUCTURAL_TAGS } from "./liquid-ranges";
export type { LiquidRange } from "./liquid-ranges";

const delimiter = Decoration.mark({ class: templateToken.delimiter });
const keyword = Decoration.mark({ class: templateToken.keyword });
const TAG_NAME = regex("^\\s*(?<name>[\\w#]+)");

/**
 * The tags the upstream parser refuses — the closer of a ZotLit block such as
 * `{% endbq %}` — read as plain text, so the scanner colors their
 * delimiters and name the way the parser colors the tags it knows.
 */
export function refusedLiquidMarks(
  source: string,
  tree: Tree,
): Range<Decoration>[] {
  const marks: Range<Decoration>[] = [];
  for (const range of liquidRanges(source)) {
    let owner = tree.resolve(range.from, 1);
    while (owner.parent && !owner.type.isTop) owner = owner.parent;
    if (owner.name !== "Template") continue;
    // A tag the parser read has syntax nodes for both delimiters. A refused
    // closer can still have an error node for its opening delimiter.
    const parsedOpen = tree.resolveInner(range.from, 1).name;
    const parsedClose = tree.resolveInner(range.to, -1).name;
    const parserReadOpen = parsedOpen.startsWith("{");
    const parserReadClose = parsedClose.endsWith("}");
    if (range.line || (parserReadOpen && (parserReadClose || !range.closed)))
      continue;
    const open = range.from + (source[range.from + 2] === "-" ? 3 : 2);
    const close = range.closed
      ? range.to - (source[range.to - 3] === "-" ? 3 : 2)
      : range.to;
    if (!parserReadOpen) marks.push(delimiter.range(range.from, open));
    const name = TAG_NAME.exec(source.slice(open, close));
    if (name)
      marks.push(
        keyword.range(
          open + name[0].length - name.groups.name.length,
          open + name[0].length,
        ),
      );
    if (range.closed && !parserReadClose)
      marks.push(delimiter.range(close, range.to));
  }
  return marks;
}

const refusedTagHighlight = ViewPlugin.define(
  (view) => ({
    decorations: Decoration.set(
      refusedLiquidMarks(view.state.doc.toString(), syntaxTree(view.state)),
      true,
    ),
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      )
        this.decorations = Decoration.set(
          refusedLiquidMarks(
            update.state.doc.toString(),
            syntaxTree(update.state),
          ),
          true,
        );
    },
  }),
  { decorations: (plugin) => plugin.decorations },
);

/** Liquid over plain text: the prose between tags carries no syntax of its own. */
export const liquidTemplate = new LanguageSupport(liquidTagLanguage, [
  refusedTagHighlight,
]);

/** Liquid owns template syntax, with Markdown parsed across the host text. */
export const liquidBody = new LanguageSupport(
  liquidTagLanguage.configure({
    wrap: parseMixed((node) =>
      node.type.isTop
        ? {
            parser: markdownParser,
            overlay: (child) =>
              child.name === "Text" || child.name === "RawText",
          }
        : null,
    ),
  }),
  [refusedTagHighlight],
);
