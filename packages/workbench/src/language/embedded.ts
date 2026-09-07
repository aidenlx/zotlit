import { liquidLanguage } from "@codemirror/lang-liquid";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
// Embedded Liquid values retain their own token colors inside YAML manifest scalars.
import type { Range } from "@codemirror/state";
import { Decoration, ViewPlugin } from "@codemirror/view";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { classHighlighter, highlightTree } from "@lezer/highlight";

import { liquidMarkdown } from "./liquid";

export const profileLanguage = yamlFrontmatter({ content: liquidMarkdown });

/** A Liquid scalar or bare Property expression inside an editor's source. */
export interface LiquidSourceRegion {
  from: number;
  to: number;
  expression: boolean;
}

/** Tokenize each embedded value independently from the surrounding YAML. */
export function embeddedLiquid(
  read: (source: string) => readonly LiquidSourceRegion[],
) {
  function decorations(view: EditorView) {
    const source = view.state.doc.toString();
    const marks: Range<Decoration>[] = [];
    for (const region of read(source)) {
      const prefix = region.expression ? "{{ " : "";
      const text =
        prefix +
        source.slice(region.from, region.to) +
        (region.expression ? " }}" : "");
      highlightTree(
        liquidLanguage.parser.parse(text),
        classHighlighter,
        (from, to, classes) => {
          const start = Math.max(
            region.from,
            from + region.from - prefix.length,
          );
          const end = Math.min(region.to, to + region.from - prefix.length);
          if (start < end)
            marks.push(Decoration.mark({ class: classes }).range(start, end));
        },
      );
    }
    return Decoration.set(marks, true);
  }
  return ViewPlugin.define(
    (view) => ({
      decorations: decorations(view),
      update(update: ViewUpdate) {
        if (update.docChanged) this.decorations = decorations(update.view);
      },
    }),
    { decorations: (plugin) => plugin.decorations },
  );
}
