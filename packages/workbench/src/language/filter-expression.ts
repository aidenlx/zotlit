// The Filter Expression language for CodeMirror: the parser of
// `@zotlit/filter-expression`, tagged so the template highlighter colors it.
import { LRLanguage } from "@codemirror/language";
import { styleTags, tags } from "@lezer/highlight";

import { parser } from "@zotlit/filter-expression";

export const filterExpressionLanguage = LRLanguage.define({
  name: "filter-expression",
  parser: parser.configure({
    props: [
      styleTags({
        Identifier: tags.variableName,
        PropertyName: tags.propertyName,
        String: tags.string,
        Escape: tags.escape,
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
