// The Filter Expression language for CodeMirror: the parser of
// `@zotlit/filter-expression`, tagged so the template highlighter colors it.
// The token assignment follows Bases: names and paths read as properties, a
// call's callee as a function, and `true`, `false`, `null` and numbers as
// values.
import { LRLanguage, syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { Tree } from "@lezer/common";
import { highlightTree, styleTags, tags } from "@lezer/highlight";

import { parser } from "@zotlit/filter-expression";

import { decorationLayer, gapsAround } from "./decorations";
import type { Span } from "./decorations";
import { templateHighlighter, templateToken } from "./highlight";

export const filterExpressionLanguage = LRLanguage.define({
  name: "filter-expression",
  parser: parser.configure({
    props: [
      styleTags({
        "Identifier PropertyName": tags.propertyName,
        "String/...": tags.string,
        RegExp: tags.regexp,
        RealNumber: tags.number,
        "BooleanLiteral NullLiteral": tags.literal,
        'Equality Relation "||" "&&" "!" "+" "-" "*" "/" "%"': tags.operator,
        '"(" ")" "[" "]"': tags.paren,
        '"," "."': tags.punctuation,
      }),
    ],
  }),
});

/**
 * The name each call invokes: a bare function, or the method after `.`. A
 * call's arguments sit beside its callee in the tree, so a tag rule cannot
 * single the callee out; this walk takes each call's first child.
 */
function callees(tree: Tree): Span[] {
  const names: Span[] = [];
  tree.iterate({
    enter(node) {
      if (node.name !== "Call") return;
      const callee = node.node.firstChild;
      const name = callee?.name === "ObjectAccess" ? callee.lastChild : callee;
      if (name && (name.name === "Identifier" || name.name === "PropertyName"))
        names.push({ from: name.from, to: name.to });
    },
  });
  // A method call's receiver can itself be a call, entered after it.
  return names.sort((a, b) => a.from - b.from);
}

/**
 * Highlights a Filter Expression tree with the template token hooks, the
 * callee of each call taking the function hook.
 * @param put Receives each highlighted token once, in document order; the
 *   ranges do not overlap.
 */
export function highlightFilterExpression(
  tree: Tree,
  put: (from: number, to: number, classes: string) => void,
): void {
  const names = callees(tree);
  const tokens: (Span & { classes: string })[] = names.map((name) => ({
    ...name,
    classes: templateToken.filter,
  }));
  highlightTree(tree, templateHighlighter, (from, to, classes) =>
    gapsAround({ from, to }, names, (start, end) =>
      tokens.push({ from: start, to: end, classes }),
    ),
  );
  for (const token of tokens.sort((a, b) => a.from - b.from))
    put(token.from, token.to, token.classes);
}

export const filterExpressionHighlighting = decorationLayer(
  (view) => {
    const marks: Range<Decoration>[] = [];
    highlightFilterExpression(syntaxTree(view.state), (from, to, classes) => {
      marks.push(Decoration.mark({ class: classes }).range(from, to));
    });
    return Decoration.set(marks);
  },
  {
    // The parse can finish after the edit that started it.
    rebuild: (update) =>
      update.docChanged ||
      syntaxTree(update.state) !== syntaxTree(update.startState),
  },
);
