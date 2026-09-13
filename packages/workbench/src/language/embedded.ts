import { liquidTagLanguage } from "@codemirror/lang-liquid";
// Profile regions keep independent template syntax inside plain frontmatter.
import type { Range } from "@codemirror/state";
import { Prec } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import { highlightTree } from "@lezer/highlight";

import { etaBody } from "./eta-language";
import { etaParser } from "./eta-syntax";
import { templateHighlighters, documentToken } from "./highlight";
import { liquidBody, refusedLiquidMarks } from "./liquid";

/** A template body, scalar, or bare Property expression in editor offsets. */
export interface TemplateSourceRegion {
  from: number;
  to: number;
  expression: boolean;
  body?: boolean;
  language?: "liquid" | "eta" | "json-e";
}

/** Tokenize each embedded value independently from the surrounding YAML. */
export function embeddedTemplates(
  read: (source: string) => readonly TemplateSourceRegion[],
  frontmatterEnd?: () => number,
) {
  function decorations(view: EditorView) {
    const source = view.state.doc.toString();
    const marks: Range<Decoration>[] = [];
    const end = frontmatterEnd?.() ?? 0;
    for (let from = 0; from < end; from = view.state.doc.lineAt(from).to + 1)
      marks.push(
        Decoration.line({ class: documentToken.frontmatter }).range(from),
      );
    for (const region of read(source)) {
      const prefix = region.expression ? "{{ " : "";
      const text =
        prefix +
        source.slice(region.from, region.to) +
        (region.expression ? " }}" : "");
      const parser =
        region.language === "eta"
          ? region.body
            ? etaBody.parser
            : etaParser
          : region.body
            ? liquidBody.language.parser
            : liquidTagLanguage.parser;
      const tree = parser.parse(text);
      if (region.language !== "eta")
        for (const mark of refusedLiquidMarks(text, tree)) {
          const from = Math.max(
            region.from,
            mark.from + region.from - prefix.length,
          );
          const to = Math.min(region.to, mark.to + region.from - prefix.length);
          if (from < to) marks.push(mark.value.range(from, to));
        }
      highlightTree(tree, templateHighlighters, (from, to, classes) => {
        const start = Math.max(region.from, from + region.from - prefix.length);
        const end = Math.min(region.to, to + region.from - prefix.length);
        if (start < end)
          marks.push(Decoration.mark({ class: classes }).range(start, end));
      });
    }
    return Decoration.set(marks, true);
  }
  const plugin = ViewPlugin.define((view) => ({
    decorations: decorations(view),
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = decorations(update.view);
    },
  }));
  return [
    plugin,
    Prec.high(
      EditorView.decorations.of(
        (view) => view.plugin(plugin)?.decorations ?? Decoration.none,
      ),
    ),
  ];
}
