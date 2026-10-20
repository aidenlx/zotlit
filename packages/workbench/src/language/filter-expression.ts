// The Filter Expression language for CodeMirror: the parser of
// `@zotlit/filter-expression`, tagged so the template highlighter colors it.
// The token assignment follows Bases: names and paths read as properties, a
// call's callee as a function, and `true`, `false`, `null` and numbers as
// values.
import { LRLanguage, syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import { Decoration, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import type { Tree } from "@lezer/common";
import { highlightTree, styleTags, tags } from "@lezer/highlight";

import { parser } from "@zotlit/filter-expression";

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
function callees(tree: Tree): { from: number; to: number }[] {
  const names: { from: number; to: number }[] = [];
  tree.iterate({
    enter(node) {
      if (node.name !== "Call") return;
      const callee = node.node.firstChild;
      const name = callee?.name === "ObjectAccess" ? callee.lastChild : callee;
      if (name && (name.name === "Identifier" || name.name === "PropertyName"))
        names.push({ from: name.from, to: name.to });
    },
  });
  return names;
}

/**
 * Highlights a Filter Expression tree with the template token hooks, the
 * callee of each call taking the function hook.
 */
export function highlightFilterExpression(
  tree: Tree,
  put: (from: number, to: number, classes: string) => void,
): void {
  const names = callees(tree);
  highlightTree(tree, templateHighlighter, (from, to, classes) => {
    let start = from;
    for (const name of names) {
      if (name.to <= start || name.from >= to) continue;
      if (start < name.from) put(start, name.from, classes);
      put(
        Math.max(start, name.from),
        Math.min(to, name.to),
        templateToken.filter,
      );
      start = Math.min(to, name.to);
    }
    if (start < to) put(start, to, classes);
  });
}

function decorations(view: EditorView): DecorationSet {
  const marks: Range<Decoration>[] = [];
  highlightFilterExpression(syntaxTree(view.state), (from, to, classes) => {
    marks.push(Decoration.mark({ class: classes }).range(from, to));
  });
  return Decoration.set(marks, true);
}

/** Colors the Filter Expression in an editor with the template token hooks. */
export const filterExpressionHighlighting = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      )
        this.decorations = decorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
