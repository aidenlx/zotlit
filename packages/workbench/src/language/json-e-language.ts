import { closeBrackets } from "@codemirror/autocomplete";
// CodeMirror highlights JSON-e expressions inside JSON rules and embedded Profile values.
import { json, jsonLanguage } from "@codemirror/lang-json";
import { Prec } from "@codemirror/state";
import type { Range } from "@codemirror/state";
import { Decoration, ViewPlugin } from "@codemirror/view";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { regex } from "arkregex";

import { jsonExpressions, jsonExpressionTokens } from "./json-e";

export const jsonRule = [json(), closeBrackets()];

export function embeddedJsonE(
  read: () => readonly { from: number; to: number }[],
) {
  function decorations(view: EditorView) {
    const marks: Range<Decoration>[] = [];
    for (const region of read()) {
      const source = view.state.doc.sliceString(region.from, region.to);
      const expressions = jsonExpressions(source, {
        root: "note",
        partials: [],
      });
      if (!jsonLanguage.isActiveAt(view.state, region.from))
        highlightTree(
          jsonLanguage.parser.parse(source),
          classHighlighter,
          (from, to, classes) => {
            // Split the outer string styling around expression regions.
            let start = from;
            for (const expression of expressions) {
              const left = expression.offsets[0]!;
              const right = expression.offsets.at(-1)!;
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
      for (const expression of expressions)
        for (const token of jsonExpressionTokens(expression.text)) {
          const kind =
            token.text.startsWith("'") || token.text.startsWith('"')
              ? "string"
              : ["true", "false", "null", "in"].includes(token.text)
                ? "keyword"
                : regex("^[0-9]").test(token.text)
                  ? "number"
                  : regex("^[A-Za-z_]").test(token.text)
                    ? "variableName"
                    : "operator";
          marks.push(
            Decoration.mark({ class: `tok-${kind}` }).range(
              region.from + expression.offsets[token.from]!,
              region.from + expression.offsets[token.to]!,
            ),
          );
        }
    }
    return Decoration.set(marks, true);
  }
  return Prec.highest(
    ViewPlugin.define(
      (view) => ({
        decorations: decorations(view),
        update(update: ViewUpdate) {
          if (update.docChanged) this.decorations = decorations(update.view);
        },
      }),
      { decorations: (plugin) => plugin.decorations },
    ),
  );
}
