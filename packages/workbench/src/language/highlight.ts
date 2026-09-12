// The classes every template editor emits for each kind of token. Their names
// are ZotLit's public theme hooks: a host colors them, and a theme or CSS
// snippet can restyle them by class.
import { syntaxHighlighting } from "@codemirror/language";
import type { NodeType } from "@lezer/common";
import { tagHighlighter, tags } from "@lezer/highlight";

import { markdownTop } from "./markdown";

/** The theme hook for each kind of template token. */
export const templateToken = {
  /** The braces that open and close a tag or an output: `{{`, `{%-`, `<%=`. */
  delimiter: "zt-template-delimiter",
  keyword: "zt-template-keyword",
  variable: "zt-template-variable",
  property: "zt-template-property",
  /** A Liquid filter or a function call. */
  filter: "zt-template-filter",
  string: "zt-template-string",
  /** A number, boolean, or null. */
  value: "zt-template-value",
  operator: "zt-template-operator",
  punctuation: "zt-template-punctuation",
  comment: "zt-template-comment",
  invalid: "zt-template-invalid",
} as const;

export type TemplateToken = keyof typeof templateToken;

/** Maps Lezer tags onto the template token hooks; the most specific tag wins. */
export const templateHighlighter = tagHighlighter([
  { tag: tags.brace, class: templateToken.delimiter },
  { tag: [tags.keyword, tags.tagName], class: templateToken.keyword },
  { tag: tags.name, class: templateToken.variable },
  { tag: tags.propertyName, class: templateToken.property },
  { tag: tags.function(tags.variableName), class: templateToken.filter },
  { tag: tags.function(tags.propertyName), class: templateToken.filter },
  { tag: tags.string, class: templateToken.string },
  { tag: tags.literal, class: templateToken.value },
  { tag: tags.operator, class: templateToken.operator },
  { tag: tags.punctuation, class: templateToken.punctuation },
  { tag: [tags.comment, tags.meta], class: templateToken.comment },
  { tag: tags.invalid, class: templateToken.invalid },
]);

/** Document styling around template expressions. */
export const documentToken = {
  frontmatter: "zt-template-frontmatter",
  markdownMarker: "zt-template-markdown-marker",
  markdownListMarker: "zt-template-markdown-list-marker",
} as const;

export const templateHighlighters = [
  { ...templateHighlighter, scope: (node: NodeType) => node !== markdownTop },
  {
    ...tagHighlighter([
      {
        tag: tags.special(tags.punctuation),
        class: documentToken.markdownMarker,
      },
      {
        tag: tags.special(tags.separator),
        class: `${documentToken.markdownMarker} ${documentToken.markdownListMarker}`,
      },
    ]),
    scope: (node: NodeType) => node === markdownTop,
  },
];
export const templateHighlighting = templateHighlighters.map((highlighter) =>
  syntaxHighlighting(highlighter),
);
