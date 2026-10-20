import { closeBrackets } from "@codemirror/autocomplete";
// CodeMirror highlights JSON-e expressions inside JSON rules and embedded Profile values.
import { json, jsonLanguage } from "@codemirror/lang-json";
import { Prec } from "@codemirror/state";
import type { Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { highlightTree } from "@lezer/highlight";

import { decorationLayer, gapsAround } from "./decorations";
import { templateHighlighter } from "./highlight";
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
          templateHighlighter,
          (from, to, classes) => {
            // Keep the outer JSON styling around semantic JSON-e tokens.
            gapsAround({ from, to }, tokens, (start, end) =>
              marks.push(
                Decoration.mark({ class: classes }).range(
                  region.from + start,
                  region.from + end,
                ),
              ),
            );
          },
        );
      for (const token of tokens)
        marks.push(
          Decoration.mark({ class: token.classes }).range(
            region.from + token.from,
            region.from + token.to,
          ),
        );
    }
    return Decoration.set(marks, true);
  }
  // Read regions after the document bridge updates; give only the marks precedence.
  return decorationLayer(decorations, { precedence: Prec.highest });
}
