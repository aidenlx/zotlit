// The Filter Expression language for CodeMirror: the parser of
// `@zotlit/filter-expression`, tagged by the expression token roles so the
// template highlighter colors it.
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { LRLanguage, syntaxTree } from "@codemirror/language";
import { Prec } from "@codemirror/state";
import type { Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { highlightTree, styleTags } from "@lezer/highlight";

import { parser } from "@zotlit/filter-expression";

import { decorationLayer, gapsAround } from "./decorations";
import { expressionClasses, expressionTag } from "./expression-tokens";
import { templateHighlighter } from "./highlight";
import type { Span } from "./span";

/** The symbols that open a pair; the grammar has no braces. */
const pairedSymbols = ["(", "[", '"', "'"];

export const filterExpressionLanguage = LRLanguage.define({
  name: "filter-expression",
  parser: parser.configure({
    props: [
      styleTags({
        "Identifier PropertyName": expressionTag.name,
        "String/...": expressionTag.string,
        RegExp: expressionTag.regexp,
        RealNumber: expressionTag.number,
        "BooleanLiteral NullLiteral": expressionTag.literal,
        'Equality Relation "||" "&&" "!" "+" "-" "*" "/" "%"':
          expressionTag.operator,
        '"(" ")" "[" "]"': expressionTag.bracket,
        '"," "."': expressionTag.punctuation,
      }),
    ],
  }),
  languageData: {
    // A comma joins the arguments and items a new bracket stands before.
    closeBrackets: { brackets: pairedSymbols, before: ")]," },
  },
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
    classes: expressionClasses("callee"),
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

/**
 * Inside a string or a regular expression a symbol is text. `closeBrackets`
 * cannot tell: it pairs by the next character alone. The literal's own quote
 * goes on to it, as that quote closes the literal.
 */
const literalSymbols = Prec.high(
  // oxlint-disable-next-line max-params -- CodeMirror inputHandler signature.
  EditorView.inputHandler.of((view, from, to, text, insert) => {
    if (from !== to || view.compositionStarted || !pairedSymbols.includes(text))
      return false;
    const { state } = view;
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, -1);
    while (node && node.name !== "String" && node.name !== "RegExp")
      node = node.parent;
    if (
      !node ||
      from >= node.to ||
      state.sliceDoc(node.from, node.from + 1) === text
    )
      return false;
    view.dispatch(insert());
    return true;
  }),
);

/** Closes each paired symbol as it is typed. */
export const filterExpressionPairing: Extension = [
  literalSymbols,
  closeBrackets(),
  keymap.of(closeBracketsKeymap),
];
