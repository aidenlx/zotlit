import { closeBrackets } from "@codemirror/autocomplete";
// CodeMirror highlights JSON-e expressions inside JSON rules and embedded Profile values.
import { json, jsonLanguage } from "@codemirror/lang-json";
import { Prec } from "@codemirror/state";
import type { Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import { classHighlighter, highlightTree } from "@lezer/highlight";

import { jsonSyntaxTokens } from "./json-e";

export const jsonRule = [json(), closeBrackets()];

export function embeddedJsonE(
  read: (source: string) => readonly { from: number; to: number }[],
) {
  function decorations(view: EditorView) {
    const marks: Range<Decoration>[] = [];
    for (const region of read(view.state.doc.toString())) {
      const source = view.state.doc.sliceString(region.from, region.to);
      const tokens = jsonSyntaxTokens(source);
      if (!jsonLanguage.isActiveAt(view.state, region.from))
        highlightTree(
          jsonLanguage.parser.parse(source),
          classHighlighter,
          (from, to, classes) => {
            // Keep the outer JSON styling around semantic JSON-e tokens.
            let start = from;
            for (const token of tokens) {
              const left = token.from;
              const right = token.to;
              if (right <= start || left >= to) continue;
              if (start < left)
                marks.push(
                  Decoration.mark({ class: classes }).range(
                    region.from + start,
                    region.from + left,
                  ),
                );
              start = Math.max(start, right);
            }
            if (start < to)
              marks.push(
                Decoration.mark({ class: classes }).range(
                  region.from + start,
                  region.from + to,
                ),
              );
          },
        );
      for (const token of tokens)
        marks.push(
          Decoration.mark({ class: `tok-${token.kind}` }).range(
            region.from + token.from,
            region.from + token.to,
          ),
        );
    }
    return Decoration.set(marks, true);
  }
  const plugin = ViewPlugin.define((view) => ({
    decorations: decorations(view),
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = decorations(update.view);
    },
  }));
  // Read regions after the document bridge updates; give only the marks precedence.
  return [
    plugin,
    Prec.highest(
      EditorView.decorations.of(
        (view) => view.plugin(plugin)?.decorations ?? Decoration.none,
      ),
    ),
  ];
}
