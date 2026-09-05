// Liquid-in-Markdown editor language and the tag-range scanner that bounds suggestions.
import { liquid } from "@codemirror/lang-liquid";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { LanguageSupport } from "@codemirror/language";
import { Decoration, ViewPlugin } from "@codemirror/view";
import type { EditorView, ViewUpdate } from "@codemirror/view";

import { liquidRanges } from "./liquid-ranges";
export { liquidRanges, STRUCTURAL_TAGS } from "./liquid-ranges";
export type { LiquidRange } from "./liquid-ranges";

export const markdownSupport = markdown({
  base: markdownLanguage,
  completeHTMLTags: false,
});
const liquidSupport = liquid({ base: markdownSupport });
function delimiters(view: EditorView) {
  const source = view.state.doc.toString();
  return Decoration.set(
    liquidRanges(source).flatMap((range) => {
      const marks = [
        Decoration.mark({ class: "zt-liquid-delimiter" }).range(
          range.from,
          range.from + (source[range.from + 2] === "-" ? 3 : 2),
        ),
      ];
      if (range.closed)
        marks.push(
          Decoration.mark({ class: "zt-liquid-delimiter" }).range(
            range.to - (source[range.to - 3] === "-" ? 3 : 2),
            range.to,
          ),
        );
      return marks;
    }),
    true,
  );
}
const delimiterHighlight = ViewPlugin.define(
  (view) => ({
    decorations: delimiters(view),
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = delimiters(update.view);
    },
  }),
  { decorations: (plugin) => plugin.decorations },
);
export const liquidMarkdown = new LanguageSupport(liquidSupport.language, [
  markdownSupport.support,
  delimiterHighlight,
]);
