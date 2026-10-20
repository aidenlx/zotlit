// The token assignment of the expression languages the editors color: the
// Filter Expression, and the JSON-e expressions in a rule or a Profile value.
// It follows Bases: names and paths read as properties, a call's callee as a
// function, and `true`, `false`, `null` and numbers as values. Each language
// tags its tokens by these roles, and the template highlighter gives each
// tag its theme hook.
import { tags } from "@lezer/highlight";

import { templateHighlighter } from "./highlight";

/** The tag of each role a token takes in an expression. */
export const expressionTag = {
  /** A name, or a step of a path: `zt`, `title` in `zt.title`. */
  name: tags.propertyName,
  /** The name a call invokes: a function, or a method after `.`. */
  callee: tags.function(tags.propertyName),
  /** `true`, `false` and `null`. */
  literal: tags.literal,
  number: tags.number,
  string: tags.string,
  regexp: tags.regexp,
  operator: tags.operator,
  /** `(`, `)`, `[` and `]`. */
  bracket: tags.paren,
  /** `,` and `.`. */
  punctuation: tags.punctuation,
} as const;

export type ExpressionRole = keyof typeof expressionTag;

/** The theme hooks of a token that takes `role`. */
export function expressionClasses(role: ExpressionRole): string {
  return templateHighlighter.style([expressionTag[role]]) ?? "";
}
